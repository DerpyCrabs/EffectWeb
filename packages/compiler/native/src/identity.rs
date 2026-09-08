//! Conservative, same-file identity proofs. This is not a TypeScript type checker.
use crate::analysis::Index;
use oxc::ast::ast::*;
use std::collections::HashMap;

#[derive(Default)]
enum Shape {
    #[default]
    Unknown,
    Object,
    Array(Box<Shape>),
    Fields(HashMap<String, Shape>),
}
impl Shape {
    fn object(&self) -> bool {
        matches!(self, Self::Object | Self::Fields(_) | Self::Array(_))
    }
    fn field(self, key: &str) -> Self {
        if let Self::Fields(mut fields) = self {
            fields.remove(key).unwrap_or_default()
        } else {
            Self::Unknown
        }
    }
}
impl Index<'_, '_> {
    pub fn raw_object_array(&self, expression: &Expression<'_>) -> bool {
        matches!(self.expression_shape(expression, 0), Shape::Array(item) if item.object())
    }
    fn fields(&self, signatures: &[TSSignature<'_>], depth: usize) -> Shape {
        Shape::Fields(
            signatures
                .iter()
                .filter_map(|signature| {
                    if let TSSignature::TSPropertySignature(property) = signature
                        && !property.computed
                        && let Some(key) = property.key.static_name()
                        && let Some(annotation) = &property.type_annotation
                    {
                        return Some((
                            key.to_string(),
                            self.type_shape(&annotation.type_annotation, depth + 1),
                        ));
                    }
                    None
                })
                .collect(),
        )
    }
    fn type_shape(&self, annotation: &TSType<'_>, depth: usize) -> Shape {
        if depth > 20 {
            return Shape::Unknown;
        }
        match annotation {
            TSType::TSArrayType(array) => {
                Shape::Array(Box::new(self.type_shape(&array.element_type, depth + 1)))
            }
            TSType::TSTypeOperatorType(operator)
                if operator.operator == TSTypeOperatorOperator::Readonly =>
            {
                self.type_shape(&operator.type_annotation, depth + 1)
            }
            TSType::TSTypeLiteral(object) => self.fields(&object.members, depth),
            TSType::TSObjectKeyword(_) => Shape::Object,
            TSType::TSTypeReference(reference) => {
                let TSTypeName::IdentifierReference(name) = &reference.type_name else {
                    return Shape::Unknown;
                };
                let symbol = self.symbol(name);
                if symbol.is_none()
                    && let Some(arguments) = &reference.type_arguments
                    && arguments.params.len() == 1
                {
                    match name.name.as_str() {
                        "Array" | "ReadonlyArray" => {
                            return Shape::Array(Box::new(
                                self.type_shape(&arguments.params[0], depth + 1),
                            ));
                        }
                        "Readonly" => return self.type_shape(&arguments.params[0], depth + 1),
                        _ => {}
                    }
                }
                if let Some(symbol) = symbol {
                    if let Some(alias) = self.type_aliases.get(&symbol) {
                        return self.type_shape(alias, depth + 1);
                    }
                    if let Some(interface) = self.interfaces.get(&symbol) {
                        return self.fields(&interface.body.body, depth + 1);
                    }
                }
                Shape::Unknown
            }
            _ => Shape::Unknown,
        }
    }
    fn expression_shape(&self, expression: &Expression<'_>, depth: usize) -> Shape {
        if depth > 20 {
            return Shape::Unknown;
        }
        match expression {
            Expression::ParenthesizedExpression(value) => {
                self.expression_shape(&value.expression, depth + 1)
            }
            Expression::TSNonNullExpression(value) => {
                self.expression_shape(&value.expression, depth + 1)
            }
            Expression::TSAsExpression(value) => {
                match self.type_shape(&value.type_annotation, depth + 1) {
                    Shape::Unknown => self.expression_shape(&value.expression, depth + 1),
                    shape => shape,
                }
            }
            Expression::TSSatisfiesExpression(value) => {
                self.expression_shape(&value.expression, depth + 1)
            }
            Expression::ObjectExpression(_) => Shape::Object,
            Expression::ArrayExpression(array) => {
                // A single known object is enough to prove the raw list will fail at runtime.
                if array.elements.iter().any(|item| {
                    item.as_expression()
                        .is_some_and(|item| self.expression_shape(item, depth + 1).object())
                }) {
                    Shape::Array(Box::new(Shape::Object))
                } else {
                    Shape::Unknown
                }
            }
            Expression::Identifier(name) => {
                if let Some(symbol) = self.symbol(name) {
                    if let Some(annotation) = self.type_annotations.get(&symbol) {
                        return self.type_shape(annotation, depth + 1);
                    }
                    if let Some(initializer) = self.initializers.get(&symbol) {
                        return self.expression_shape(initializer, depth + 1);
                    }
                }
                Shape::Unknown
            }
            Expression::StaticMemberExpression(member) => self
                .expression_shape(&member.object, depth + 1)
                .field(&member.property.name),
            Expression::ComputedMemberExpression(member) => {
                member.static_property_name().map_or(Shape::Unknown, |key| {
                    self.expression_shape(&member.object, depth + 1).field(&key)
                })
            }
            Expression::CallExpression(call) => {
                if let Expression::StaticMemberExpression(member) = &call.callee
                    && ["filter", "slice", "toSorted", "toReversed"]
                        .contains(&member.property.name.as_str())
                {
                    return self.expression_shape(&member.object, depth + 1);
                }
                Shape::Unknown
            }
            _ => Shape::Unknown,
        }
    }
}
