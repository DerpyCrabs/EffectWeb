//! Recognize writes to locally constructed owners' plain records and arrays.
use crate::{analysis::Index, owned_work::MUTATORS};
use oxc::{ast::ast::*, span::Span};

fn resolve<'a>(index: &Index<'a, '_>, mut expr: &'a Expression<'a>) -> Option<&'a Expression<'a>> {
    // Bound alias chains, including cycles in invalid input.
    for _ in 0..32 {
        expr = expr.get_inner_expression();
        let Expression::Identifier(id) = expr else {
            return Some(expr);
        };
        let symbol = index.symbol(id)?;
        if !index.scoping.symbol_flags(symbol).is_const_variable()
            || !matches!(
                index.declarators.get(&symbol)?.id,
                BindingPattern::BindingIdentifier(_)
            )
        {
            return None;
        }
        expr = index.initializers.get(&symbol)?;
    }
    None
}

// Follow a snapshot read to its model literal. Stop at calls, opaque objects,
// unknown spreads, and unrecognized methods instead of guessing from names.
fn shape<'a>(
    index: &Index<'a, '_>,
    expr: &'a Expression<'a>,
    source: &str,
    depth: usize,
) -> Option<&'a Expression<'a>> {
    if depth == 0 {
        return None;
    }
    match resolve(index, expr)? {
        Expression::CallExpression(read) if read.arguments.is_empty() => {
            let method = read.callee.as_member_expression()?;
            let owner = match method.static_property_name()?.as_str()? {
                "read" => method.object(),
                "model" => {
                    let field = resolve(index, method.object())?.as_member_expression()?;
                    if field.static_property_name()? != "source" {
                        return None;
                    }
                    field.object()
                }
                _ => return None,
            };
            let Expression::CallExpression(make) = resolve(index, owner)? else {
                return None;
            };
            let Expression::Identifier(id) = make.callee.without_parentheses() else {
                return None;
            };
            let (module, path) = index.imports.get(&index.symbol(id)?)?;
            if module != source || path.as_slice() != ["modelOwner"] {
                return None;
            }
            resolve(index, make.arguments.first()?.as_expression()?)
        }
        expr => {
            let member = expr.as_member_expression()?;
            let name = member.static_property_name()?;
            let Expression::ObjectExpression(record) =
                shape(index, member.object(), source, depth - 1)?
            else {
                return None;
            };
            for prop in record.properties.iter().rev() {
                let ObjectPropertyKind::ObjectProperty(prop) = prop else {
                    return None;
                };
                if prop.computed {
                    return None;
                }
                if prop.key.static_name()? == name {
                    return resolve(index, &prop.value);
                }
            }
            None
        }
    }
}

pub fn check(index: &Index<'_, '_>, source: &str) -> Vec<Span> {
    let mut spans = vec![];
    for call in &index.calls {
        if let Some(method) = call.callee.as_member_expression()
            && method
                .static_property_name()
                .and_then(|name| name.as_str())
                .is_some_and(|name| MUTATORS.contains(&name))
            && matches!(
                shape(index, method.object(), source, 32),
                Some(Expression::ArrayExpression(_))
            )
        {
            spans.push(call.span);
        }
    }
    for assignment in &index.assignments {
        if let Some(member) = assignment.left.as_member_expression()
            && matches!(
                shape(index, member.object(), source, 32),
                Some(Expression::ObjectExpression(_) | Expression::ArrayExpression(_))
            )
        {
            spans.push(assignment.span);
        }
    }
    spans
}
