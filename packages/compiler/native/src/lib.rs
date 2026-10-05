mod analysis;
mod list_captures;
mod list_identity;
mod lower;
mod owned_work;
mod query_diagnostics;
mod render_lint;
mod sourcemap;
use oxc::{
    allocator::Allocator,
    ast::ast::*,
    ast_visit::Visit,
    parser::Parser,
    semantic::SemanticBuilder,
    span::{GetSpan, SourceType, Span},
};
use serde::Serialize;
use std::collections::HashSet;
/// Query definitions live in this package; EW2002 checks its `query` calls.
pub const QUERY_PACKAGE: &str = "@effectweb/query";
/// Adapter and icon packages render through the same runtime as their importer.
const ADAPTER_SCOPE: &str = "@effectweb/";

fn contains_jsx(program: &Program<'_>) -> bool {
    struct Jsx(bool);
    impl<'a> Visit<'a> for Jsx {
        fn visit_jsx_element(&mut self, _: &JSXElement<'a>) {
            self.0 = true;
        }
        fn visit_jsx_fragment(&mut self, _: &JSXFragment<'a>) {
            self.0 = true;
        }
    }
    let mut found = Jsx(false);
    found.visit_program(program);
    found.0
}

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
    // Only comments before the first statement are pragmas; prose later in the file is not.
    let first_statement = program
        .body
        .first()
        .map_or(u32::MAX, |statement| statement.span().start);
    let pragma = program
        .comments
        .iter()
        .take_while(|comment| comment.span.end <= first_statement)
        .find_map(|comment| {
            let text = &source[comment.span.start as usize..comment.span.end as usize];
            text.split_once("@jsxImportSource")
                .and_then(|(_, tail)| tail.split_whitespace().next())
        });
    // Every JSX file belongs to EffectWeb unless a pragma names another runtime. Files
    // without JSX opt in by importing the runtime, an adapter package, or a subpath.
    let opted_in = pragma.map_or_else(|| contains_jsx(&program) || program.body.iter().any(|statement| {
        matches!(statement, Statement::ImportDeclaration(import) if import.source.value == import_source || import.source.value.starts_with(ADAPTER_SCOPE) || import.source.value.starts_with(&format!("{import_source}/")))
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
            let (function, parameters) =
                match call.arguments.first().and_then(Argument::as_expression) {
                    Some(Expression::ArrowFunctionExpression(function)) => {
                        (render_lint::Callable::Arrow(function), &function.params)
                    }
                    Some(Expression::FunctionExpression(function)) => {
                        (render_lint::Callable::Function(function), &function.params)
                    }
                    _ => continue,
                };
            if let Some(arguments) = &call.type_arguments
                && let Some(model) = arguments.params.first()
                && let Some(parameter) = parameters.items.first()
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
        let mut rows = list_identity::MapRows::new(&program, import_source);
        rows.visit_program(&program);
        for span in rows.positional {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "sequence(...) gives these rows positional identity, but they hold editable controls or are selected from a longer array: removing or filtering rows moves drafts, focus and component state to another row. Key them with entities(rows) or collection(identity).from(rows).",
            );
            diagnostic.code = "EW3005".into();
            diagnostic.category = "identity".into();
            diagnostic.severity = "warning".into();
            diagnostics.push(diagnostic);
        }
        for span in rows.indexed {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "This collection derives identity from the row index, so deleting a middle row gives its identity to the next row. Use a domain identity (row.id, a composite of stable fields), or sequence(rows) when rows are purely positional.",
            );
            diagnostic.code = "EW3006".into();
            diagnostic.category = "identity".into();
            diagnostic.severity = "warning".into();
            diagnostics.push(diagnostic);
        }
        for span in rows.spans {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "Do not render JSX with rows.map(render). Rewrite as list(rows, render) for scalars, list(entities(rows), render) for entities, or list(rows, identity, render). For a non-array receiver, suppress effectweb/identity on this line.",
            );
            diagnostic.code = "EW3001".into();
            diagnostic.category = "identity".into();
            diagnostic.severity = "error".into();
            diagnostics.push(diagnostic);
        }
        let mut work = owned_work::OwnedWork::new(&program, import_source);
        work.visit_program(&program);
        for span in work.impure {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "update is a pure transition and must not run this itself. Return it as a command: { key, policy: 'queue', effect: Effect.sync(() => model.props.onChange(value)) }, or { key, policy, effect } for an Effect.",
            );
            diagnostic.code = "EW1004".into();
            diagnostics.push(diagnostic);
        }
        for span in work.mutations {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "update received an immutable model; this write throws at runtime. Return a copy with the change: { model: { ...model, rows: [...model.rows, row] } }.",
            );
            diagnostic.code = "EW1004".into();
            diagnostics.push(diagnostic);
        }
        for span in work.discarded_mounts {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "makeMount returns an Effect and mounts nothing until it runs. Write `yield* makeMount(…)` inside your app's Effect, or call `mount(…)` outside Effect.",
            );
            diagnostic.code = "EW1006".into();
            diagnostics.push(diagnostic);
        }
        for span in work.finalizers {
            let mut diagnostic = lower::diagnostic(
                source,
                filename,
                span,
                "This finalizer belongs to work run under 'replace': it runs after the newer run has started and overwrites that run's state. Use owner.task(field, effect, 'replace'), which publishes the status and ignores replaced runs, or reset it with Effect.tap and Effect.tapCause, which do not run for an interrupted run.",
            );
            diagnostic.code = "EW1005".into();
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
                "This is created during render, so every update rebuilds it: a source resubscribes, a collection loses its row cache. Create it once at module or controller scope (const total = mapSource(owner.source, (s) => s.total); const byCode = collection(...)) and use that inside the view, or write the identity inline with list(rows, identity, render).",
            );
            diagnostic.code = "EW3004".into();
            diagnostic.category = "identity".into();
            diagnostic.severity = "warning".into();
            diagnostics.push(diagnostic);
        }
    }
    let mut compiler = lower::Lower::new(source, filename, options.development);
    if !options.diagnostics_only {
        let semantic = SemanticBuilder::new().build(&program);
        // Inner JSX is lowered around these insertions, so they are recorded first.
        let (edits, sites) = list_captures::insertions(
            &program,
            semantic.semantic.scoping(),
            import_source,
            &compiler.prefix,
            &compiler.runtime,
        );
        compiler.edits = edits;
        compiler.site_declarations = sites;
    }
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
            compiler
                .site_declarations
                .iter()
                .chain(&compiler.hoisted)
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join("\n")
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

#[cfg(test)]
mod tests {
    use super::compile_source;

    fn compiled(source: &str) -> String {
        let output = compile_source(source, "test.tsx", "{}").expect("compiles");
        let value: serde_json::Value = serde_json::from_str(&output).expect("json");
        value["code"]
            .as_str()
            .expect("code")
            .split_whitespace()
            .collect()
    }

    #[test]
    fn nested_elements_become_one_block_call() {
        let code = compiled(
            "import {view} from 'effectweb';\nexport const Row = view(m => <tr class={m.c}><td>{m.id}</td><td><a onClick={m.pick}>{m.label}</a></td></tr>);",
        );
        assert!(code.contains(r#"["tr",0,[["td",null,[1]],"#), "{code}");
        assert!(code.contains(".block("), "{code}");
        assert!(
            code.contains(r#"({"class":m.c},m.id,{"onClick":m.pick},m.label)"#),
            "{code}"
        );
    }

    #[test]
    fn unclonable_literals_are_positions_and_media_attributes_stay_dynamic() {
        let code = compiled(
            "export const f = (m) => <form><input type=\"text\" /><video autoplay src=\"a.mp4\">{m.x}</video></form>;",
        );
        assert!(
            code.contains(r#"["form",null,[1,["video",0,[1]]]]"#),
            "{code}"
        );
    }

    #[test]
    fn list_callbacks_record_the_outer_values_they_read() {
        let code = compiled(
            "import {list, view} from 'effectweb';\nview((model, send) => <ul>{list(model.rows, (row) => <li class={row.id === model.selected ? 'on' : ''} onClick={() => send(row.id)}>{model.labels.short.length}{model.rows.filter(Boolean).length}</li>)}</ul>);",
        );
        assert!(
            code.contains(
                ",[_ew_c0,model?.selected,send,model?.labels?.short?.length,model?.rows],false)"
            ),
            "{code}"
        );
    }

    #[test]
    fn list_callbacks_the_analysis_cannot_describe_are_left_alone() {
        for body in [
            "view((model) => { let n = 0; n = model.a; return list(model.rows, (r) => <li>{n}</li>); });",
            "view((model) => { const rows = list(model.rows, (r) => <li>{later}</li>); const later = 1; return rows; });",
            "view(function (model) { return list(model.rows, (r) => <li>{this.x}</li>); });",
        ] {
            let code = compiled(&format!("import {{list, view}} from 'effectweb';\n{body}"));
            assert!(!code.contains("),["), "{code}");
        }
    }

    #[test]
    fn a_pragma_for_another_runtime_leaves_the_file_unchanged() {
        let source = "/** @jsxImportSource react */ export const a = () => <p />;";
        let output = compile_source(source, "other.tsx", "{}").expect("compiles");
        let value: serde_json::Value = serde_json::from_str(&output).expect("json");
        assert_eq!(value["code"].as_str(), Some(source));
    }
}
