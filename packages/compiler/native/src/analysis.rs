//! Index syntax and binding identities. Semantic decisions belong to semantics.rs.
use oxc::{
    ast::{AstKind, ast::*},
    ast_visit::Visit,
    semantic::Scoping,
    span::{GetSpan, Span},
    syntax::symbol::SymbolId,
};
use std::collections::HashMap;
fn unwrapped<'a>(mut expression: &'a Expression<'a>) -> &'a Expression<'a> {
    loop {
        expression = match expression {
            Expression::ParenthesizedExpression(n) => &n.expression,
            Expression::TSAsExpression(n) => &n.expression,
            Expression::TSSatisfiesExpression(n) => &n.expression,
            Expression::TSNonNullExpression(n) => &n.expression,
            _ => return expression,
        };
    }
}
// Collect only immutable direct aliases. Resolve before reference classification so
// factory declarations may follow helpers without making source order significant.
pub fn resolve_host_aliases<'a>(
    program: &'a Program<'a>,
    scoping: &Scoping,
    hosts: &mut HashMap<SymbolId, usize>,
) {
    struct Aliases<'s> {
        scoping: &'s Scoping,
        bindings: Vec<(SymbolId, SymbolId)>,
    }
    impl<'a> Visit<'a> for Aliases<'_> {
        fn visit_variable_declarator(&mut self, node: &VariableDeclarator<'a>) {
            if let BindingPattern::BindingIdentifier(binding) = &node.id
                && let Some(Expression::Identifier(input)) = node.init.as_ref().map(unwrapped)
                && let Some(id) = binding.symbol_id.get()
                && self.scoping.symbol_flags(id).is_const_variable()
                && !self.scoping.symbol_is_mutated(id)
                && let Some(input) = input
                    .reference_id
                    .get()
                    .and_then(|id| self.scoping.get_reference(id).symbol_id())
            {
                self.bindings.push((id, input));
            }
            oxc::ast_visit::walk::walk_variable_declarator(self, node);
        }
    }
    let mut aliases = Aliases {
        scoping,
        bindings: vec![],
    };
    aliases.visit_program(program);
    loop {
        let before = hosts.len();
        for (id, input) in &aliases.bindings {
            if let Some(argument) = hosts.get(input).copied() {
                hosts.insert(*id, argument);
            }
        }
        if hosts.len() == before {
            break;
        }
    }
}

#[derive(Clone)]
pub struct Reference {
    pub span: Span,
    pub symbol: Option<SymbolId>,
    pub name: String,
    pub shorthand: bool,
    pub path: Vec<String>,
    pub label: String,
}
pub struct Index<'a, 's> {
    pub scoping: &'s Scoping,
    pub refs: Vec<Reference>,
    pub calls: Vec<&'a CallExpression<'a>>,
    pub bindings: Vec<(Span, SymbolId, String)>,
    pub initializers: HashMap<SymbolId, &'a Expression<'a>>,
    pub declarators: HashMap<SymbolId, &'a VariableDeclarator<'a>>,
    pub functions: HashMap<SymbolId, &'a Function<'a>>,
    pub writes: Vec<Span>,
    pub(super) imports: HashMap<SymbolId, (String, Vec<String>)>,
    pub jsx: Vec<Span>,
    pub compiled_views: Vec<Span>,
    pub type_annotations: HashMap<SymbolId, &'a TSType<'a>>,
    pub type_aliases: HashMap<SymbolId, &'a TSType<'a>>,
    pub interfaces: HashMap<SymbolId, &'a TSInterfaceDeclaration<'a>>,
    parents: Vec<AstKind<'a>>,
}
impl<'a, 's> Index<'a, 's> {
    pub fn new(scoping: &'s Scoping) -> Self {
        Self {
            scoping,
            refs: vec![],
            calls: vec![],
            bindings: vec![],
            initializers: HashMap::new(),
            declarators: HashMap::new(),
            functions: HashMap::new(),
            writes: vec![],
            imports: HashMap::new(),
            jsx: vec![],
            compiled_views: vec![],
            type_annotations: HashMap::new(),
            type_aliases: HashMap::new(),
            interfaces: HashMap::new(),
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
    pub fn binding_names(&self, span: Span) -> Vec<(SymbolId, String)> {
        self.bindings
            .iter()
            .filter(|(s, _, _)| span.contains_inclusive(*s))
            .map(|(_, id, name)| (*id, name.clone()))
            .collect()
    }
    pub fn uncompiled_jsx(&self, span: Span) -> bool {
        self.jsx.iter().any(|jsx| {
            span.contains_inclusive(*jsx)
                && !self
                    .compiled_views
                    .iter()
                    .any(|view| view.contains_inclusive(*jsx))
        })
    }
}
impl<'a> Visit<'a> for Index<'a, '_> {
    fn visit_ts_type(&mut self, _: &TSType<'a>) {}
    fn enter_node(&mut self, kind: AstKind<'a>) {
        match kind {
            AstKind::ImportDeclaration(import) if !import.import_kind.is_type() => {
                for specifier in import.specifiers.iter().flatten() {
                    let (id, path) = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(specifier)
                            if !specifier.import_kind.is_type() =>
                        {
                            (
                                specifier.local.symbol_id.get().unwrap(),
                                vec![specifier.imported.name().to_string()],
                            )
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                            (specifier.local.symbol_id.get().unwrap(), vec![])
                        }
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => (
                            specifier.local.symbol_id.get().unwrap(),
                            vec!["default".into()],
                        ),
                        _ => continue,
                    };
                    self.imports
                        .insert(id, (import.source.value.to_string(), path));
                }
            }
            AstKind::JSXElement(element) => self.jsx.push(element.span),
            AstKind::JSXFragment(fragment) => self.jsx.push(fragment.span),
            AstKind::TSTypeAliasDeclaration(declaration) => {
                if declaration.type_parameters.is_none() {
                    self.type_aliases.insert(
                        declaration.id.symbol_id.get().unwrap(),
                        &declaration.type_annotation,
                    );
                }
            }
            AstKind::TSInterfaceDeclaration(declaration) => {
                if declaration.type_parameters.is_none() && declaration.extends.is_empty() {
                    self.interfaces
                        .insert(declaration.id.symbol_id.get().unwrap(), declaration);
                }
            }
            AstKind::FormalParameter(parameter) => {
                if let BindingPattern::BindingIdentifier(id) = &parameter.pattern
                    && let Some(annotation) = &parameter.type_annotation
                {
                    self.type_annotations
                        .insert(id.symbol_id.get().unwrap(), &annotation.type_annotation);
                }
            }
            AstKind::VariableDeclarator(declaration) => {
                if let BindingPattern::BindingIdentifier(id) = &declaration.id
                    && let Some(annotation) = &declaration.type_annotation
                {
                    self.type_annotations
                        .insert(id.symbol_id.get().unwrap(), &annotation.type_annotation);
                }
                if let Some(init) = &declaration.init {
                    // Destructured bindings borrow from the same initializer too.
                    let mut names = BindingIds(vec![]);
                    names.visit_binding_pattern(&declaration.id);
                    for id in names.0 {
                        self.declarators.insert(id, declaration);
                        self.initializers.insert(id, init);
                    }
                }
            }
            AstKind::Function(function) => {
                if let Some(id) = &function.id {
                    self.functions.insert(id.symbol_id.get().unwrap(), function);
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
                self.refs.push(Reference {
                    span: id.span,
                    symbol: self.symbol(id),
                    name: id.name.to_string(),
                    shorthand,
                    path,
                    label,
                });
            }
            AstKind::BindingIdentifier(id) => {
                if let Some(symbol) = id.symbol_id.get() {
                    self.bindings.push((id.span, symbol, id.name.to_string()));
                }
            }
            AstKind::CallExpression(call) => self.calls.push(call),
            AstKind::AssignmentExpression(n) => self.writes.push(n.left.span()),
            AstKind::UpdateExpression(n) => self.writes.push(n.argument.span()),
            AstKind::UnaryExpression(n) if n.operator.as_str() == "delete" => {
                self.writes.push(n.argument.span())
            }
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
        (index.refs, vec![])
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
        let (references, _) = inspect(
            "const read = model => [(model.items.filter)(row => row.visible), ((model.items.filter) as Function)(row => row.visible), (model.items.sort)()];",
        );
        let paths: Vec<_> = references
            .iter()
            .filter(|reference| reference.name == "model")
            .map(|reference| reference.path.join(""))
            .collect();
        assert_eq!(paths, ["?.items", "?.items", "?.items"]);
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
        let (references, _) = inspect(
            "const view = (model: Model) => <button title={model.items.sort().length} onClick={() => model.service.set('x')}/>;",
        );
        assert!(references.iter().all(|reference| reference.name != "Model"));
    }

    #[test]
    fn retains_global_and_shadowed_binding_identity() {
        let (references, _) = inspect(
            "const read = (model, Math) => [new Date(model.timestamp), Date.parse(model.text), Date.now(), Math.random()];",
        );
        assert!(
            references
                .iter()
                .filter(|r| r.name == "Date")
                .all(|r| r.symbol.is_none())
        );
        assert!(
            references
                .iter()
                .filter(|r| r.name == "Math")
                .all(|r| r.symbol.is_some())
        );
    }
}
