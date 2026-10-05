//! Captured values of inline callbacks: `list(...)` render callbacks and function props of views.
//!
//! An inline callback is a new function on every render, so the renderer cannot tell by
//! identity whether it would behave differently. Views are pure functions of immutable
//! snapshots: a callback does the same thing as long as every outer value it reads is the
//! same. The compiler records those values next to the callback: the renderer reruns unchanged
//! rows only when one of them differs, and treats a function prop as unchanged while they are
//! the same. A callback this analysis cannot describe is left alone and keeps being compared
//! by identity.
use oxc::{
    ast::ast::*,
    ast_visit::{Visit, walk},
    semantic::Scoping,
    span::{GetSpan, Span},
    syntax::symbol::SymbolId,
};

/// A captured binding and the static member path read from it.
type Path = (String, Vec<String>);

struct Captures<'s> {
    scoping: &'s Scoping,
    callback: Span,
    call_start: u32,
    paths: Vec<Path>,
    unknown: bool,
}
impl Captures<'_> {
    fn record(&mut self, id: &IdentifierReference<'_>, members: Vec<String>) {
        if matches!(id.name.as_str(), "arguments" | "eval") {
            self.unknown = true;
            return;
        }
        // An unresolved name is a global.
        let Some(symbol) = id
            .reference_id
            .get()
            .and_then(|id| self.scoping.get_reference(id).symbol_id())
        else {
            return;
        };
        let declared = self.scoping.symbol_span(symbol);
        if self.callback.contains_inclusive(declared) {
            return;
        }
        let mutated = self.scoping.symbol_is_mutated(symbol);
        if self.scoping.symbol_scope_id(symbol) == self.scoping.root_scope_id() {
            // Module bindings are constant across renders unless something reassigns them.
            if !mutated {
                return;
            }
        } else if mutated
            || (declared.start >= self.call_start
                && !self.scoping.symbol_flags(symbol).is_function())
        {
            // A reassigned local has no single value to compare, and a binding declared after
            // the call cannot be read where the call is evaluated.
            self.unknown = true;
            return;
        }
        let path = (id.name.to_string(), members);
        if !self.paths.contains(&path) {
            self.paths.push(path);
        }
    }
    /// `a.b.c` as its base binding and member names, when every step is a static member.
    fn chain<'b, 'a>(
        member: &'b StaticMemberExpression<'a>,
    ) -> Option<(&'b IdentifierReference<'a>, Vec<String>)> {
        let mut members = vec![member.property.name.to_string()];
        let mut object = &member.object;
        loop {
            match object {
                Expression::StaticMemberExpression(inner) => {
                    members.push(inner.property.name.to_string());
                    object = &inner.object;
                }
                Expression::Identifier(id) => {
                    members.reverse();
                    return Some((id, members));
                }
                _ => return None,
            }
        }
    }
    /// A called member reads its receiver: `rows.filter(...)` depends on `rows`, not on the
    /// `filter` function. Returns whether the callee was handled.
    fn callee(&mut self, callee: &Expression<'_>) -> bool {
        if let Expression::StaticMemberExpression(member) = callee.get_inner_expression()
            && let Some((id, mut members)) = Self::chain(member)
        {
            members.pop();
            self.record(id, members);
            return true;
        }
        false
    }
}
impl Captures<'_> {
    /// Source text of the captured values.
    fn values(&self) -> Vec<String> {
        // A path that extends another recorded path of the same binding adds nothing.
        let paths = &self.paths;
        paths
            .iter()
            .filter(|(name, members)| {
                !paths.iter().any(|(other, prefix)| {
                    other == name && prefix.len() < members.len() && members.starts_with(prefix)
                })
            })
            .map(|(name, members)| {
                // Optional steps: evaluating the value must not throw where the callback,
                // which may guard its reads, would not have run.
                std::iter::once(name.clone())
                    .chain(members.iter().cloned())
                    .collect::<Vec<_>>()
                    .join("?.")
            })
            .collect()
    }
}
impl<'a> Visit<'a> for Captures<'_> {
    fn visit_ts_type(&mut self, _: &TSType<'a>) {}
    fn visit_this_expression(&mut self, _: &ThisExpression) {
        self.unknown = true;
    }
    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        self.record(id, vec![]);
    }
    fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
        match Self::chain(member) {
            Some((id, members)) => self.record(id, members),
            None => walk::walk_static_member_expression(self, member),
        }
    }
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.callee(&call.callee) {
            for argument in &call.arguments {
                self.visit_argument(argument);
            }
        } else {
            walk::walk_call_expression(self, call);
        }
    }
    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if self.callee(&tagged.tag) {
            self.visit_template_literal(&tagged.quasi);
        } else {
            walk::walk_tagged_template_expression(self, tagged);
        }
    }
}

struct Lists<'s> {
    scoping: &'s Scoping,
    lists: Vec<SymbolId>,
    /// Where to append the captured values, and their source text.
    insertions: Vec<(Span, String)>,
    /// Hoisted declarations identifying each function-prop site.
    sites: Vec<String>,
    prefix: &'s str,
    runtime: &'s str,
}
impl<'a> Visit<'a> for Lists<'_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        walk::walk_call_expression(self, call);
        let Expression::Identifier(id) = &call.callee else {
            return;
        };
        let listed = id
            .reference_id
            .get()
            .and_then(|id| self.scoping.get_reference(id).symbol_id())
            .is_some_and(|symbol| self.lists.contains(&symbol));
        if !listed || !matches!(call.arguments.len(), 2 | 3) {
            return;
        }
        if call
            .arguments
            .iter()
            .any(|argument| matches!(argument, Argument::SpreadElement(_)))
        {
            return;
        }
        let Some(Argument::ArrowFunctionExpression(callback)) = call.arguments.last() else {
            return;
        };
        let mut captures = Captures {
            scoping: self.scoping,
            callback: callback.span,
            call_start: call.span.start,
            paths: vec![],
            unknown: false,
        };
        captures.visit_arrow_function_expression(callback);
        if captures.unknown {
            return;
        }
        let site = format!("{}c{}", self.prefix, self.sites.len());
        self.sites.push(format!("const {site}=Symbol();"));
        let mut values = captures.values();
        values.insert(0, site);
        // Defaults and rest parameters do not contribute to Function.length.
        let index_used = callback.params.items.len() >= 2 || callback.params.rest.is_some();
        let end = callback.span().end;
        self.insertions.push((
            Span::new(end, end),
            format!(",[{}],{index_used}", values.join(",")),
        ));
    }
    /// `<Row onPick={(id) => pick(row, id)} />`: a function prop of a view is a new function on
    /// every render and would make the view run every time. Marked with the values it reads,
    /// it counts as unchanged while they are the same.
    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        walk::walk_jsx_opening_element(self, element);
        if !matches!(
            element.name,
            JSXElementName::IdentifierReference(_) | JSXElementName::MemberExpression(_)
        ) {
            return;
        }
        for attribute in &element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(Expression::ArrowFunctionExpression(callback)) =
                container.expression.as_expression()
            else {
                continue;
            };
            if callback.r#async {
                continue;
            }
            let mut captures = Captures {
                scoping: self.scoping,
                callback: callback.span,
                call_start: callback.span.start,
                paths: vec![],
                unknown: false,
            };
            captures.visit_arrow_function_expression(callback);
            if captures.unknown {
                continue;
            }
            // Two callbacks reading the same values are the same function only at one site.
            let site = format!("{}c{}", self.prefix, self.sites.len());
            self.sites.push(format!("const {site}=Symbol();"));
            let mut values = captures.values();
            values.insert(0, site);
            let span = callback.span;
            self.insertions.push((
                Span::new(span.start, span.start),
                format!("{}.captured(", self.runtime),
            ));
            self.insertions.push((
                Span::new(span.end, span.end),
                format!(",[{}])", values.join(",")),
            ));
        }
    }
}

/// Insertions that record the captured values of inline `list(...)` callbacks and of function
/// props of views, and the hoisted declarations those insertions refer to.
pub fn insertions(
    program: &Program<'_>,
    scoping: &Scoping,
    import_source: &str,
    prefix: &str,
    runtime: &str,
) -> (Vec<(Span, String)>, Vec<String>) {
    let mut lists = vec![];
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        if import.source.value != import_source || import.import_kind.is_type() {
            continue;
        }
        for specifier in import.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
                && specifier.imported.name() == "list"
                && let Some(symbol) = specifier.local.symbol_id.get()
            {
                lists.push(symbol);
            }
        }
    }
    let mut visitor = Lists {
        scoping,
        lists,
        insertions: vec![],
        sites: vec![],
        prefix,
        runtime,
    };
    visitor.visit_program(program);
    (visitor.insertions, visitor.sites)
}
