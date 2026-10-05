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
/// The value of one dynamic position and, in development, where it was written.
type Hole = (String, Option<serde_json::Value>);
#[derive(Clone)]
struct Shape {
    code: String,
    /// The dynamic positions in source order: an element's attributes before its children.
    holes: Vec<Hole>,
}
struct Child {
    code: String,
    /// Literal text or a hoisted static element.
    literal: bool,
    /// Whether a literal child can be cloned as part of a containing tree.
    clonable: bool,
    /// The child's entry in the containing element's shape.
    shape: String,
    holes: Vec<Hole>,
}
// Elements with their own state or loading behaviour are created, never cloned from a
// literal template.
const UNTEMPLATED: [&str; 12] = [
    "input", "textarea", "select", "option", "optgroup", "iframe", "video", "audio", "object",
    "embed", "script", "canvas",
];
// Elements that start loading or playing from their attributes, even outside the document:
// a cloned tree leaves their attributes to be applied to each clone.
const LOADING: [&str; 6] = ["iframe", "video", "audio", "object", "embed", "script"];
pub struct Lower<'s> {
    pub source: &'s str,
    pub runtime: String,
    pub edits: Vec<(Span, String)>,
    pub hoisted: Vec<String>,
    pub errors: Vec<(Span, String)>,
    /// Intrinsic elements whose attributes and children are all literals, by their hoisted
    /// name, and whether the renderer can clone them as part of a containing tree.
    static_elements: Vec<(Span, String, bool)>,
    /// One shared factory per tag; call sites with source metadata keep their own.
    factories: Vec<(String, String)>,
    /// The static shape of each intrinsic element, for the element that contains it: a
    /// hoisted site name when it has nested elements of its own, an inline literal otherwise.
    shapes: Vec<(Span, Shape)>,
    pub prefix: String,
    /// Declarations for function-prop sites, hoisted with the factories.
    pub site_declarations: Vec<String>,
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
            site_declarations: vec![],
            shapes: vec![],
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
    fn static_element(&self, span: Span) -> Option<(&str, bool)> {
        self.static_elements
            .iter()
            .find(|(child, _, _)| *child == span)
            .map(|(_, name, clonable)| (name.as_str(), *clonable))
    }
    fn hole(&self, code: &str, span: Option<Span>) -> Hole {
        (
            code.to_owned(),
            span.filter(|_| self.development)
                .map(|span| self.binding(span)),
        )
    }
    fn children(&self, children: &[JSXChild<'_>]) -> Vec<Child> {
        children
            .iter()
            .filter_map(|child| match child {
                JSXChild::Text(text) => {
                    let text = jsx_text(text.value.as_str());
                    (!text.is_empty()).then(|| Child {
                        code: quote(&text),
                        literal: true,
                        clonable: true,
                        shape: quote(&text),
                        holes: vec![],
                    })
                }
                JSXChild::ExpressionContainer(container) => {
                    container.expression.as_expression().map(|e| {
                        let code = self.expression(e.span());
                        Child {
                            holes: vec![self.hole(&code, Some(e.span()))],
                            code,
                            literal: false,
                            clonable: false,
                            shape: "1".to_owned(),
                        }
                    })
                }
                JSXChild::Spread(spread) => Some(Child {
                    code: format!("...({})", self.expression(spread.expression.span())),
                    literal: false,
                    clonable: false,
                    shape: "1".to_owned(),
                    holes: vec![],
                }),
                _ => Some(match self.static_element(child.span()) {
                    Some((name, true)) => Child {
                        code: name.to_owned(),
                        literal: true,
                        clonable: true,
                        shape: name.to_owned(),
                        holes: vec![],
                    },
                    // A literal element the renderer has to create is a position of its own.
                    Some((name, false)) => Child {
                        code: name.to_owned(),
                        literal: true,
                        clonable: false,
                        shape: "1".to_owned(),
                        holes: vec![self.hole(name, None)],
                    },
                    None => {
                        let code = self.expression(child.span());
                        match self.shapes.iter().find(|(span, _)| *span == child.span()) {
                            Some((_, shape)) => Child {
                                code,
                                literal: false,
                                clonable: false,
                                shape: shape.code.clone(),
                                holes: shape.holes.clone(),
                            },
                            None => Child {
                                holes: vec![self.hole(&code, None)],
                                code,
                                literal: false,
                                clonable: false,
                                shape: "1".to_owned(),
                            },
                        }
                    }
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
        // Attributes the renderer manages as bindings even when written as literals, and
        // attributes that can supply children: such an element's attributes are never baked.
        let mut bound_attributes = false;
        let mut supplied_children = false;
        for attribute in &opening.attributes {
            match attribute {
                JSXAttributeItem::SpreadAttribute(spread) => {
                    static_attributes = false;
                    supplied_children = true;
                    props.push(format!("...({})", self.expression(spread.argument.span())))
                }
                JSXAttributeItem::Attribute(attribute) => {
                    let attr_name = &self.source
                        [attribute.name.span().start as usize..attribute.name.span().end as usize];
                    if matches!(attr_name, "value" | "checked" | "use" | "children")
                        || attr_name.starts_with("on:")
                        || (attr_name.starts_with("on")
                            && attr_name[2..].starts_with(|c: char| c.is_ascii_uppercase()))
                    {
                        bound_attributes = true;
                    }
                    if attr_name == "children" {
                        supplied_children = true;
                    }
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
            let spread_child = children.iter().any(|child| child.code.starts_with("..."));
            let static_children = children.iter().all(|child| child.literal);
            let fully_static = (props.is_empty() || static_attributes) && static_children;
            // Children are positional arguments, so the element keeps one binding per child.
            // A spread child has no fixed count and stays an ordinary content array.
            let content = spread_child.then(|| {
                format!(
                    "[{}]",
                    children
                        .iter()
                        .map(|child| child.code.as_str())
                        .collect::<Vec<_>>()
                        .join(",")
                )
            });
            // The element's static shape. An element containing nested elements becomes a
            // block: the renderer clones the whole tree and receives only the values of its
            // dynamic positions. Attributes that can carry the element's children have no
            // fixed shape.
            let mut site = None;
            if !(fully_static
                || name.contains('-')
                || name.contains(':')
                || children.is_empty() && supplied_children)
            {
                let mut holes = vec![];
                let attributes = if props.is_empty() {
                    "null"
                } else if static_attributes && !bound_attributes && !LOADING.contains(&name) {
                    attrs.as_str()
                } else {
                    holes.push(self.hole(&attrs, None));
                    "0"
                };
                let nested = content.is_none()
                    && children
                        .iter()
                        .any(|child| child.shape != "1" && !child.shape.starts_with('"'));
                let positions = match &content {
                    Some(content) => {
                        holes.push(self.hole(content, None));
                        "1".to_owned()
                    }
                    None => {
                        holes.extend(
                            children
                                .iter()
                                .flat_map(|child| child.holes.iter().cloned()),
                        );
                        children
                            .iter()
                            .map(|child| child.shape.as_str())
                            .collect::<Vec<_>>()
                            .join(",")
                    }
                };
                let shape = format!("[{},{attributes},[{positions}]]", quote(name));
                if nested {
                    let constant = format!("{}k{}", self.prefix, self.hoisted.len());
                    self.hoisted.push(format!("const {constant}={shape};"));
                    self.shapes.push((
                        element.span,
                        Shape {
                            code: constant.clone(),
                            holes: holes.clone(),
                        },
                    ));
                    site = Some((constant, holes));
                } else {
                    self.shapes
                        .push((element.span, Shape { code: shape, holes }));
                }
            }
            if let Some((site, holes)) = site {
                let factory = format!("{}jsx{}", self.prefix, self.hoisted.len());
                let sources = if holes.iter().any(|(_, source)| source.is_some()) {
                    format!(
                        ",[{}]",
                        holes
                            .iter()
                            .map(|(_, source)| source
                                .as_ref()
                                .map_or_else(|| "void 0".to_owned(), ToString::to_string))
                            .collect::<Vec<_>>()
                            .join(",")
                    )
                } else {
                    String::new()
                };
                self.hoisted.push(format!(
                    "const {factory}=/*@__PURE__*/{}.block({site}{sources});",
                    self.runtime
                ));
                format!(
                    "{factory}({})",
                    holes
                        .iter()
                        .map(|(code, _)| code.as_str())
                        .collect::<Vec<_>>()
                        .join(",")
                )
            } else {
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
                let arguments = match &content {
                    Some(content) => format!("{attrs},{content}"),
                    None => std::iter::once(attrs.clone())
                        .chain(children.iter().map(|child| child.code.clone()))
                        .collect::<Vec<_>>()
                        .join(","),
                };
                if fully_static {
                    let constant = format!("{}s{}", self.prefix, self.hoisted.len());
                    // A fully literal element is marked so the renderer clones it instead of
                    // building it again for every mount.
                    self.hoisted.push(format!(
                        "const {constant}=/*@__PURE__*/{}.still(/*@__PURE__*/{factory}({arguments}));",
                        self.runtime
                    ));
                    let clonable = !UNTEMPLATED.contains(&name)
                        && !name.contains('-')
                        && !bound_attributes
                        && children.iter().all(|child| child.clonable);
                    self.static_elements
                        .push((element.span, constant.clone(), clonable));
                    constant
                } else {
                    format!("{factory}({arguments})")
                }
            }
        } else {
            if !children.is_empty() {
                props.push(format!(
                    "children:{}",
                    if children.len() == 1 && !children[0].code.starts_with("...") {
                        children[0].code.clone()
                    } else {
                        format!(
                            "[{}]",
                            children
                                .iter()
                                .map(|child| child.code.as_str())
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
                    .map(|child| child.code.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        ));
    }
}
