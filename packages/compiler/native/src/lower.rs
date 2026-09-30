//! JSX syntax lowering. Calls, callbacks, bindings and control flow remain ordinary JavaScript.
use oxc::{
    allocator::Allocator,
    ast::ast::*,
    ast_visit::{Visit, walk},
    span::{GetSpan, Span},
    syntax::xml_entities::decode_entities,
};
use serde::{Deserialize, Serialize};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub import_source: Option<String>,
    pub runtime_module: Option<String>,
    #[serde(default)]
    pub development: bool,
    #[serde(default)]
    pub diagnostics_only: bool,
    #[serde(default)]
    pub lint: bool,
}
#[derive(Serialize)]
pub struct Diagnostic {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub message: String,
    pub severity: String,
    pub code: String,
    pub category: String,
    pub remedy: String,
}
pub fn diagnostic(source: &str, filename: &str, span: Span, message: &str) -> Diagnostic {
    let preceding = &source[..span.start as usize];
    let (mut line, mut column) = (1, 1);
    let mut after_cr = false;
    for character in preceding.chars() {
        match character {
            '\n' if after_cr => {}
            '\r' | '\n' | '\u{2028}' | '\u{2029}' => {
                line += 1;
                column = 1;
            }
            _ => column += character.len_utf16(),
        }
        after_cr = character == '\r';
    }
    Diagnostic {
        file: filename.into(),
        line,
        column,
        message: message.into(),
        severity: "error".into(),
        code: "EW1001".into(),
        category: "correctness".into(),
        remedy: message.into(),
    }
}
fn quote(value: &str) -> String {
    serde_json::to_string(value).unwrap()
}
fn decoded(value: &str) -> String {
    let allocator = Allocator::default();
    let mut decoded = None;
    decode_entities(value, &mut decoded, value.len(), &allocator);
    decoded.map_or_else(|| value.into(), |value| value.into_str().to_owned())
}
fn jsx_text(value: &str) -> String {
    let lines = value.replace('\r', "");
    let lines = lines.split('\n').collect::<Vec<_>>();
    decoded(
        &lines
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let value = value.replace('\t', " ");
                let value = if index > 0 {
                    value.trim_start().to_owned()
                } else {
                    value
                };
                if index + 1 < lines.len() {
                    value.trim_end().to_owned()
                } else {
                    value
                }
            })
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
    )
}
pub struct Lower<'s> {
    pub source: &'s str,
    pub runtime: String,
    pub edits: Vec<(Span, String)>,
    pub hoisted: Vec<String>,
    pub errors: Vec<(Span, String)>,
    /// Intrinsic elements whose attributes and children are all literals, by their hoisted name.
    static_elements: Vec<(Span, String)>,
    /// One shared factory per tag; call sites with source metadata keep their own.
    factories: Vec<(String, String)>,
    prefix: String,
    anchor: String,
    filename: &'s str,
    development: bool,
}
impl<'s> Lower<'s> {
    pub fn new(source: &'s str, filename: &'s str, development: bool) -> Self {
        let mut prefix = "_ew_".to_string();
        while source.contains(&prefix) {
            prefix.push('_');
        }
        Self {
            source,
            runtime: format!("{prefix}dom"),
            edits: vec![],
            hoisted: vec![],
            errors: vec![],
            static_elements: vec![],
            factories: vec![],
            anchor: crate::sourcemap::marker_prefix(source),
            prefix,
            filename,
            development,
        }
    }
    fn binding(&self, span: Span) -> serde_json::Value {
        let expression = &self.source[span.start as usize..span.end as usize];
        let location = diagnostic(self.source, self.filename, span, "");
        serde_json::json!({ "file": self.filename, "line": location.line, "column": location.column,
            "expression": expression })
    }
    fn expression(&self, span: Span) -> String {
        let mut edits = self
            .edits
            .iter()
            .filter(|(child, _)| span.contains_inclusive(*child))
            .collect::<Vec<_>>();
        edits.sort_by_key(|(child, _)| (child.start, std::cmp::Reverse(child.end)));
        let mut result = String::new();
        let mut offset = span.start as usize;
        for (child, replacement) in edits {
            if (child.start as usize) < offset {
                continue;
            }
            result.push_str(&self.source[offset..child.start as usize]);
            result.push_str(replacement);
            offset = child.end as usize;
        }
        result.push_str(&self.source[offset..span.end as usize]);
        format!("{}{}__*/({})", self.anchor, span.start, result)
    }
    fn static_element(&self, span: Span) -> Option<&str> {
        self.static_elements
            .iter()
            .find(|(child, _)| *child == span)
            .map(|(_, name)| name.as_str())
    }
    /// Each child's code and whether it is a literal (text or a hoisted static element).
    fn children(&self, children: &[JSXChild<'_>]) -> Vec<(String, bool)> {
        children
            .iter()
            .filter_map(|child| match child {
                JSXChild::Text(text) => {
                    let text = jsx_text(text.value.as_str());
                    (!text.is_empty()).then(|| (quote(&text), true))
                }
                JSXChild::ExpressionContainer(container) => container
                    .expression
                    .as_expression()
                    .map(|e| (self.expression(e.span()), false)),
                JSXChild::Spread(spread) => Some((
                    format!("...({})", self.expression(spread.expression.span())),
                    false,
                )),
                _ => Some(match self.static_element(child.span()) {
                    Some(name) => (name.to_owned(), true),
                    None => (self.expression(child.span()), false),
                }),
            })
            .collect()
    }
}
impl<'a> Visit<'a> for Lower<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        walk::walk_jsx_element(self, element);
        let opening = &element.opening_element;
        let name =
            &self.source[opening.name.span().start as usize..opening.name.span().end as usize];
        let intrinsic = matches!(
            &opening.name,
            JSXElementName::Identifier(_) | JSXElementName::IdentifierReference(_)
        ) && (name.starts_with(|c: char| c.is_ascii_lowercase())
            || name.contains('-'))
            || matches!(&opening.name, JSXElementName::NamespacedName(_));
        let mut props = vec![];
        let mut bindings = serde_json::Map::new();
        // Literal attributes (strings and bare booleans) form an immutable object the
        // compiler hoists once, so the renderer skips them by identity on every publication.
        let mut static_attributes = true;
        for attribute in &opening.attributes {
            match attribute {
                JSXAttributeItem::SpreadAttribute(spread) => {
                    static_attributes = false;
                    props.push(format!("...({})", self.expression(spread.argument.span())))
                }
                JSXAttributeItem::Attribute(attribute) => {
                    let attr_name = &self.source
                        [attribute.name.span().start as usize..attribute.name.span().end as usize];
                    if intrinsic && matches!(attr_name, "key" | "ref" | "innerHTML") {
                        self.errors.push((attribute.span, format!("JSX attribute {attr_name} is unsupported. Use explicit lists or owned DOM bindings.")));
                    }
                    let value = match &attribute.value {
                        None => "true".into(),
                        Some(JSXAttributeValue::StringLiteral(value)) => {
                            quote(&decoded(value.value.as_str()))
                        }
                        Some(JSXAttributeValue::ExpressionContainer(container)) => {
                            static_attributes = false;
                            container
                                .expression
                                .as_expression()
                                .map_or_else(|| "undefined".into(), |e| self.expression(e.span()))
                        }
                        Some(value) => {
                            static_attributes = false;
                            self.expression(value.span())
                        }
                    };
                    let key = if attr_name == "__proto__" {
                        format!("[{}]", quote(attr_name))
                    } else {
                        quote(attr_name)
                    };
                    props.push(format!("{key}:{value}"));
                    if let Some(JSXAttributeValue::ExpressionContainer(container)) =
                        &attribute.value
                        && let Some(expression) = container.expression.as_expression()
                    {
                        bindings.insert(attr_name.to_owned(), self.binding(expression.span()));
                    }
                }
            }
        }
        let children = self.children(&element.children);
        let meaningful = element
            .children
            .iter()
            .filter(|child| match child {
                JSXChild::Text(text) => !jsx_text(text.value.as_str()).is_empty(),
                JSXChild::ExpressionContainer(container) => {
                    container.expression.as_expression().is_some()
                }
                _ => true,
            })
            .collect::<Vec<_>>();
        if let [JSXChild::ExpressionContainer(container)] = meaningful.as_slice()
            && let Some(expression) = container.expression.as_expression()
        {
            bindings.insert("children".into(), self.binding(expression.span()));
        }
        let expression = if intrinsic {
            let located = self.development && !bindings.is_empty();
            let shared = (!located)
                .then(|| self.factories.iter().find(|(tag, _)| tag == name))
                .flatten()
                .map(|(_, factory)| factory.clone());
            let factory = shared.unwrap_or_else(|| {
                let factory = format!("{}jsx{}", self.prefix, self.hoisted.len());
                self.hoisted.push(format!(
                    "const {factory}=/*@__PURE__*/{}.markup({}{});",
                    self.runtime,
                    quote(name),
                    if located {
                        format!(",{}", serde_json::Value::Object(bindings))
                    } else {
                        String::new()
                    }
                ));
                if !located {
                    self.factories.push((name.to_owned(), factory.clone()));
                }
                factory
            });
            let attrs = if props.is_empty() {
                "null".to_owned()
            } else if static_attributes {
                let constant = format!("{}a{}", self.prefix, self.hoisted.len());
                self.hoisted
                    .push(format!("const {constant}={{{}}};", props.join(",")));
                constant
            } else {
                format!("{{{}}}", props.join(","))
            };
            // Children are positional arguments, so the element keeps one binding per child.
            // A spread child has no fixed count and stays an ordinary content array.
            let arguments = if children.iter().any(|(code, _)| code.starts_with("...")) {
                format!(
                    "{attrs},[{}]",
                    children
                        .iter()
                        .map(|(code, _)| code.as_str())
                        .collect::<Vec<_>>()
                        .join(",")
                )
            } else {
                std::iter::once(attrs.clone())
                    .chain(children.iter().map(|(code, _)| code.clone()))
                    .collect::<Vec<_>>()
                    .join(",")
            };
            let static_children = children.iter().all(|(_, literal)| *literal);
            if (props.is_empty() || static_attributes) && static_children {
                let constant = format!("{}s{}", self.prefix, self.hoisted.len());
                self.hoisted.push(format!(
                    "const {constant}=/*@__PURE__*/{factory}({arguments});"
                ));
                self.static_elements.push((element.span, constant.clone()));
                constant
            } else {
                format!("{factory}({arguments})")
            }
        } else {
            if !children.is_empty() {
                props.push(format!(
                    "children:{}",
                    if children.len() == 1 && !children[0].0.starts_with("...") {
                        children[0].0.clone()
                    } else {
                        format!(
                            "[{}]",
                            children
                                .iter()
                                .map(|(code, _)| code.as_str())
                                .collect::<Vec<_>>()
                                .join(",")
                        )
                    }
                ));
            }
            // Components are ordinary functions. A member expression is called without its
            // object as `this`, matching a direct call of the view.
            if name.contains('.') {
                format!("(0,{name})({{{}}})", props.join(","))
            } else {
                format!("{name}({{{}}})", props.join(","))
            }
        };
        self.edits.push((element.span, expression));
    }
    fn visit_jsx_fragment(&mut self, fragment: &JSXFragment<'a>) {
        walk::walk_jsx_fragment(self, fragment);
        self.edits.push((
            fragment.span,
            format!(
                "[{}]",
                self.children(&fragment.children)
                    .iter()
                    .map(|(code, _)| code.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        ));
    }
}
