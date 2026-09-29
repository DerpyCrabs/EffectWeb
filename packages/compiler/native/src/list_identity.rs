//! Optional lint: JSX rows produced by `.map(...)` have positional identity.
//! Removing or reordering such rows moves component state, focus, drafts and
//! in-flight work to a different row. Explicit `list(...)` keys rows instead.
use oxc::{
    ast::ast::*,
    ast_visit::{Visit, walk},
    span::Span,
};

const FORM_CONTROLS: [&str; 3] = ["input", "textarea", "select"];

#[derive(Default)]
pub struct MapRows {
    pub spans: Vec<Span>,
}

impl<'a> Visit<'a> for MapRows {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(member) = call.callee.without_parentheses().as_member_expression()
            && member.static_property_name() == Some("map")
            // Literal option arrays never reorder; positional identity is exact there.
            && !static_rows(member.object())
            && let Some(callback) = call.arguments.first().and_then(Argument::as_expression)
            && returns_stateful_row(callback)
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

fn returns_stateful_row(callback: &Expression<'_>) -> bool {
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
    let mut returns = Returns::default();
    returns.visit_function_body(body);
    returns.found
}

#[derive(Default)]
struct Returns {
    found: bool,
}
impl<'a> Visit<'a> for Returns {
    fn visit_return_statement(&mut self, statement: &ReturnStatement<'a>) {
        if statement.argument.as_ref().is_some_and(stateful) {
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
    let editable = opening.attributes.iter().any(|attribute| {
        matches!(attribute, JSXAttributeItem::Attribute(attribute)
            if matches!(&attribute.name, JSXAttributeName::Identifier(name)
                if name.name.eq_ignore_ascii_case("contenteditable")))
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
    observes: Vec<String>,
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
            observes: vec![],
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
                    "observe" => found.observes.push(local),
                    "mapSource" | "clock" => found.sources.push(local),
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
            // observe(mapSource(...)) builds a new source, and a new subscription, per render.
            if self.observes.iter().any(|o| o == name)
                && let Some(Expression::CallExpression(inner)) = call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .map(Expression::without_parentheses)
                && Self::callee(inner).is_some_and(|n| self.sources.iter().any(|s| s == n))
            {
                self.sources_inline.push(inner.span);
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

/// `commandSlot(name)` returns a new slot on every call. Passing a freshly created slot
/// straight into `run`/`effectCommand` inside a function means `replace` and `drop`
/// never see earlier work, so stale requests race newer ones.
pub struct InlineSlots {
    pub spans: Vec<Span>,
    slots: Vec<String>,
    depth: usize,
}
impl InlineSlots {
    pub fn new(program: &Program<'_>, import_source: &str) -> Self {
        let mut slots = vec![];
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
                    && specifier.imported.name() == "commandSlot"
                {
                    slots.push(specifier.local.name.to_string());
                }
            }
        }
        Self {
            spans: vec![],
            slots,
            depth: 0,
        }
    }
}
impl<'a> Visit<'a> for InlineSlots {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.depth > 0 {
            for argument in &call.arguments {
                if let Some(Expression::CallExpression(inner)) = argument
                    .as_expression()
                    .map(Expression::without_parentheses)
                    && let Expression::Identifier(id) = inner.callee.without_parentheses()
                    && self.slots.iter().any(|slot| slot == id.name.as_str())
                {
                    self.spans.push(inner.span);
                }
            }
        }
        walk::walk_call_expression(self, call);
    }
    fn visit_function(&mut self, function: &Function<'a>, flags: oxc::syntax::scope::ScopeFlags) {
        self.depth += 1;
        walk::walk_function(self, function, flags);
        self.depth -= 1;
    }
    fn visit_arrow_function_expression(&mut self, function: &ArrowFunctionExpression<'a>) {
        self.depth += 1;
        walk::walk_arrow_function_expression(self, function);
        self.depth -= 1;
    }
}
