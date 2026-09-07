//! Resolve source identities once. Generated expressions never reparse or rename user bindings.
use oxc::{
    ast::{AstKind, ast::*},
    ast_visit::Visit,
    semantic::Scoping,
    span::{GetSpan, Span},
    syntax::symbol::SymbolId,
};
use std::collections::{HashMap, HashSet};

fn unwrapped<'a>(mut expression: &'a Expression<'a>) -> &'a Expression<'a> {
    loop {
        expression = match expression {
            Expression::ParenthesizedExpression(node) => &node.expression,
            Expression::TSAsExpression(node) => &node.expression,
            Expression::TSSatisfiesExpression(node) => &node.expression,
            Expression::TSNonNullExpression(node) => &node.expression,
            _ => return expression,
        };
    }
}

fn method<'a>(expression: &'a Expression<'a>) -> Option<(&'a Expression<'a>, &'a str)> {
    match unwrapped(expression) {
        Expression::StaticMemberExpression(member) => {
            Some((&member.object, member.property.name.as_str()))
        }
        Expression::ComputedMemberExpression(member) => member
            .static_property_name()
            .map(|name| (&member.object, name.as_str())),
        _ => None,
    }
}

const ARRAY_MUTATORS: &[&str] = &[
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "copyWithin",
    "fill",
];

#[derive(Clone)]
pub struct Reference {
    pub span: Span,
    pub symbol: Option<SymbolId>,
    pub name: String,
    pub shorthand: bool,
    pub path: Vec<String>,
    pub label: String,
    pub safe_date: bool,
    pub in_event: bool,
    pub in_action: bool,
}
pub struct Index<'a, 's> {
    pub scoping: &'s Scoping,
    pub refs: Vec<Reference>,
    pub calls: Vec<&'a CallExpression<'a>>,
    pub bindings: Vec<(Span, SymbolId, String)>,
    pub violations: Vec<(Span, String)>,
    pub helpers: HashMap<SymbolId, Span>,
    pub initializers: HashMap<SymbolId, &'a Expression<'a>>,
    pub callback_mutations: Vec<(&'a Expression<'a>, Span, &'a str)>,
    pub global_calls: Vec<(Span, String)>,
    pub render_inputs: Vec<(Span, Vec<SymbolId>)>,
    parents: Vec<AstKind<'a>>,
}
impl<'a, 's> Index<'a, 's> {
    pub fn new(scoping: &'s Scoping) -> Self {
        Self {
            scoping,
            refs: vec![],
            calls: vec![],
            bindings: vec![],
            violations: vec![],
            helpers: HashMap::new(),
            initializers: HashMap::new(),
            callback_mutations: vec![],
            global_calls: vec![],
            render_inputs: vec![],
            parents: vec![],
        }
    }
    pub fn references(&self, span: Span) -> impl Iterator<Item = &Reference> {
        let start = self.refs.partition_point(|r| r.span.start < span.start);
        self.refs[start..]
            .iter()
            .take_while(move |r| r.span.end <= span.end)
    }
    pub fn symbol(&self, id: &IdentifierReference<'_>) -> Option<SymbolId> {
        id.reference_id
            .get()
            .and_then(|id| self.scoping.get_reference(id).symbol_id())
    }
    // Only callbacks inside onX attributes execute as events. Attribute factories and
    // ordinary render callbacks still obey render-purity rules.
    fn event_handler(&self) -> Option<&'a ArrowFunctionExpression<'a>> {
        let (position, attribute) =
            self.parents
                .iter()
                .enumerate()
                .rev()
                .find_map(|(i, node)| {
                    if let AstKind::JSXAttribute(attribute) = node {
                        Some((i, attribute))
                    } else {
                        None
                    }
                })?;
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            return None;
        };
        if !name.name.starts_with("on")
            || !name
                .name
                .chars()
                .nth(2)
                .is_some_and(|c| c.is_ascii_uppercase())
        {
            return None;
        }
        self.parents[position + 1..].iter().find_map(|node| {
            if let AstKind::ArrowFunctionExpression(function) = node {
                (!contains_jsx_body(&function.body)).then_some(*function)
            } else {
                None
            }
        })
    }
    fn callback_prop(&self) -> bool {
        self.parents.iter().rev().find_map(|node| {
            let AstKind::JSXAttribute(attribute) = node else { return None; };
            Some(matches!(&attribute.value,
                Some(JSXAttributeValue::ExpressionContainer(container))
                    if matches!(container.expression.as_expression(),
                        Some(Expression::ArrowFunctionExpression(function)) if !contains_jsx_body(&function.body))))
        }).unwrap_or(false)
    }
    fn event_dom_node(&self, expression: &Expression<'a>) -> bool {
        let Some(handler) = self.event_handler() else {
            return false;
        };
        let Some(parameter) = handler.params.items.first() else {
            return false;
        };
        let BindingPattern::BindingIdentifier(parameter) = &parameter.pattern else {
            return false;
        };
        let Expression::StaticMemberExpression(member) = unwrapped(expression) else {
            return false;
        };
        matches!(member.property.name.as_str(), "currentTarget" | "target")
            && matches!(unwrapped(&member.object), Expression::Identifier(id) if self.symbol(id) == parameter.symbol_id.get())
    }
    pub fn binding_names(&self, span: Span) -> Vec<(SymbolId, String)> {
        self.bindings
            .iter()
            .filter(|(s, _, _)| s.start >= span.start && s.end <= span.end)
            .map(|(_, id, name)| (*id, name.clone()))
            .collect()
    }

    /// Follow borrowed member reads and destructuring aliases, never fresh allocations.
    pub fn borrows(
        &self,
        expression: &Expression<'a>,
        roots: &HashSet<SymbolId>,
        seen: &mut HashSet<SymbolId>,
    ) -> bool {
        match unwrapped(expression) {
            Expression::Identifier(id) => self.symbol(id).is_some_and(|id| {
                roots.contains(&id)
                    || (seen.insert(id)
                        && self
                            .initializers
                            .get(&id)
                            .is_some_and(|value| self.borrows(value, roots, seen)))
            }),
            Expression::StaticMemberExpression(member) => self.borrows(&member.object, roots, seen),
            Expression::ComputedMemberExpression(member) => {
                self.borrows(&member.object, roots, seen)
            }
            _ => false,
        }
    }
}
impl<'a> Visit<'a> for Index<'a, '_> {
    fn visit_ts_type(&mut self, _: &TSType<'a>) {}
    fn enter_node(&mut self, kind: AstKind<'a>) {
        match kind {
            AstKind::ArrowFunctionExpression(function) if contains_jsx_body(&function.body) => {
                let mut names = BindingIds(vec![]);
                names.visit_formal_parameters(&function.params);
                self.render_inputs.push((function.span, names.0));
            }
            AstKind::VariableDeclarator(declaration) => {
                if let Some(init) = &declaration.init {
                    // Destructured bindings borrow from the same initializer too.
                    let mut names = BindingIds(vec![]);
                    names.visit_binding_pattern(&declaration.id);
                    for id in names.0 {
                        self.initializers.insert(id, init);
                        match unwrapped(init) {
                            Expression::ArrowFunctionExpression(function) => {
                                self.helpers.insert(id, function.span);
                            }
                            Expression::FunctionExpression(function) => {
                                self.helpers.insert(id, function.span);
                            }
                            _ => {}
                        }
                    }
                }
            }
            AstKind::Function(function) => {
                if let Some(id) = &function.id {
                    self.helpers
                        .insert(id.symbol_id.get().unwrap(), function.span);
                }
            }
            AstKind::IdentifierReference(id) => {
                let mut selected = id.span;
                let mut path = vec![];
                let mut label = id.name.to_string();
                for (index, parent) in self.parents.iter().enumerate().rev() {
                    let access = match parent {
                        AstKind::StaticMemberExpression(m) if m.object.span() == selected => {
                            Some((
                                m.span,
                                format!("?.{}", m.property.name),
                                format!(".{}", m.property.name),
                            ))
                        }
                        AstKind::ComputedMemberExpression(m) if m.object.span() == selected => {
                            match &m.expression {
                                Expression::StringLiteral(s) => {
                                    let p = serde_json::to_string(s.value.as_str()).unwrap();
                                    Some((m.span, format!("?.[{p}]"), format!("[{p}]")))
                                }
                                Expression::NumericLiteral(n) => Some((
                                    m.span,
                                    format!("?.[{}]", n.value),
                                    format!("[{}]", n.value),
                                )),
                                _ => None,
                            }
                        }
                        _ => None,
                    };
                    let Some((span, suffix, label_suffix)) = access else {
                        break;
                    };
                    // Parentheses and TS assertions preserve a member call's receiver.
                    // Depending on its method function instead would miss receiver changes.
                    let usage = self.parents[..index].iter().rev().find(|parent| {
                        !matches!(
                            parent,
                            AstKind::ParenthesizedExpression(_)
                                | AstKind::TSAsExpression(_)
                                | AstKind::TSSatisfiesExpression(_)
                                | AstKind::TSNonNullExpression(_)
                        )
                    });
                    if usage.is_some_and(|parent| matches!(parent, AstKind::CallExpression(call) if unwrapped(&call.callee).span() == span)) {
                        break;
                    }
                    selected = span;
                    path.push(suffix);
                    label.push_str(&label_suffix);
                }
                let shorthand=self.parents.iter().rev().any(|p| matches!(p,AstKind::ObjectProperty(p) if p.shorthand && p.value.span()==id.span));
                let safe_date = self.parents.last().is_some_and(|p| match p {
                    AstKind::NewExpression(n) => {
                        n.callee.span() == id.span && !n.arguments.is_empty()
                    }
                    AstKind::StaticMemberExpression(m) => {
                        m.object.span() == id.span
                            && matches!(m.property.name.as_str(), "UTC" | "parse")
                    }
                    _ => false,
                });
                self.refs.push(Reference {
                    span: id.span,
                    symbol: self.symbol(id),
                    name: id.name.to_string(),
                    shorthand,
                    path,
                    label,
                    safe_date,
                    in_event: self.event_handler().is_some(),
                    in_action: self.event_handler().is_some() || self.callback_prop(),
                });
            }
            AstKind::BindingIdentifier(id) => {
                if let Some(symbol) = id.symbol_id.get() {
                    self.bindings.push((id.span, symbol, id.name.to_string()));
                }
            }
            AstKind::CallExpression(call) => {
                self.calls.push(call);
                if let Some((receiver, method)) = method(&call.callee) {
                    let action = self.event_handler().is_some() || self.callback_prop();
                    // Mutating a freshly allocated array cannot change a borrowed snapshot.
                    // Named locals and method results need alias analysis; keep those checked.
                    let fresh_array = ARRAY_MUTATORS.contains(&method)
                        && matches!(unwrapped(receiver), Expression::ArrayExpression(_));
                    if !action
                        && !fresh_array
                        && (ARRAY_MUTATORS.contains(&method)
                            || ["set", "add", "delete", "clear"].contains(&method))
                    {
                        self.violations.push((call.span,format!("Views cannot call mutating method {method}. Use an immutable operation or a command.")));
                    }
                    if action && !fresh_array && ARRAY_MUTATORS.contains(&method) {
                        self.callback_mutations.push((receiver, call.span, method));
                    }
                    if !action
                        && method == "random"
                        && matches!(unwrapped(receiver),Expression::Identifier(i) if i.name=="Math" && self.symbol(i).is_none())
                    {
                        let violation = (
                            call.span,
                            "Read randomness in a command, then put its result in the model."
                                .into(),
                        );
                        self.global_calls.push(violation.clone());
                        self.violations.push(violation);
                    }
                }
            }
            AstKind::AssignmentExpression(n) if !matches!(&n.left, AssignmentTarget::StaticMemberExpression(member) if self.event_dom_node(&member.object)) => {
                self.violations.push((
                    n.span,
                    "Views do not mutate state. Dispatch a message and change the model in update."
                        .into(),
                ))
            }
            AstKind::UpdateExpression(n) => self.violations.push((
                n.span,
                "Views do not mutate state. Dispatch a message and change the model in update."
                    .into(),
            )),
            AstKind::UnaryExpression(n) if n.operator.as_str() == "delete" => self
                .violations
                .push((n.span, "Views do not mutate state.".into())),
            AstKind::AwaitExpression(n) => self
                .violations
                .push((n.span, "Async work belongs in commands.".into())),
            _ => {}
        }
        self.parents.push(kind);
    }
    fn leave_node(&mut self, _: AstKind<'a>) {
        self.parents.pop();
    }
}
struct BindingIds(Vec<SymbolId>);
impl<'a> Visit<'a> for BindingIds {
    fn visit_binding_identifier(&mut self, id: &BindingIdentifier<'a>) {
        self.0.push(id.symbol_id.get().unwrap());
    }
    fn visit_ts_type(&mut self, _: &TSType<'a>) {}
}
struct HasJsx(bool);
impl<'a> Visit<'a> for HasJsx {
    fn visit_jsx_element(&mut self, _: &JSXElement<'a>) {
        self.0 = true;
    }
    fn visit_jsx_fragment(&mut self, _: &JSXFragment<'a>) {
        self.0 = true;
    }
    fn visit_ts_type(&mut self, _: &TSType<'a>) {}
}
pub fn contains_jsx(expr: &Expression<'_>) -> bool {
    let mut v = HasJsx(false);
    v.visit_expression(expr);
    v.0
}
pub fn contains_jsx_body(body: &ArrowFunctionBody<'_>) -> bool {
    let mut v = HasJsx(false);
    v.visit_arrow_function_body(body);
    v.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc::{allocator::Allocator, parser::Parser, semantic::SemanticBuilder, span::SourceType};

    fn inspect(source: &str) -> (Vec<Reference>, Vec<(Span, String)>) {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        assert!(parsed.diagnostics.is_empty());
        let semantic = SemanticBuilder::new().build(&parsed.program);
        let mut index = Index::new(semantic.semantic.scoping());
        index.visit_program(&parsed.program);
        (index.refs, index.violations)
    }

    #[test]
    fn tracks_optional_properties_but_depends_on_method_receivers() {
        let (references, _) = inspect(
            "const read = model => [model.user?.name, model.items.map(row => row.visible), model.items?.filter?.(row => row.visible), model['user'][0].name, model.items[model.index]];",
        );
        let model_paths: Vec<_> = references
            .iter()
            .filter(|reference| reference.name == "model")
            .map(|reference| reference.path.join(""))
            .collect();
        assert_eq!(
            model_paths,
            [
                "?.user?.name",
                "?.items",
                "?.items",
                "?.[\"user\"]?.[0]?.name",
                "?.items",
                "?.index"
            ]
        );
    }

    #[test]
    fn preserves_receivers_through_parenthesized_and_asserted_method_calls() {
        let (references, violations) = inspect(
            "const read = model => [(model.items.filter)(row => row.visible), ((model.items.filter) as Function)(row => row.visible), (model.items.sort)()];",
        );
        let paths: Vec<_> = references
            .iter()
            .filter(|reference| reference.name == "model")
            .map(|reference| reference.path.join(""))
            .collect();
        assert_eq!(paths, ["?.items", "?.items", "?.items"]);
        assert_eq!(violations.len(), 1);
        assert!(violations[0].1.contains("sort"));
    }

    #[test]
    fn uses_binding_identity_for_shadowed_callback_inputs_and_shorthand() {
        let (references, _) = inspect(
            "const view = model => { const caption = <b>{model.title}</b>; const helper = model => ({ model, caption }); return helper(model); };",
        );
        let models: Vec<_> = references
            .iter()
            .filter(|reference| reference.name == "model")
            .collect();
        assert_eq!(models.len(), 3);
        assert_eq!(models[0].symbol, models[2].symbol);
        assert_ne!(models[0].symbol, models[1].symbol);
        assert!(!models[0].shorthand);
        assert!(models[1].shorthand);
    }

    #[test]
    fn ignores_type_references_and_distinguishes_event_factories_from_render_work() {
        let (references, violations) = inspect(
            "const view = (model: Model) => <button title={model.items.sort().length} onClick={() => model.service.set('x')}/>;",
        );
        assert!(references.iter().all(|reference| reference.name != "Model"));
        assert_eq!(violations.len(), 1);
        assert!(violations[0].1.contains("sort"));
    }

    #[test]
    fn permits_explicit_date_inputs_and_does_not_confuse_shadowed_math_with_globals() {
        let (references, violations) = inspect(
            "const read = (model, Math) => [new Date(model.timestamp), Date.parse(model.text), Date.now(), Math.random()];",
        );
        let date: Vec<_> = references
            .iter()
            .filter(|reference| reference.name == "Date")
            .map(|reference| reference.safe_date)
            .collect();
        assert_eq!(date, [true, true, false]);
        assert!(violations.is_empty());
    }
}
