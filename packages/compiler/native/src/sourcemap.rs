//! Compose Oxc's generated-code map with immutable source edits and explicit JSX anchors.
use oxc::{
    allocator::Allocator,
    codegen::{Codegen, CodegenOptions},
    parser::Parser,
    span::{SourceType, Span},
};
use oxc_sourcemap::SourceMapBuilder;

/// Avoid consuming a user's comment or string that happens to resemble our marker.
/// Compute once per compilation, then emit `{prefix}{original_byte_offset}__*/`.
pub fn marker_prefix(source: &str) -> String {
    let mut prefix = "/*__TV_MAP_".to_owned();
    let mut nonce = 0;
    while source.contains(&prefix) {
        nonce += 1;
        prefix = format!("/*__TV_MAP_{nonce}_");
    }
    prefix
}

struct Segment {
    start: usize,
    end: usize,
    original: usize,
    copied: bool,
    anchors: Vec<(usize, usize)>,
}

struct Line {
    start: usize,
    end: usize,
    // ASCII lines use identity columns; Unicode lines store UTF-8/UTF-16 boundaries.
    columns: Option<Vec<(usize, u32)>>,
}
struct Positions {
    lines: Vec<Line>,
}
impl Positions {
    fn new(source: &str) -> Self {
        let mut starts = vec![0];
        let mut chars = source.char_indices().peekable();
        while let Some((offset, character)) = chars.next() {
            let end = match character {
                '\r' if chars.peek().is_some_and(|(_, next)| *next == '\n') => {
                    chars.next().unwrap().0 + 1
                }
                '\r' | '\n' | '\u{2028}' | '\u{2029}' => offset + character.len_utf8(),
                _ => continue,
            };
            starts.push(end);
        }
        let lines = starts
            .iter()
            .enumerate()
            .map(|(index, &start)| {
                let end = starts.get(index + 1).copied().unwrap_or(source.len());
                let text = &source[start..end];
                let columns = if text.is_ascii() {
                    None
                } else {
                    let mut column = 0;
                    let mut boundaries = Vec::new();
                    for (byte, character) in text.char_indices() {
                        boundaries.push((byte, column));
                        column += character.len_utf16() as u32;
                    }
                    boundaries.push((text.len(), column));
                    Some(boundaries)
                };
                Line {
                    start,
                    end,
                    columns,
                }
            })
            .collect();
        Self { lines }
    }
    fn offset(&self, line: u32, column: u32) -> usize {
        let Some(line) = self.lines.get(line as usize) else {
            return self.lines.last().unwrap().end;
        };
        let byte = match &line.columns {
            None => column as usize,
            Some(columns) => {
                let index = columns
                    .partition_point(|(_, col)| *col <= column)
                    .saturating_sub(1);
                columns[index].0
            }
        };
        (line.start + byte).min(line.end)
    }
    fn position(&self, offset: usize) -> (u32, u32) {
        let index = self
            .lines
            .partition_point(|line| line.start <= offset)
            .saturating_sub(1);
        let line = &self.lines[index];
        let relative = offset.min(line.end) - line.start;
        let column = match &line.columns {
            None => relative as u32,
            Some(columns) => {
                columns[columns
                    .partition_point(|(byte, _)| *byte <= relative)
                    .saturating_sub(1)]
                .1
            }
        };
        (index as u32, column)
    }
}

/// Apply nonoverlapping source edits, format through Oxc, and map the result to the original TSX.
/// Zero-width insertions (imports/templates) are allowed before a replacement at the same offset.
pub fn emit(
    original: &str,
    filename: &str,
    mut edits: Vec<(Span, String)>,
) -> Result<(String, String), String> {
    edits.sort_by_key(|(span, _)| (span.start, span.end));
    let mut transformed = String::new();
    let mut segments = Vec::new();
    let mut cursor = 0;
    let mut append = |text: &str, offset: usize, copied: bool, output: &mut String| {
        if text.is_empty() {
            return;
        }
        let start = output.len();
        output.push_str(text);
        segments.push(Segment {
            start,
            end: output.len(),
            original: offset,
            copied,
            anchors: Vec::new(),
        });
    };
    for (span, replacement) in edits {
        let start = span.start as usize;
        let end = span.end as usize;
        if start < cursor
            || start > end
            || end > original.len()
            || !original.is_char_boundary(start)
            || !original.is_char_boundary(end)
        {
            return Err("Invalid or overlapping snapshot compiler source edits".to_owned());
        }
        append(&original[cursor..start], cursor, true, &mut transformed);
        append(&replacement, start, false, &mut transformed);
        cursor = end;
    }
    append(&original[cursor..], cursor, true, &mut transformed);

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &transformed, SourceType::tsx()).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(format!(
            "Snapshot compiler emitted invalid TSX: {:?}",
            parsed.diagnostics
        ));
    }
    let mut program = parsed.program;
    let prefix = marker_prefix(original);
    let mut marker_spans = Vec::new();
    for comment in &program.comments {
        let start = comment.span.start as usize;
        let end = comment.span.end as usize;
        let text = &transformed[start..end];
        let Some(offset) = text
            .strip_prefix(&prefix)
            .and_then(|text| text.strip_suffix("__*/"))
            .and_then(|text| text.parse::<usize>().ok())
        else {
            continue;
        };
        let index = segments
            .partition_point(|segment| segment.start <= start)
            .saturating_sub(1);
        let Some(segment) = segments.get_mut(index) else {
            continue;
        };
        if segment.copied || end > segment.end {
            continue;
        }
        if offset > original.len() || !original.is_char_boundary(offset) {
            return Err("Snapshot source-map anchor is outside the original source".to_owned());
        }
        segment.anchors.push((end, offset));
        marker_spans.push(comment.span.start);
    }
    program
        .comments
        .retain(|comment| marker_spans.binary_search(&comment.span.start).is_err());
    let generated = Codegen::new()
        .with_options(CodegenOptions {
            source_map_path: Some(filename.into()),
            ..CodegenOptions::default()
        })
        .build(&program);
    let generated_map = generated
        .map
        .ok_or_else(|| "Oxc did not emit a source map".to_owned())?;
    let transformed_positions = Positions::new(&transformed);
    let original_positions = Positions::new(original);
    let mut map = SourceMapBuilder::default();
    let source_id = map.set_source_and_content(filename, original);
    for token in generated_map.get_tokens() {
        let offset = transformed_positions.offset(token.get_src_line(), token.get_src_col());
        let index = segments
            .partition_point(|segment| segment.start <= offset)
            .saturating_sub(1);
        let original_offset = if let Some(segment) = segments.get(index) {
            if segment.copied {
                segment.original + offset.min(segment.end) - segment.start
            } else {
                let anchor = segment
                    .anchors
                    .partition_point(|(position, _)| *position <= offset);
                anchor
                    .checked_sub(1)
                    .map_or(segment.original, |index| segment.anchors[index].1)
            }
        } else {
            0
        };
        let (line, column) = original_positions.position(original_offset);
        let name_id = token
            .get_name_id()
            .and_then(|id| generated_map.get_name(id))
            .map(|name| map.add_name(name));
        map.add_token(
            token.get_dst_line(),
            token.get_dst_col(),
            line,
            column,
            token.get_source_id().map(|_| source_id),
            name_id,
        );
    }
    Ok((generated.code, map.into_sourcemap().to_json_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_sourcemap::SourceMap;

    #[test]
    fn maps_copied_unicode_and_generated_work_to_original_source() {
        let source = "const label = '😀'; const marker = 17;\r\nconst view = <button/>;\n// keep this comment\n";
        let start = source.find("<button").unwrap();
        let end = start + "<button/>".len();
        let prefix = marker_prefix(source);
        let replacement = format!("{prefix}{start}__*/dom.element('button')");
        let (code, json) = emit(
            source,
            "unicode.tsx",
            vec![(Span::new(start as u32, end as u32), replacement)],
        )
        .unwrap();
        assert!(code.contains("keep this comment"));
        assert!(!code.contains(&prefix));
        let map = SourceMap::from_json_string(&json).unwrap();
        assert_eq!(map.get_source_content(0), Some(source));
        assert!(
            map.get_tokens()
                .any(|token| token.get_src_line() == 0 && token.get_src_col() == 26)
        );
        assert!(
            map.get_tokens()
                .any(|token| token.get_src_line() == 1 && token.get_src_col() == 13)
        );
    }

    #[test]
    fn preserves_user_markers_and_string_literals() {
        let source = "/*__TV_MAP_17__*/\nconst text = '/*__TV_MAP_18__*/';\nconst view = <b/>;";
        let prefix = marker_prefix(source);
        assert_ne!(prefix, "/*__TV_MAP_");
        let start = source.find("<b/>").unwrap();
        let (code, _) = emit(
            source,
            "comments.tsx",
            vec![(
                Span::new(start as u32, (start + 4) as u32),
                format!("{prefix}{start}__*/dom.element('b')"),
            )],
        )
        .unwrap();
        assert!(code.contains("/*__TV_MAP_17__*/"));
        assert!(code.contains("/*__TV_MAP_18__*/"));
        assert!(!code.contains(&prefix));
    }

    #[test]
    fn supports_prefix_insertion_and_rejects_overlapping_edits() {
        let source = "const value = 1;";
        assert!(
            emit(
                source,
                "test.ts",
                vec![
                    (Span::new(0, 0), "import 'runtime';\n".into()),
                    (Span::new(0, 5), "let".into())
                ]
            )
            .is_ok()
        );
        assert!(
            emit(
                source,
                "test.ts",
                vec![
                    (Span::new(0, 6), "let ".into()),
                    (Span::new(5, 7), "x".into())
                ]
            )
            .is_err()
        );
    }

    #[test]
    fn handles_all_js_line_endings_and_utf16_columns() {
        let source = "😀x\r\ny\rz\u{2028}a\u{2029}b\n";
        let positions = Positions::new(source);
        assert_eq!(positions.position(4), (0, 2));
        assert_eq!(positions.offset(0, 2), 4);
        for (line, text) in ["😀", "y", "z", "a", "b"].iter().enumerate() {
            assert!(source[positions.offset(line as u32, 0)..].starts_with(text));
        }
    }
}
