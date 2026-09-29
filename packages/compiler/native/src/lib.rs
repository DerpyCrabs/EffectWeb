mod analysis;
mod list_identity;
mod lower;
mod query_diagnostics;
mod render_lint;
mod sourcemap;
use oxc::{
    allocator::Allocator,
    ast::ast::*,
    ast_visit::Visit,
    parser::Parser,
    semantic::SemanticBuilder,
    span::{SourceType, Span},
};
use serde::Serialize;
use std::collections::HashSet;
/// Query definitions live in this package; EW2002 checks its `query` calls.
pub const QUERY_PACKAGE: &str = "@effectweb/query";

#[derive(Serialize)]
struct Output {
    code: String,
    map: Option<String>,
    diagnostics: Vec<lower::Diagnostic>,
}

pub fn compile_source(source: &str, filename: &str, options: &str) -> Result<String, String> {
    let options: lower::Options = serde_json::from_str(options).map_err(|e| e.to_string())?;
    let allocator = Allocator::default();
    let parsed = Parser::new(
        &allocator,
        source,
        SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx()),
    )
    .parse();
    if !parsed.diagnostics.is_empty() {
        return Err(format!(
            "{filename}: {}",
            parsed
                .diagnostics
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    let program = parsed.program;
    let import_source = options.import_source.as_deref().unwrap_or("effectweb");
    let pragma = program.comments.iter().find_map(|comment| {
        let text = &source[comment.span.start as usize..comment.span.end as usize];
        text.split_once("@jsxImportSource")
            .and_then(|(_, tail)| tail.split_whitespace().next())
    });
    let opted_in = pragma.map_or_else(|| program.body.iter().any(|statement| {
        matches!(statement, Statement::ImportDeclaration(import) if import.source.value == import_source || import.source.value == QUERY_PACKAGE || import.source.value.starts_with(&format!("{import_source}/")))
    }), |pragma| pragma == import_source);
    if !opted_in {
        return serde_json::to_string(&Output {
            code: source.into(),
            map: None,
            diagnostics: vec![],
        })
        .map_err(|e| e.to_string());
    }
    let mut diagnostics = vec![];
    if options.diagnostics_only && options.lint {
        let semantic = SemanticBuilder::new().build(&program);
        let mut index = analysis::Index::new(semantic.semantic.scoping());
        index.visit_program(&program);
        index.refs.sort_by_key(|r| r.span.start);
        index.calls.sort_by_key(|c| c.span.start);
        let mut views = HashSet::new();
        let mut queries = HashSet::new();
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            let root = import.source.value == import_source;
            let dom = root || import.source.value == format!("{import_source}/dom");
            let query = import.source.value == QUERY_PACKAGE;
            for specifier in import.specifiers.iter().flatten() {
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    continue;
                };
                // Slots are render callbacks too; lint them as independent render roots.
                if matches!(specifier.imported.name().as_str(), "view" | "slot") && dom {
                    views.insert(specifier.local.symbol_id.get().unwrap());
                }
                if specifier.imported.name() == "query" && query {
                    queries.insert(specifier.local.symbol_id.get().unwrap());
                }
            }
        }
        for markers in [&mut views, &mut queries] {
            let mut aliases = markers.iter().map(|id| (*id, 0)).collect();
            analysis::resolve_host_aliases(&program, semantic.semantic.scoping(), &mut aliases);
            markers.extend(aliases.into_keys());
        }
        index.compiled_views = index.calls.iter().filter(|call| matches!(&call.callee, Expression::Identifier(id) if index.symbol(id).is_some_and(|id| views.contains(&id)))).map(|call| call.span).collect();
        for call in &index.calls {
            let Expression::Identifier(id) = &call.callee else {
                continue;
            };
            if index.symbol(id).is_some_and(|id| queries.contains(&id))
                && query_diagnostics::custom_key(call)
            {
                let mut diagnostic = lower::diagnostic(
                    source,
                    filename,
                    call.span,
                    "Remove key. Query identity includes every request argument; provide services through the Effect environment.",
                );
                diagnostic.code = "EW2002".into();
                diagnostic.category = "unprovable-dependency".into();
                diagnostics.push(diagnostic);
            }
            if !index.symbol(id).is_some_and(|id| views.contains(&id)) {
                continue;
            }
            let Some(Expression::ArrowFunctionExpression(function)) =
                call.arguments.first().and_then(Argument::as_expression)
            else {
                continue;
            };
            if let Some(arguments) = &call.type_arguments
                && let Some(model) = arguments.params.first()
                && let Some(parameter) = function.params.items.first()
                && parameter.type_annotation.is_none()
                && let BindingPattern::BindingIdentifier(id) = &parameter.pattern
            {
                index
                    .type_annotations
                    .insert(id.symbol_id.get().unwrap(), model);
            }
            for issue in render_lint::check(&index, function, &options) {
                let mut diagnostic =
                    lower::diagnostic(source, filename, issue.span, &issue.message);
                diagnostic.code = if issue.unprovable { "EW2001" } else { "EW1003" }.into();
                if issue.unprovable {
                    diagnostic.category = "unprovable-dependency".into();
                }
                // A shared helper reached from several views reports its issue once.
                if !diagnostics.iter().any(|d: &lower::Diagnostic| {
                    d.line == diagnostic.line
                        && d.column == diagnostic.column
                        && d.message == diagnostic.message
                }) {
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
    if options.diagnostics_only && options.lint {
        let mut rows = list_identity::MapRows::default();
        rows.visit_program(&program);
        for span in rows.spans {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "Rows rendered with .map(...) have positional identity: removing or reordering rows moves component state, focus, drafts and running work to another row. Render keyed rows with list(entities(rows), render) or list(collection(identity).from(rows), render).",
            );
            diagnostic.code = "EW3001".into();
            diagnostic.category = "identity".into();
            diagnostic.severity = "warning".into();
            diagnostics.push(diagnostic);
        }
        let mut bindings = list_identity::InlineBindings::new(&program, import_source);
        bindings.visit_program(&program);
        for span in bindings.spans {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "This DOM binding's setup function is created during render, so the element's resource is released and acquired again on every update. Declare the function once outside the view: const setup = (element, input) => ...; then use={domBinding(data, setup)} or const host = domMount(setup).",
            );
            diagnostic.code = "EW3002".into();
            diagnostic.category = "identity".into();
            diagnostic.severity = "warning".into();
            diagnostics.push(diagnostic);
        }
        for span in bindings.sources_inline {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "This source is created during render, so observe unsubscribes and subscribes again on every update. Create it once outside the view (const total = mapSource(owner.source, (s) => s.total)) and observe that.",
            );
            diagnostic.code = "EW3004".into();
            diagnostic.category = "identity".into();
            diagnostic.severity = "warning".into();
            diagnostics.push(diagnostic);
        }
        let mut slots = list_identity::InlineSlots::new(&program, import_source);
        slots.visit_program(&program);
        for span in slots.spans {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "commandSlot(...) creates a new slot on every call, so this work never replaces or drops earlier work. Declare the slot once (const saveSlot = commandSlot('save')) or use a keyed family (const rowSlot = commandSlots('row'); rowSlot(id)).",
            );
            diagnostic.code = "EW3003".into();
            diagnostic.category = "identity".into();
            diagnostic.severity = "warning".into();
            diagnostics.push(diagnostic);
        }
    }
    let mut compiler = lower::Lower::new(source, filename, options.development);
    compiler.visit_program(&program);
    diagnostics.extend(
        compiler
            .errors
            .into_iter()
            .map(|(span, message)| lower::diagnostic(source, filename, span, &message)),
    );
    if options.diagnostics_only {
        return serde_json::to_string(&Output {
            code: String::new(),
            map: None,
            diagnostics,
        })
        .map_err(|e| e.to_string());
    }
    if let Some(error) = diagnostics.first() {
        return Err(format!(
            "{}:{}:{}: EffectWeb JSX [{}]: {}",
            error.file, error.line, error.column, error.code, error.message
        ));
    }
    let mut edits = compiler.edits;
    edits.sort_by_key(|(span, _)| (span.start, std::cmp::Reverse(span.end)));
    let mut until = 0;
    edits.retain(|(span, _)| {
        if span.start < until {
            false
        } else {
            until = span.end;
            true
        }
    });
    if edits.is_empty() {
        return serde_json::to_string(&Output {
            code: source.into(),
            map: None,
            diagnostics,
        })
        .map_err(|e| e.to_string());
    }
    let insertion = program
        .directives
        .last()
        .map(|d| d.span.end)
        .unwrap_or(0)
        .max(program.hashbang.as_ref().map(|h| h.span.end).unwrap_or(0));
    let runtime = options
        .runtime_module
        .unwrap_or_else(|| format!("{import_source}/dom"));
    edits.push((
        Span::new(insertion, insertion),
        format!(
            "\nimport * as {} from {};\n{}\n",
            compiler.runtime,
            serde_json::to_string(&runtime).unwrap(),
            compiler.hoisted.join("\n")
        ),
    ));
    let (code, map) = sourcemap::emit(source, filename, edits)?;
    serde_json::to_string(&Output {
        code,
        map: Some(map),
        diagnostics,
    })
    .map_err(|e| e.to_string())
}
#[napi_derive::napi]
pub fn compile(source: String, filename: String, options: String) -> napi::Result<String> {
    compile_source(&source, &filename, &options).map_err(napi::Error::from_reason)
}
