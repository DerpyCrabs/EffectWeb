//! Same-file data flow for finalizers of replaceable work. Never loads consumer imports.
use crate::analysis::Index;
use oxc::{ast::ast::*, ast_visit::Visit, span::Span, syntax::symbol::SymbolId};
use std::collections::{HashMap, HashSet};

pub fn check(index: &Index<'_, '_>) -> Vec<Span> {
    let mut found = vec![];
    for call in &index.calls {
        let mut analyzer = Analyzer {
            index,
            arguments: HashMap::new(),
            active: HashSet::new(),
            replacing: false,
            finalizing: false,
            // Recursive helpers and cyclic aliases must not make lint unbounded.
            remaining: 2048,
            found: &mut found,
        };
        analyzer.visit_call_expression(call);
    }
    found.sort_by_key(|span| span.start);
    found.dedup();
    found
}

struct Analyzer<'a, 'i, 's, 'f> {
    index: &'i Index<'a, 's>,
    arguments: HashMap<SymbolId, &'a Expression<'a>>,
    active: HashSet<SymbolId>,
    replacing: bool,
    finalizing: bool,
    remaining: usize,
    found: &'f mut Vec<Span>,
}

impl<'a> Analyzer<'a, '_, '_, '_> {
    fn binding(&self, id: SymbolId) -> Option<&'a Expression<'a>> {
        self.arguments.get(&id).copied().or_else(|| {
            if self.index.scoping.symbol_is_mutated(id) {
                return None;
            }
            // A destructured variable is not an alias for its entire initializer.
            self.index.declarators.get(&id).and_then(|declaration| {
                matches!(declaration.id, BindingPattern::BindingIdentifier(_))
                    .then(|| self.index.initializers.get(&id).copied())
                    .flatten()
            })
        })
    }

    fn resolve<'e>(&self, expression: &'e Expression<'a>) -> &'e Expression<'a>
    where
        'a: 'e,
    {
        let mut expression = expression.without_parentheses();
        let mut seen = HashSet::new();
        while let Expression::Identifier(id) = expression {
            let Some(symbol) = self.index.symbol(id) else {
                break;
            };
            if !seen.insert(symbol) {
                break;
            }
            let Some(value) = self.binding(symbol) else {
                break;
            };
            expression = value.without_parentheses();
        }
        expression
    }

    fn effect_member(&self, expression: &Expression<'a>) -> Option<String> {
        let expression = self.resolve(expression);
        match expression {
            Expression::Identifier(id) => {
                let (module, path) = self.index.imports.get(&self.index.symbol(id)?)?;
                match (module.as_str(), path.as_slice()) {
                    ("effect/Effect", [name]) => Some(name.clone()),
                    _ => None,
                }
            }
            Expression::StaticMemberExpression(member) => {
                let Expression::Identifier(id) = self.resolve(&member.object) else {
                    return None;
                };
                let (module, path) = self.index.imports.get(&self.index.symbol(id)?)?;
                if (module == "effect" && path == &["Effect"])
                    || (module == "effect/Effect" && path.is_empty())
                {
                    Some(member.property.name.to_string())
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn invoke(&mut self, call: &'a CallExpression<'a>, symbol: SymbolId) -> bool {
        if self.index.scoping.symbol_is_mutated(symbol) || !self.active.insert(symbol) {
            return false;
        }
        let value = self.binding(symbol).map(|value| self.resolve(value));
        let function_symbol = match value {
            Some(Expression::Identifier(id)) => self.index.symbol(id).unwrap_or(symbol),
            _ => symbol,
        };
        let function = self.index.functions.get(&function_symbol).copied();
        let arrow = match value {
            Some(Expression::ArrowFunctionExpression(f)) => Some(f.as_ref()),
            _ => None,
        };
        let function = match value {
            Some(Expression::FunctionExpression(f)) => Some(f.as_ref()),
            _ => function,
        };
        let params = if let Some(f) = arrow {
            &f.params
        } else if let Some(f) = function {
            &f.params
        } else {
            self.active.remove(&symbol);
            return false;
        };
        let previous = self.arguments.clone();
        for (parameter, argument) in params.items.iter().zip(&call.arguments) {
            if let Some(id) = parameter.pattern.get_binding_identifier()
                && let Some(value) = argument.as_expression()
            {
                self.arguments.insert(id.symbol_id.get().unwrap(), value);
            }
        }
        if let Some(f) = arrow {
            self.visit_arrow_function_body(&f.body);
        } else if let Some(f) = function
            && let Some(body) = &f.body
        {
            self.visit_function_body(body);
        }
        self.arguments = previous;
        self.active.remove(&symbol);
        true
    }
}

impl<'a> Visit<'a> for Analyzer<'a, '_, '_, '_> {
    fn visit_ts_type(&mut self, _: &TSType<'a>) {}

    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        if !self.replacing || self.remaining == 0 {
            return;
        }
        let Some(symbol) = self.index.symbol(id) else {
            return;
        };
        if !self.active.insert(symbol) {
            return;
        }
        if let Some(value) = self.binding(symbol) {
            self.remaining -= 1;
            self.visit_expression(value);
        } else if let Some(function) = self.index.functions.get(&symbol)
            && let Some(body) = &function.body
        {
            self.remaining -= 1;
            self.visit_function_body(body);
        }
        self.active.remove(&symbol);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.remaining == 0 {
            return;
        }
        self.remaining -= 1;
        let effect = self.effect_member(&call.callee);
        if self.replacing && self.finalizing {
            let writes = match call.callee.without_parentheses() {
                Expression::Identifier(id) => matches!(id.name.as_str(), "patch" | "edit"),
                Expression::StaticMemberExpression(member) => {
                    matches!(member.property.name.as_str(), "patch" | "edit")
                }
                _ => false,
            };
            if writes {
                self.found.push(call.span);
            }
        }
        if let Expression::StaticMemberExpression(member) = call.callee.without_parentheses()
            && matches!(member.property.name.as_str(), "run" | "task")
            && call.arguments.len() == 3
        {
            let previous = (self.replacing, self.finalizing);
            self.replacing = call.arguments[2].as_expression().is_some_and(|policy|
                matches!(self.resolve(policy), Expression::StringLiteral(value) if value.value == "replace"));
            self.finalizing = false;
            self.visit_argument(&call.arguments[1]);
            (self.replacing, self.finalizing) = previous;
            return;
        }
        if let Expression::Identifier(id) = call.callee.without_parentheses()
            && let Some(symbol) = self.index.symbol(id)
            && let Some(indexed) = self
                .index
                .calls
                .iter()
                .find(|indexed| indexed.span == call.span)
            && self.invoke(indexed, symbol)
        {
            return;
        }
        if self.replacing
            && effect
                .as_deref()
                .is_some_and(|name| matches!(name, "ensuring" | "onExit" | "onInterrupt"))
        {
            // Both Effect.ensuring(work, cleanup) and work.pipe(Effect.ensuring(cleanup)).
            let last = call.arguments.len().saturating_sub(1);
            for (i, argument) in call.arguments.iter().enumerate() {
                let previous = self.finalizing;
                self.finalizing |= i == last;
                self.visit_argument(argument);
                self.finalizing = previous;
            }
        } else {
            // Only pipe's receiver is the Effect being composed. Following an arbitrary
            // receiver (e.g. form.reset) would inspect unrelated callbacks in its config.
            if let Expression::StaticMemberExpression(member) = call.callee.without_parentheses()
                && member.property.name == "pipe"
            {
                self.visit_expression(&member.object);
            }
            for argument in &call.arguments {
                self.visit_argument(argument);
            }
        }
    }
}
