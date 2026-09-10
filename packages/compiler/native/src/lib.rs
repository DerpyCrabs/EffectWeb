mod analysis;
mod identity;
mod lower;
mod query_diagnostics;
mod semantics;
mod sourcemap;
mod template;
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

#[derive(Serialize)]
struct Output {
    code: String,
    map: Option<String>,
    diagnostics: Vec<lower::Diagnostic>,
}

pub fn compile_source(source: &str, filename: &str, options: &str) -> Result<String, String> {
    let options: lower::Options = serde_json::from_str(options).map_err(|e| e.to_string())?;
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type).parse();
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
    let semantic = SemanticBuilder::new()
        .with_check_syntax_error(true)
        .build(&program);
    if !semantic.diagnostics.is_empty() {
        return Err(format!(
            "{filename}: {}",
            semantic
                .diagnostics
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    let mut exported_markers = vec![];
    let mut namespaces = HashSet::new();
    let mut markers = HashSet::new();
    let mut slot_markers = HashSet::new();
    let mut binding_markers = HashSet::new();
    let mut query_markers = HashSet::new();
    let mut runtime = options.runtime_module.clone();
    for statement in &program.body {
        if let Statement::ExportFromDeclaration(export) = statement
            && options.import_source.as_deref().is_some_and(|source| {
                export.source.value == source || export.source.value == format!("{source}/dom")
            })
            && !export.export_kind.is_type()
            && export.specifiers.iter().any(|item| {
                !item.export_kind.is_type()
                    && matches!(item.local.name().as_str(), "view" | "slot" | "ViewBinding")
            })
        {
            exported_markers.push(export.span);
        }
        if let Statement::ExportAllDeclaration(export) = statement
            && !export.export_kind.is_type()
            && options.import_source.as_deref().is_some_and(|source| {
                export.source.value == source || export.source.value == format!("{source}/dom")
            })
        {
            exported_markers.push(export.span);
        }
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        let Some(source) = options.import_source.as_deref() else {
            continue;
        };
        let root = import.source.value == source;
        let dom = root || import.source.value == format!("{source}/dom");
        let query = root || import.source.value == format!("{source}/query");
        for specifier in import.specifiers.iter().flatten() {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                if dom
                    && let ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) =
                        specifier
                {
                    namespaces.insert(specifier.local.symbol_id.get().unwrap());
                }
                continue;
            };
            let id = specifier.local.symbol_id.get().unwrap();
            match specifier.imported.name().as_str() {
                "view" if dom => {
                    markers.insert(id);
                    runtime.get_or_insert_with(|| format!("{source}/dom"));
                }
                "slot" if dom => {
                    slot_markers.insert(id);
                }
                "ViewBinding" if dom => {
                    binding_markers.insert(id);
                }
                "query" if query => {
                    query_markers.insert(id);
                }
                _ => {}
            }
        }
    }
    // Named imports and immutable local aliases retain the same compiler identity.
    for markers in [
        &mut namespaces,
        &mut markers,
        &mut slot_markers,
        &mut binding_markers,
        &mut query_markers,
    ] {
        let mut aliases = markers.iter().map(|id| (*id, 0)).collect();
        analysis::resolve_host_aliases(&program, semantic.semantic.scoping(), &mut aliases);
        markers.extend(aliases.into_keys());
    }
    if exported_markers.is_empty()
        && markers.is_empty()
        && query_markers.is_empty()
        && slot_markers.is_empty()
        && binding_markers.is_empty()
        && namespaces.is_empty()
    {
        return serde_json::to_string(&Output {
            code: source.into(),
            map: None,
            diagnostics: vec![],
        })
        .map_err(|e| e.to_string());
    }
    let mut index = analysis::Index::new(semantic.semantic.scoping());
    index.visit_program(&program);
    index.refs.sort_by_key(|r| r.span.start);
    index.calls.sort_by_key(|c| c.span.start);
    index.compiled_views = index.calls.iter().filter(|call| {
        matches!(&call.callee, Expression::Identifier(id) if index.symbol(id).is_some_and(|id| markers.contains(&id)))
    }).map(|call| call.span).collect();
    // Explicit view<Model> supplies a useful same-file annotation without a TS host.
    for call in &index.calls {
        if let Expression::Identifier(id) = &call.callee
            && index.symbol(id).is_some_and(|id| markers.contains(&id))
            && let Some(arguments) = &call.type_arguments
            && let Some(model) = arguments.params.first()
            && let Some(Expression::ArrowFunctionExpression(function)) =
                call.arguments.first().and_then(Argument::as_expression)
            && let Some(parameter) = function.params.items.first()
            && parameter.type_annotation.is_none()
            && let BindingPattern::BindingIdentifier(id) = &parameter.pattern
        {
            index
                .type_annotations
                .insert(id.symbol_id.get().unwrap(), model);
        }
    }
    let mut compiler = lower::Lower::new(source, filename, &index, &options);
    compiler.slot_markers = slot_markers.clone();
    compiler.binding_markers = binding_markers;
    for call in &index.calls {
        if let Expression::Identifier(id) = &call.callee
            && index
                .symbol(id)
                .is_some_and(|id| query_markers.contains(&id))
            && query_diagnostics::custom_key(call)
        {
            let remedy = "Remove key. Query identity includes every request argument; provide services through the Effect environment.".to_string();
            let mut diagnostic = compiler.fail::<()>(call.span, &remedy).unwrap_err();
            diagnostic.code = "EW2002".into();
            diagnostic.category = "unprovable-dependency".into();
            diagnostic.severity = "error".into();
            diagnostic.remedy = remedy;
            if !options.diagnostics_only {
                return Err(format!(
                    "{}:{}:{}: EffectWeb JSX [{}]: {}",
                    diagnostic.file,
                    diagnostic.line,
                    diagnostic.column,
                    diagnostic.code,
                    diagnostic.message
                ));
            }
            compiler.diagnostics.push(*diagnostic);
        }
    }
    // Compiler markers cannot escape into ordinary runtime calls. Immutable local
    // aliases are supported, while namespaces and higher-order use need diagnostics.
    let view_calls: Vec<_> = index.calls.iter().filter(|call| {
        matches!(&call.callee, Expression::Identifier(id) if index.symbol(id).is_some_and(|id| markers.contains(&id)))
    }).collect();
    let mut marker_errors: Vec<_> = exported_markers.into_iter().map(|span| (span, "Import compiler markers directly from effectweb or effectweb/dom; re-export compiled view definitions instead.")).collect();
    for reference in &index.refs {
        let Some(symbol) = reference.symbol else {
            continue;
        };
        if namespaces.contains(&symbol)
            && (reference
                .path
                .first()
                .is_some_and(|part| matches!(part.as_str(), "?.view" | "?.slot" | "?.ViewBinding"))
                || index.calls.iter().any(|call| match &call.callee {
                    Expression::StaticMemberExpression(member) => {
                        member.object.span() == reference.span
                            && matches!(
                                member.property.name.as_str(),
                                "view" | "slot" | "ViewBinding"
                            )
                    }
                    Expression::ComputedMemberExpression(member) => {
                        member.object.span() == reference.span
                            && member.static_property_name().is_some_and(|name| {
                                matches!(name.as_str(), "view" | "slot" | "ViewBinding")
                            })
                    }
                    _ => false,
                }))
        {
            marker_errors.push((reference.span, "Import compiler markers by name; namespace access cannot preserve compiler identity."));
        }
        if namespaces.contains(&symbol) && reference.path.is_empty() {
            let local_alias = index.initializers.iter().any(|(id, expression)| {
                namespaces.contains(id) && expression.span().contains_inclusive(reference.span)
            });
            let member_call = index.calls.iter().any(|call| match &call.callee {
                Expression::StaticMemberExpression(member) => {
                    member.object.span() == reference.span
                }
                Expression::ComputedMemberExpression(member) => {
                    member.object.span() == reference.span
                        && member.static_property_name().is_some()
                }
                _ => false,
            });
            let exported_alias = local_alias && program.body.iter().any(|statement| matches!(statement, Statement::ExportDeclaration(export) if export.span.contains_inclusive(reference.span)));
            if exported_alias || (!local_alias && !member_call) {
                marker_errors.push((reference.span, "Use named imports instead of destructuring or passing a framework namespace; compiler markers cannot escape into runtime values."));
            }
        }
        if !markers.contains(&symbol) && !slot_markers.contains(&symbol) {
            continue;
        }
        let alias = index.initializers.iter().any(|(id, expression)| {
            (markers.contains(id) || slot_markers.contains(id))
                && expression.span().contains_inclusive(reference.span)
        });
        if alias {
            if program.body.iter().any(|statement| matches!(statement, Statement::ExportDeclaration(export) if export.span.contains_inclusive(reference.span))) {
                marker_errors.push((reference.span, "Keep marker aliases local; export compiled view definitions instead."));
            }
            continue;
        }
        let call = index
            .calls
            .iter()
            .find(|call| call.callee.span() == reference.span);
        if let Some(call) = call {
            let enclosing = view_calls
                .iter()
                .any(|outer| outer.span != call.span && outer.span.contains_inclusive(call.span));
            if markers.contains(&symbol) && enclosing {
                marker_errors.push((call.span, "Declare view definitions outside other views; use slot for locally captured markup."));
            } else if slot_markers.contains(&symbol) && !enclosing {
                marker_errors.push((call.span, "Declare slot inside a compiled view so its captures and lifetime have an owner."));
            }
        } else {
            marker_errors.push((reference.span, "Compiler markers must be called directly or through an immutable local alias; export compiled views instead of marker functions."));
        }
    }
    for (span, message) in marker_errors {
        let error = compiler.fail::<()>(span, message).unwrap_err();
        if options.diagnostics_only {
            compiler.diagnostics.push(*error);
        } else {
            return Err(format!(
                "{}:{}:{}: EffectWeb JSX [{}]: {}",
                error.file, error.line, error.column, error.code, error.message
            ));
        }
    }
    let mut edits = vec![];
    let mut until = 0;
    for call in &index.calls {
        if call.span.start < until {
            continue;
        }
        if let Expression::Identifier(id) = &call.callee
            && index.symbol(id).is_some_and(|id| markers.contains(&id))
        {
            let replacement = match compiler.compile_view(call) {
                Ok(code) => code,
                Err(error) if options.diagnostics_only => {
                    compiler.diagnostics.push(*error);
                    until = call.span.end;
                    continue;
                }
                Err(error) => {
                    return Err(format!(
                        "{}:{}:{}: EffectWeb JSX [{}]: {}\n> {} | {}",
                        error.file,
                        error.line,
                        error.column,
                        error.code,
                        error.message,
                        error.line,
                        source.lines().nth(error.line - 1).unwrap_or("")
                    ));
                }
            };
            until = call.span.end;
            edits.push((call.span, replacement));
        }
    }
    if options.diagnostics_only {
        return serde_json::to_string(&Output {
            code: String::new(),
            map: None,
            diagnostics: compiler.diagnostics,
        })
        .map_err(|e| e.to_string());
    }
    if !edits.is_empty() {
        let mut insertion = program.directives.last().map(|d| d.span.end).unwrap_or(0);
        if let Some(hashbang) = &program.hashbang {
            insertion = insertion.max(hashbang.span.end);
        }
        let injected = format!(
            "\nimport * as {} from {};\n{}\n",
            compiler.runtime,
            serde_json::to_string(&runtime.unwrap()).unwrap(),
            compiler.hoisted.join("\n")
        );
        edits.push((Span::new(insertion, insertion), injected));
    }
    let (code, map) = sourcemap::emit(source, filename, edits)?;
    serde_json::to_string(&Output {
        code,
        map: Some(map),
        diagnostics: compiler.diagnostics,
    })
    .map_err(|e| e.to_string())
}
#[napi_derive::napi]
pub fn compile(source: String, filename: String, options: String) -> napi::Result<String> {
    compile_source(&source, &filename, &options).map_err(napi::Error::from_reason)
}
