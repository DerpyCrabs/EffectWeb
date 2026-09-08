//! Serialize compiler-owned static DOM shapes. Reject HTML parser repair cases;
//! those keep their exact native-node construction plan.
// Shared with the DOM runtime; template serialization must preserve the same attribute semantics.
fn attribute_metadata() -> &'static serde_json::Value {
    static DATA: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../../../runtime/src/dom-attributes.json"))
            .expect("valid DOM attribute metadata")
    })
}
fn attribute_kind(kind: &str, name: &str) -> bool {
    attribute_metadata()[kind]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item.as_str() == Some(name))
}

use serde_json::Value;

fn escape(value: &str) -> Option<String> {
    if value.contains(['\0', '\r']) {
        return None;
    }
    Some(
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;"),
    )
}
fn svg_tag(tag: &str) -> bool {
    matches!(
        tag,
        "svg"
            | "g"
            | "path"
            | "circle"
            | "ellipse"
            | "line"
            | "polyline"
            | "polygon"
            | "rect"
            | "text"
            | "tspan"
            | "defs"
            | "symbol"
            | "use"
            | "clipPath"
            | "mask"
            | "linearGradient"
            | "radialGradient"
            | "stop"
            | "pattern"
            | "marker"
            | "foreignObject"
    )
}
fn html_tag(tag: &str) -> bool {
    matches!(
        tag,
        "div"
            | "span"
            | "section"
            | "article"
            | "main"
            | "header"
            | "footer"
            | "nav"
            | "aside"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "p"
            | "a"
            | "button"
            | "b"
            | "strong"
            | "i"
            | "em"
            | "s"
            | "small"
            | "code"
            | "pre"
            | "label"
            | "ul"
            | "ol"
            | "li"
            | "table"
            | "thead"
            | "tbody"
            | "tfoot"
            | "tr"
            | "td"
            | "th"
            | "caption"
            | "colgroup"
            | "col"
            | "br"
            | "hr"
            | "img"
            | "figure"
            | "figcaption"
            | "details"
            | "summary"
            | "kbd"
            | "time"
            | "dl"
            | "dt"
            | "dd"
    )
}
fn render(value: &Value, ancestors: &mut Vec<String>, svg: bool) -> Option<String> {
    if value.is_null() {
        return Some("<!---->".into());
    }
    if let Some(text) = value.as_str() {
        if ancestors.last().is_some_and(|p| {
            matches!(
                p.as_str(),
                "table" | "thead" | "tbody" | "tfoot" | "tr" | "colgroup"
            )
        }) && !text.trim().is_empty()
        {
            return None;
        }
        return escape(text);
    }
    let node = value.as_array()?;
    let tag = node[0].as_str()?;
    if !svg
        && tag == "svg"
        && ancestors.last().is_some_and(|p| {
            matches!(
                p.as_str(),
                "table" | "thead" | "tbody" | "tfoot" | "tr" | "colgroup"
            )
        })
    {
        return None;
    }
    let svg = tag == "svg" || svg;
    if svg {
        if !svg_tag(tag) && !matches!(tag, "title" | "desc") {
            return None;
        }
    } else {
        if !html_tag(tag) {
            return None;
        }
        if ancestors.iter().any(|p| match p.as_str() {
            "a" | "button" => p == tag,
            "p" => !matches!(
                tag,
                "span"
                    | "a"
                    | "b"
                    | "strong"
                    | "i"
                    | "em"
                    | "s"
                    | "small"
                    | "code"
                    | "br"
                    | "img"
                    | "kbd"
                    | "time"
            ),
            "li" => tag == "li", // Nested lists use the native shape path.
            "dt" | "dd" => matches!(tag, "dt" | "dd"),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                matches!(tag, "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
            }
            _ => false,
        }) {
            return None;
        }
        let parent = ancestors.last().map(String::as_str);
        let valid_table_child = match parent {
            Some("table") => matches!(tag, "caption" | "colgroup" | "thead" | "tbody" | "tfoot"),
            Some("thead" | "tbody" | "tfoot") => tag == "tr",
            Some("tr") => matches!(tag, "td" | "th"),
            Some("colgroup") => tag == "col",
            _ => {
                !matches!(
                    tag,
                    "caption"
                        | "colgroup"
                        | "thead"
                        | "tbody"
                        | "tfoot"
                        | "tr"
                        | "td"
                        | "th"
                        | "col"
                ) || parent.is_none()
            }
        };
        if !valid_table_child {
            return None;
        }
    }
    let attrs = node[1].as_array()?;
    let mut attributes = std::collections::BTreeMap::new();
    for pair in attrs.as_chunks::<2>().0 {
        let name = pair[0].as_str()?;
        let name = attribute_metadata()["aliases"]
            .get(name)
            .and_then(|value| value.as_str())
            .unwrap_or(name);
        if svg
            && name.chars().any(|c| c.is_ascii_uppercase())
            && !matches!(
                name,
                "viewBox"
                    | "preserveAspectRatio"
                    | "gradientUnits"
                    | "gradientTransform"
                    | "patternUnits"
                    | "patternContentUnits"
                    | "patternTransform"
                    | "markerWidth"
                    | "markerHeight"
                    | "markerUnits"
                    | "refX"
                    | "refY"
                    | "textLength"
                    | "lengthAdjust"
                    | "clipPathUnits"
            )
        {
            return None;
        }
        // These attributes also write properties or maintain state in the DOM host.
        if matches!(
            name,
            "value" | "classList" | "checked" | "selected" | "muted"
        ) {
            return None;
        }
        let value = if pair[1].is_boolean() {
            attribute_metadata()["booleanValues"]
                .get(name)
                .and_then(|values| values.get(pair[1].to_string()))
                .unwrap_or(&pair[1])
        } else {
            &pair[1]
        };
        if value.is_null()
            || (value == false
                && !attribute_kind("booleanish", name)
                && !name.starts_with("aria-")
                && !name.starts_with("data-"))
        {
            attributes.remove(name);
        } else {
            let value = if value == true && attribute_kind("boolean", name) {
                String::new()
            } else {
                value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string())
            };
            attributes.insert(name, value);
        }
    }
    let mut html = format!("<{tag}");
    for (name, value) in attributes {
        html.push_str(&format!(" {name}=\"{}\"", escape(&value)?));
    }
    html.push('>');
    if !svg && matches!(tag, "br" | "hr" | "img" | "col") {
        return (node.len() == 2).then_some(html);
    }
    ancestors.push(tag.into());
    for child in &node[2..] {
        html.push_str(&render(child, ancestors, svg && tag != "foreignObject")?);
    }
    ancestors.pop();
    html.push_str(&format!("</{tag}>"));
    Some(html)
}
pub fn serialize(shape: &str) -> Option<(String, usize)> {
    let node: Value = serde_json::from_str(shape).ok()?;
    let tag = node[0].as_str()?;
    let svg = svg_tag(tag);
    let html = render(&node, &mut vec![], svg)?;
    let (prefix, suffix, depth) = match tag {
        "tr" => ("<table><tbody>", "</tbody></table>", 2),
        "td" | "th" => ("<table><tbody><tr>", "</tr></tbody></table>", 3),
        "col" => ("<table><colgroup>", "</colgroup></table>", 2),
        "caption" | "colgroup" | "thead" | "tbody" | "tfoot" => ("<table>", "</table>", 1),
        "svg" => ("", "", 0),
        _ if svg => ("<svg>", "</svg>", 1),
        _ => ("", "", 0),
    };
    Some((format!("{prefix}{html}{suffix}"), depth))
}
