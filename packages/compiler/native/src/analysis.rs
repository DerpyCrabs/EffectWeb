//! Lexical bindings for optional lint checks. This module does not participate in JSX compilation.
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
            Expression::TSInstantiationExpression(n) => &n.expression,
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
                self.refs.push(Reference {
                    span: id.span,
                    symbol: self.symbol(id),
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
pub fn contains_jsx_body(body: &ArrowFunctionBody<'_>) -> bool {
    let mut v = HasJsx(false);
    v.visit_arrow_function_body(body);
    v.0
}
