//! Complete request identity is mandatory; legacy projections are rejected.
use oxc::ast::ast::*;

pub fn custom_key(call: &CallExpression<'_>) -> bool {
    let Some(Expression::ObjectExpression(definition)) =
        call.arguments.first().and_then(Argument::as_expression)
    else {
        return false;
    };
    definition.properties.iter().any(|property| matches!(property,
        ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some_and(|name| name == "key")
    ))
}
