//! Optional lint: JSX rows produced by `.map(...)` have positional identity.
//! Removing or reordering such rows moves component state, focus, drafts and
//! in-flight work to a different row. Explicit `list(...)` keys rows instead.
use oxc::{
    ast::ast::*,
    ast_visit::{Visit, walk},
    span::{GetSpan, Span},
};

const FORM_CONTROLS: [&str; 3] = ["input", "textarea", "select"];

/// Local names of runtime exports imported from the runtime package or its subpaths.
fn imported(program: &Program<'_>, import_source: &str, names: &[&str]) -> Vec<(String, String)> {
    let mut found = vec![];
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        let source = import.source.value.as_str();
        if source != import_source && !source.starts_with(&format!("{import_source}/")) {
            continue;
        }
        for specifier in import.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
                && names.contains(&specifier.imported.name().as_str())
            {
                found.push((
                    specifier.imported.name().to_string(),
                    specifier.local.name.to_string(),
                ));
            }
        }
    }
    found
}

pub struct MapRows {
    pub spans: Vec<Span>,
    /// `sequence(rows)` whose positional rows hold form controls or filtered components.
    pub positional: Vec<Span>,
    /// `collection((item, index) => ...)` or `list(rows, (item, index) => ..., render)`
    /// deriving identity from the row position.
    pub indexed: Vec<Span>,
    sequences: Vec<String>,
    collections: Vec<String>,
    lists: Vec<String>,
}
impl MapRows {
    pub fn new(program: &Program<'_>, import_source: &str) -> Self {
        let names = imported(program, import_source, &["sequence", "collection", "list"]);
        let locals = |name: &str| {
            names
                .iter()
                .filter(|(imported, _)| imported == name)
                .map(|(_, local)| local.clone())
                .collect()
        };
        Self {
            spans: vec![],
            positional: vec![],
            indexed: vec![],
            sequences: locals("sequence"),
            collections: locals("collection"),
            lists: locals("list"),
        }
    }
    fn named(call: &CallExpression<'_>, names: &[String]) -> bool {
        matches!(call.callee.without_parentheses(), Expression::Identifier(id)
            if names.iter().any(|name| name == id.name.as_str()))
    }
}

impl<'a> Visit<'a> for MapRows {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(Expression::CallExpression(rows)) = call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .map(Expression::without_parentheses)
            && Self::named(rows, &self.sequences)
            && let Some(input) = rows.arguments.first().and_then(Argument::as_expression)
            && !static_rows(input)
            && let Some(callback) = call.arguments.get(1).and_then(Argument::as_expression)
            && (returns_row(callback, controls)
                || (derived_rows(input) && returns_row(callback, stateful)))
        {
            self.positional.push(rows.span);
        }
        if Self::named(call, &self.collections)
            && let Some(callback) = call.arguments.first().and_then(Argument::as_expression)
            && uses_index(callback)
        {
            self.indexed.push(call.span);
        }
        if Self::named(call, &self.lists)
            && call.arguments.len() == 3
            && let Some(identity) = call.arguments.get(1).and_then(Argument::as_expression)
            && uses_index(identity)
        {
            self.indexed.push(identity.span());
        }
        if let Some(member) = call.callee.without_parentheses().as_member_expression()
            && member.static_property_name() == Some("map")
            && let Some(callback) = call.arguments.first().and_then(Argument::as_expression)
            && returns_row(callback, jsx_row)
        {
            self.spans.push(call.span);
        }
        walk::walk_call_expression(self, call);
    }
}

/// Fixed literal rows. Filtering, slicing, conditionals and spreads can shift identity.
fn static_rows(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| {
            matches!(element, ArrayExpressionElement::Elision(_))
                || element.as_expression().is_some_and(literal)
        }),
        Expression::TSAsExpression(e) => static_rows(&e.expression),
        Expression::TSSatisfiesExpression(e) => static_rows(&e.expression),
        Expression::TSNonNullExpression(e) => static_rows(&e.expression),
        _ => false,
    }
}

/// A literal value, including arrays and objects built only from literals (e.g. `['id', 'Label']`).
fn literal(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::ArrayExpression(array) => array
            .elements
            .iter()
            .all(|element| element.as_expression().is_some_and(literal)),
        Expression::ObjectExpression(object) => object.properties.iter().all(|property| {
            matches!(property, ObjectPropertyKind::ObjectProperty(property)
                if !property.computed && literal(&property.value))
        }),
        _ => false,
    }
}

/// Rows selected from a longer array: their positions shift whenever the selection changes.
fn derived_rows(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::CallExpression(call) => call
            .callee
            .without_parentheses()
            .as_member_expression()
            .is_some_and(|member| {
                // A prefix keeps every remaining row at its position.
                let prefix = matches!(
                    call.arguments.first().and_then(Argument::as_expression),
                    Some(Expression::NumericLiteral(start)) if start.value == 0.0
                );
                match member.static_property_name() {
                    Some("filter") => true,
                    Some("slice") => !prefix,
                    _ => derived_rows(member.object()),
                }
            }),
        Expression::TSAsExpression(e) => derived_rows(&e.expression),
        Expression::TSSatisfiesExpression(e) => derived_rows(&e.expression),
        Expression::TSNonNullExpression(e) => derived_rows(&e.expression),
        _ => false,
    }
}

/// An identity callback reading its index parameter keys rows by position.
fn uses_index(callback: &Expression<'_>) -> bool {
    struct Reads<'n>(&'n str, bool);
    impl<'a> Visit<'a> for Reads<'_> {
        fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
            if id.name.as_str() == self.0 {
                self.1 = true;
            }
        }
        // Position as the fallback for rows that have no identity yet is a deliberate choice.
        fn visit_logical_expression(&mut self, logical: &LogicalExpression<'a>) {
            self.visit_expression(&logical.left);
        }
    }
    let (parameter, mut reads) = match callback.without_parentheses() {
        Expression::ArrowFunctionExpression(function) => {
            let Some(BindingPattern::BindingIdentifier(id)) = function
                .params
                .items
                .get(1)
                .map(|parameter| &parameter.pattern)
            else {
                return false;
            };
            let mut reads = Reads(id.name.as_str(), false);
            reads.visit_arrow_function_body(&function.body);
            return reads.1;
        }
        Expression::FunctionExpression(function) => {
            let Some(BindingPattern::BindingIdentifier(id)) = function
                .params
                .items
                .get(1)
                .map(|parameter| &parameter.pattern)
            else {
                return false;
            };
            (function, Reads(id.name.as_str(), false))
        }
        _ => return false,
    };
    if let Some(body) = &parameter.body {
        reads.visit_function_body(body);
    }
    reads.1
}

fn jsx_row(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::JSXElement(_) | Expression::JSXFragment(_) => true,
        Expression::ConditionalExpression(e) => jsx_row(&e.consequent) || jsx_row(&e.alternate),
        Expression::LogicalExpression(e) => jsx_row(&e.left) || jsx_row(&e.right),
        Expression::TSAsExpression(e) => jsx_row(&e.expression),
        Expression::TSSatisfiesExpression(e) => jsx_row(&e.expression),
        Expression::TSNonNullExpression(e) => jsx_row(&e.expression),
        _ => false,
    }
}

fn returns_row(callback: &Expression<'_>, stateful: fn(&Expression<'_>) -> bool) -> bool {
    let body = match callback.without_parentheses() {
        Expression::ArrowFunctionExpression(function) => {
            if let Some(expression) = function.get_expression() {
                return stateful(expression);
            }
            match function.get_function_body() {
                Some(body) => body,
                None => return false,
            }
        }
        Expression::FunctionExpression(function) => match function.body.as_deref() {
            Some(body) => body,
            None => return false,
        },
        _ => return false,
    };
    let mut returns = Returns {
        found: false,
        stateful,
    };
    returns.visit_function_body(body);
    returns.found
}

struct Returns {
    found: bool,
    stateful: fn(&Expression<'_>) -> bool,
}
impl<'a> Visit<'a> for Returns {
    fn visit_return_statement(&mut self, statement: &ReturnStatement<'a>) {
        if statement.argument.as_ref().is_some_and(self.stateful) {
            self.found = true;
        }
    }
    // Nested callbacks return their own values.
    fn visit_function(&mut self, _: &Function<'a>, _: oxc::syntax::scope::ScopeFlags) {}
    fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
}

fn stateful(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::JSXElement(element) => element_stateful(element),
        Expression::JSXFragment(fragment) => children_stateful(&fragment.children),
        Expression::ConditionalExpression(conditional) => {
            stateful(&conditional.consequent) || stateful(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            stateful(&logical.left) || stateful(&logical.right)
        }
        _ => false,
    }
}

/// Markup holding an editable form control. Disabled and read-only controls keep no draft.
fn controls(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::JSXElement(element) => element_controls(element),
        Expression::JSXFragment(fragment) => children_controls(&fragment.children),
        Expression::ConditionalExpression(conditional) => {
            controls(&conditional.consequent) || controls(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            controls(&logical.left) || controls(&logical.right)
        }
        _ => false,
    }
}

fn has_attribute(element: &JSXElement<'_>, names: &[&str]) -> bool {
    element.opening_element.attributes.iter().any(|attribute| {
        matches!(attribute, JSXAttributeItem::Attribute(attribute)
            if matches!(&attribute.name, JSXAttributeName::Identifier(name)
                if names.iter().any(|expected| name.name.eq_ignore_ascii_case(expected))))
    })
}

fn element_controls(element: &JSXElement<'_>) -> bool {
    if let JSXElementName::Identifier(name) = &element.opening_element.name
        && FORM_CONTROLS.contains(&name.name.as_str())
    {
        return !has_attribute(element, &["disabled", "readonly"]);
    }
    has_attribute(element, &["contenteditable"]) || children_controls(&element.children)
}

fn children_controls(children: &[JSXChild<'_>]) -> bool {
    children.iter().any(|child| match child {
        JSXChild::Element(element) => element_controls(element),
        JSXChild::Fragment(fragment) => children_controls(&fragment.children),
        JSXChild::ExpressionContainer(container) => {
            container.expression.as_expression().is_some_and(controls)
        }
        _ => false,
    })
}

fn element_stateful(element: &JSXElement<'_>) -> bool {
    let opening = &element.opening_element;
    match &opening.name {
        JSXElementName::IdentifierReference(_) | JSXElementName::MemberExpression(_) => {
            return true;
        }
        JSXElementName::Identifier(name) if FORM_CONTROLS.contains(&name.name.as_str()) => {
            return true;
        }
        _ => {}
    }
    // An element with a DOM binding owns a resource, and an editable element owns a draft.
    let editable = opening.attributes.iter().any(|attribute| {
        matches!(attribute, JSXAttributeItem::Attribute(attribute)
            if matches!(&attribute.name, JSXAttributeName::Identifier(name)
                if name.name.eq_ignore_ascii_case("contenteditable") || name.name.as_str() == "use"))
    });
    editable || children_stateful(&element.children)
}

fn children_stateful(children: &[JSXChild<'_>]) -> bool {
    children.iter().any(|child| match child {
        JSXChild::Element(element) => element_stateful(element),
        JSXChild::Fragment(fragment) => children_stateful(&fragment.children),
        JSXChild::ExpressionContainer(container) => {
            container.expression.as_expression().is_some_and(stateful)
        }
        _ => false,
    })
}

/// `domMount(fn)` / `domBinding(data, fn)` use `fn` as the binding identity. An inline
/// function created during render is new on every update, so the DOM resource is torn
/// down and acquired again each time.
pub struct InlineBindings {
    pub spans: Vec<Span>,
    pub sources_inline: Vec<Span>,
    views: Vec<String>,
    mounts: Vec<String>,
    bindings: Vec<String>,
    /// Constructors whose result must outlive a render: sources and collections.
    sources: Vec<String>,
    depth: usize,
}
impl InlineBindings {
    pub fn new(program: &Program<'_>, import_source: &str) -> Self {
        let mut found = Self {
            spans: vec![],
            sources_inline: vec![],
            views: vec![],
            mounts: vec![],
            bindings: vec![],
            sources: vec![],
            depth: 0,
        };
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            let source = import.source.value.as_str();
            if source != import_source && !source.starts_with(&format!("{import_source}/")) {
                continue;
            }
            for specifier in import.specifiers.iter().flatten() {
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    continue;
                };
                let local = specifier.local.name.to_string();
                match specifier.imported.name().as_str() {
                    "view" => found.views.push(local),
                    "domMount" => found.mounts.push(local),
                    "domBinding" => found.bindings.push(local),
                    "mapSource" | "clock" | "collection" => found.sources.push(local),
                    _ => {}
                }
            }
        }
        found
    }
    fn callee<'n>(call: &'n CallExpression<'_>) -> Option<&'n str> {
        match call.callee.without_parentheses() {
            Expression::Identifier(id) => Some(id.name.as_str()),
            _ => None,
        }
    }
}
fn inline_function(argument: Option<&Argument<'_>>) -> bool {
    matches!(
        argument
            .and_then(Argument::as_expression)
            .map(Expression::without_parentheses),
        Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))
    )
}
impl<'a> Visit<'a> for InlineBindings {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let name = Self::callee(call);
        let is_view = name.is_some_and(|name| self.views.iter().any(|v| v == name));
        if self.depth > 0
            && let Some(name) = name
        {
            let argument = if self.mounts.iter().any(|m| m == name) {
                Some(call.arguments.first())
            } else if self.bindings.iter().any(|b| b == name) {
                Some(call.arguments.get(1))
            } else {
                None
            };
            if argument.is_some_and(inline_function) {
                self.spans.push(call.span);
            }
            // A source or collection built during render is new on every
            // update: its subscription or row cache never carries over.
            if self.sources.iter().any(|s| s == name) {
                self.sources_inline.push(call.span);
            }
        }
        if is_view {
            self.depth += 1;
        }
        walk::walk_call_expression(self, call);
        if is_view {
            self.depth -= 1;
        }
    }
    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        // Attribute expressions are evaluated on every render, even outside view(...).
        self.depth += 1;
        walk::walk_jsx_attribute(self, attribute);
        self.depth -= 1;
    }
}
