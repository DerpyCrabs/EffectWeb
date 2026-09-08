//! Narrow field-omission checks: imported query(), literal definitions, inline arrows.
use crate::analysis::Index;
use oxc::{ast::ast::*, span::GetSpan};
use std::collections::{BTreeSet, HashMap};

fn argument_fields(
    index: &Index<'_, '_>,
    arrow: &ArrowFunctionExpression<'_>,
) -> Option<BTreeSet<String>> {
    if arrow.params.rest.is_some() || arrow.params.items.len() > 1 {
        return None;
    }
    let Some(parameter) = arrow.params.items.first() else {
        return Some(BTreeSet::new());
    };
    if parameter.initializer.is_some() || arrow.params.rest.is_some() {
        return None;
    }
    let mut fields = BTreeSet::new();
    match &parameter.pattern {
        BindingPattern::BindingIdentifier(id) => {
            let symbol = id.symbol_id.get()?;
            for reference in index.references(arrow.body.span()) {
                if reference.symbol != Some(symbol) {
                    continue;
                }
                let path = reference.path.first()?;
                let field = if let Some(property) =
                    path.strip_prefix("?.[").and_then(|s| s.strip_suffix(']'))
                {
                    serde_json::from_str::<String>(property).ok()?
                } else {
                    path.strip_prefix("?.")?.to_string()
                };
                fields.insert(field);
            }
        }
        BindingPattern::ObjectPattern(object) if object.rest.is_none() => {
            let mut bindings = HashMap::new();
            for property in &object.properties {
                if property.computed {
                    return None;
                }
                let BindingPattern::BindingIdentifier(id) = &property.value else {
                    return None;
                };
                bindings.insert(id.symbol_id.get()?, property.key.static_name()?.to_string());
            }
            for reference in index.references(arrow.body.span()) {
                if let Some(field) = reference.symbol.and_then(|symbol| bindings.get(&symbol)) {
                    fields.insert(field.clone());
                }
            }
        }
        _ => return None,
    }
    Some(fields)
}

pub fn omitted_fields(index: &Index<'_, '_>, call: &CallExpression<'_>) -> Option<Vec<String>> {
    let Expression::ObjectExpression(definition) = call.arguments.first()?.as_expression()? else {
        return None;
    };
    let mut key = None;
    let mut load = None;
    for property in &definition.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if property.computed || property.method {
            return None;
        }
        match property.key.static_name()?.as_ref() {
            "key" => {
                let Expression::ArrowFunctionExpression(arrow) = &property.value else {
                    return None;
                };
                key = Some(arrow);
            }
            "load" => {
                let Expression::ArrowFunctionExpression(arrow) = &property.value else {
                    return None;
                };
                load = Some(arrow);
            }
            _ => {}
        }
    }
    let key = argument_fields(index, key?)?;
    let load = argument_fields(index, load?)?;
    let omitted = load.difference(&key).cloned().collect::<Vec<_>>();
    if omitted.is_empty() {
        None
    } else {
        Some(omitted)
    }
}
