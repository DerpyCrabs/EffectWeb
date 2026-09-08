mod analysis;
mod identity;
mod lower;
mod query_diagnostics;
mod sourcemap;
mod template;
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
    let mut markers = HashSet::new();
    let mut slot_markers = HashSet::new();
    let mut binding_markers = HashSet::new();
    let mut query_markers = HashSet::new();
    let mut host_callbacks = std::collections::HashMap::new();
    let mut runtime = options.runtime_module.clone();
    for statement in &program.body {
        if let Statement::ImportDeclaration(import) = statement
            && options.import_source.as_deref().is_some_and(|source| {
                import.source.value == source
                    || import.source.value == format!("{source}/query")
                    || import.source.value == format!("{source}/mount")
            })
        {
            for specifier in import.specifiers.iter().flatten() {
                if let ImportDeclarationSpecifier::ImportSpecifier(s) = specifier {
                    if options.import_source.as_deref().is_some_and(|source| {
                        import.source.value == source
                            || import.source.value == format!("{source}/mount")
                    }) {
                        let name = s.imported.name();
                        let argument = match name.as_str() {
                            "domMount" => Some(0),
                            "domBinding" => Some(1),
                            _ => None,
                        };
                        if let Some(argument) = argument {
                            host_callbacks.insert(s.local.symbol_id.get().unwrap(), argument);
                        }
                    }
                    let view = match &s.imported {
                        ModuleExportName::IdentifierName(n) => n.name == "view",
                        ModuleExportName::StringLiteral(n) => n.value == "view",
                        _ => false,
                    };
                    let slot = match &s.imported {
                        ModuleExportName::IdentifierName(n) => n.name == "slot",
                        ModuleExportName::StringLiteral(n) => n.value == "slot",
                        _ => false,
                    };
                    if matches!(&s.imported, ModuleExportName::IdentifierName(n) if n.name == "query")
                    {
                        query_markers.insert(s.local.symbol_id.get().unwrap());
                    }
                    if slot
                        && options.import_source.as_deref() == Some(import.source.value.as_str())
                    {
                        slot_markers.insert(s.local.symbol_id.get().unwrap());
                    }
                    if s.imported.name() == "ViewBinding"
                        && options.import_source.as_deref() == Some(import.source.value.as_str())
                    {
                        binding_markers.insert(s.local.symbol_id.get().unwrap());
                    }
                    if view
                        && options.import_source.as_deref() == Some(import.source.value.as_str())
                    {
                        markers.insert(s.local.symbol_id.get().unwrap());
                        runtime.get_or_insert_with(|| format!("{}/dom", import.source.value));
                    }
                }
            }
        }
    }
    if markers.is_empty() && query_markers.is_empty() {
        return serde_json::to_string(&Output {
            code: source.into(),
            map: None,
            diagnostics: vec![],
        })
        .map_err(|e| e.to_string());
    }
    let mut index = analysis::Index::new(semantic.semantic.scoping());
    analysis::resolve_host_aliases(&program, semantic.semantic.scoping(), &mut host_callbacks);
    index.host_callbacks = host_callbacks;
    index.visit_program(&program);
    index.refs.sort_by_key(|r| r.span.start);
    index.calls.sort_by_key(|c| c.span.start);
    index.collect_host_acquisitions();
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
    compiler.slot_markers = slot_markers;
    compiler.binding_markers = binding_markers;
    for call in &index.calls {
        if let Expression::Identifier(id) = &call.callee
            && index
                .symbol(id)
                .is_some_and(|id| query_markers.contains(&id))
            && let Some(fields) = query_diagnostics::omitted_fields(&index, call)
        {
            let remedy = format!(
                "Include {} in the query key. Return a tuple or object containing every load-relevant argument field.",
                fields.join(", ")
            );
            let mut diagnostic = compiler
                .fail::<()>(
                    call.span,
                    &format!(
                        "Query load reads argument fields absent from key: {}. {}",
                        fields.join(", "),
                        remedy
                    ),
                )
                .unwrap_err();
            diagnostic.code = "EW2002".into();
            diagnostic.category = "unprovable-dependency".into();
            diagnostic.severity = "warning".into();
            diagnostic.remedy = remedy;
            compiler.diagnostics.push(*diagnostic);
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
