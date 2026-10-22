//! Development-only callback locations for opt-in runtime attribution.
use oxc::{
    ast::ast::*,
    ast_visit::{Visit, walk},
    semantic::Scoping,
    span::{GetSpan, Span},
    syntax::symbol::SymbolId,
};
use std::collections::HashMap;
struct Sites<'s> {
    scoping: &'s Scoping,
    imports: HashMap<SymbolId, usize>,
    source: &'s str,
    file: &'s str,
    runtime: &'s str,
    edits: Vec<(Span, String)>,
}
impl<'a> Visit<'a> for Sites<'_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Expression::Identifier(id) = call.callee.get_inner_expression()
            && let Some(symbol) = id
                .reference_id
                .get()
                .and_then(|r| self.scoping.get_reference(r).symbol_id())
            && let Some(index) = self.imports.get(&symbol)
            && let Some(argument) = call.arguments.get(*index)
            && !matches!(argument, Argument::SpreadElement(_))
        {
            let span = argument.span();
            let position = crate::lower::diagnostic(self.source, self.file, span, "");
            let expression: String = self.source[span.start as usize..span.end as usize]
                .chars()
                .take(160)
                .collect();
            let metadata = serde_json::json!({"file":self.file,"line":position.line,"column":position.column,"expression":expression});
            self.edits.push((
                Span::new(span.start, span.start),
                format!("{}.profileFunction(", self.runtime),
            ));
            self.edits
                .push((Span::new(span.end, span.end), format!(",{metadata})")));
        }
        walk::walk_call_expression(self, call);
    }
}
pub fn insertions(
    program: &Program<'_>,
    scoping: &Scoping,
    import_source: &str,
    source: &str,
    file: &str,
    runtime: &str,
) -> Vec<(Span, String)> {
    let mut imports = HashMap::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        if import.source.value != import_source || import.import_kind.is_type() {
            continue;
        }
        for specifier in import.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
                && let Some(symbol) = specifier.local.symbol_id.get()
            {
                let index = match specifier.imported.name().as_str() {
                    "view" | "domMount" => 0,
                    "mapSource" | "domBinding" => 1,
                    _ => continue,
                };
                imports.insert(symbol, index);
            }
        }
    }
    let mut visitor = Sites {
        scoping,
        imports,
        source,
        file,
        runtime,
        edits: vec![],
    };
    visitor.visit_program(program);
    visitor.edits
}
