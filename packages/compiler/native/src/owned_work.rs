//! Lints for where work may start.
//!
//! - An `update` function is a pure transition: it returns commands and never runs anything
//!   itself, so calling a prop callback or `Effect.run*` in its body is reported, as is
//!   writing to the model it was given (EW1004).
//! - A finalizer of work run under `replace` runs after the newer run has started, so a
//!   `patch` in it overwrites the newer run's state (EW1005).
//! - `makeMount(…)` returns an Effect; called as a statement it mounts nothing (EW1006).
use oxc::{
    ast::ast::*,
    ast_visit::{Visit, walk},
    span::Span,
    syntax::scope::ScopeFlags,
};

#[derive(Default)]
pub struct OwnedWork {
    /// Calls an `update` makes itself instead of returning a command.
    pub impure: Vec<Span>,
    /// Writes an `update` makes to the model it was given.
    pub mutations: Vec<Span>,
    /// `patch`/`edit` calls in a finalizer of replaced work.
    pub finalizers: Vec<Span>,
    /// `makeMount(…)` calls whose Effect is discarded.
    pub discarded_mounts: Vec<Span>,
    hosts: Vec<String>,
    mounts: Vec<String>,
}
impl OwnedWork {
    pub fn new(program: &Program<'_>, import_source: &str) -> Self {
        let mut hosts = vec![];
        let mut mounts = vec![];
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            if import.source.value != import_source {
                continue;
            }
            for specifier in import.specifiers.iter().flatten() {
                if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                    match specifier.imported.name().as_str() {
                        "component" | "program" => hosts.push(specifier.local.name.to_string()),
                        "makeMount" => mounts.push(specifier.local.name.to_string()),
                        _ => {}
                    }
                }
            }
        }
        Self {
            hosts,
            mounts,
            ..Self::default()
        }
    }
}

fn member<'b, 'a>(expression: &'b Expression<'a>) -> Option<&'b StaticMemberExpression<'a>> {
    match expression.without_parentheses() {
        Expression::StaticMemberExpression(member) => Some(member),
        _ => None,
    }
}
fn named(expression: &Expression<'_>, name: &str) -> bool {
    matches!(expression.without_parentheses(), Expression::Identifier(id) if id.name == name)
}

/// The statements `update` runs itself; nested functions are commands or callbacks.
struct Transition<'s> {
    model: Option<&'s str>,
    found: Vec<Span>,
    mutations: Vec<Span>,
}
const MUTATORS: [&str; 9] = [
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
];
impl Transition<'_> {
    /// `model.a.b` or `model.a[i]`: a value reached from the model parameter.
    fn reads_model(&self, mut expression: &Expression<'_>) -> bool {
        loop {
            expression = match expression.without_parentheses() {
                Expression::StaticMemberExpression(member) => &member.object,
                Expression::ComputedMemberExpression(member) => &member.object,
                Expression::Identifier(id) => {
                    return self.model.is_some_and(|model| id.name == model);
                }
                _ => return false,
            };
        }
    }
}
impl<'a> Visit<'a> for Transition<'_> {
    fn visit_function(&mut self, _: &Function<'a>, _: ScopeFlags) {}
    fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        walk::walk_call_expression(self, call);
        let Some(callee) = member(&call.callee) else {
            return;
        };
        let prop_callback = self.model.is_some_and(|model| {
            member(&callee.object)
                .is_some_and(|props| props.property.name == "props" && named(&props.object, model))
        });
        let runs = named(&callee.object, "Effect") && callee.property.name.starts_with("run");
        if prop_callback || runs {
            self.found.push(call.span);
        } else if MUTATORS.contains(&callee.property.name.as_str())
            && self.reads_model(&callee.object)
        {
            self.mutations.push(call.span);
        }
    }
    fn visit_assignment_expression(&mut self, assignment: &AssignmentExpression<'a>) {
        walk::walk_assignment_expression(self, assignment);
        let object = match &assignment.left {
            AssignmentTarget::StaticMemberExpression(member) => &member.object,
            AssignmentTarget::ComputedMemberExpression(member) => &member.object,
            _ => return,
        };
        if self.reads_model(object) {
            self.mutations.push(assignment.span);
        }
    }
}

struct Finalizers {
    inside: bool,
    found: Vec<Span>,
}
impl<'a> Visit<'a> for Finalizers {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let finalizer = member(&call.callee).is_some_and(|callee| {
            named(&callee.object, "Effect")
                && matches!(
                    callee.property.name.as_str(),
                    "ensuring" | "onExit" | "onInterrupt"
                )
        });
        if self.inside {
            let writes = match call.callee.without_parentheses() {
                Expression::Identifier(id) => id.name == "patch",
                Expression::StaticMemberExpression(callee) => {
                    matches!(callee.property.name.as_str(), "patch" | "edit")
                }
                _ => false,
            };
            if writes {
                self.found.push(call.span);
            }
        }
        let outer = self.inside;
        self.inside |= finalizer;
        walk::walk_call_expression(self, call);
        self.inside = outer;
    }
}

impl<'a> Visit<'a> for OwnedWork {
    fn visit_expression_statement(&mut self, statement: &ExpressionStatement<'a>) {
        walk::walk_expression_statement(self, statement);
        let mut expression = statement.expression.without_parentheses();
        if let Expression::UnaryExpression(unary) = expression
            && unary.operator == UnaryOperator::Void
        {
            expression = unary.argument.without_parentheses();
        }
        if let Expression::CallExpression(call) = expression
            && matches!(call.callee.without_parentheses(), Expression::Identifier(id)
                if self.mounts.iter().any(|name| name == id.name.as_str()))
        {
            self.discarded_mounts.push(call.span);
        }
    }
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        walk::walk_call_expression(self, call);
        if matches!(call.callee.without_parentheses(), Expression::Identifier(id)
            if self.hosts.iter().any(|host| host == id.name.as_str()))
            && let Some(Expression::ObjectExpression(definition)) =
                call.arguments.first().and_then(Argument::as_expression)
        {
            for property in &definition.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    continue;
                };
                if !property.key.is_specific_static_name("update") {
                    continue;
                }
                let params = match property.value.without_parentheses() {
                    Expression::ArrowFunctionExpression(function) => &function.params,
                    Expression::FunctionExpression(function) => &function.params,
                    _ => continue,
                };
                let model = params.items.first().and_then(|parameter| {
                    parameter
                        .pattern
                        .get_binding_identifier()
                        .map(|id| id.name.as_str())
                });
                let mut transition = Transition {
                    model,
                    found: vec![],
                    mutations: vec![],
                };
                match property.value.without_parentheses() {
                    Expression::ArrowFunctionExpression(function) => {
                        transition.visit_arrow_function_body(&function.body);
                    }
                    Expression::FunctionExpression(function) => {
                        if let Some(body) = &function.body {
                            transition.visit_function_body(body);
                        }
                    }
                    _ => {}
                }
                self.impure.append(&mut transition.found);
                self.mutations.append(&mut transition.mutations);
            }
        }
        if member(&call.callee).is_some_and(|callee| callee.property.name == "run")
            && call.arguments.len() == 3
            && matches!(call.arguments[2].as_expression().map(Expression::without_parentheses),
                Some(Expression::StringLiteral(policy)) if policy.value == "replace")
        {
            let mut finalizers = Finalizers {
                inside: false,
                found: vec![],
            };
            finalizers.visit_argument(&call.arguments[1]);
            self.finalizers.append(&mut finalizers.found);
        }
    }
}
