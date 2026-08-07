//! Out-of-line storage for large response bodies: a formatted body lives in a
//! side file, and the frontend reads it one line-window at a time so a 20 MB
//! payload never crosses IPC or enters the JS heap whole.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use voleeo_core::VoleeoError;

/// Text bodies above this size are stored out-of-line and windowed.
pub const WINDOW_THRESHOLD: usize = 256 * 1024;
/// How many parsed bodies to keep hot (scroll + search hit the same one).
const CACHE_CAP: usize = 4;

/// A line window plus the body's total line count (for the virtual viewport).
#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BodyWindow {
    pub lines: Vec<String>,
    pub total_lines: u32,
    /// Parallel to `lines`: where the block opened on that line closes, or `0`
    /// when it opens none. The windowed viewer only holds a slice of the body,
    /// so it can't find a block's end itself.
    pub fold_ends: Vec<u32>,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BodyMatch {
    pub line: u32,
    /// Character offset within the line (0-based).
    pub col: u32,
    pub len: u32,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BodySearchResult {
    pub matches: Vec<BodyMatch>,
    pub total: u32,
    /// True when more matches existed than the returned cap.
    pub truncated: bool,
}

#[derive(Type, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BodyFilterResult {
    /// Key to pass to window/search to view the filtered result.
    pub filter_key: String,
    pub line_count: u32,
    /// Top-level matches (0 = the query matched nothing).
    pub match_count: u32,
    /// Set when the body isn't JSON or the JSONPath is invalid.
    pub error: Option<String>,
}

/// Apply a JSONPath query, mirroring the frontend's jsonpath-plus behavior:
/// a single match unwraps to its value, multiple matches become an array.
/// Returns the pretty-printed result text and the match count.
pub fn apply_jsonpath(body: &str, query: &str) -> Result<(String, u32), String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("Body is not valid JSON: {e}"))?;
    let path = serde_json_path::JsonPath::parse(query.trim())
        .map_err(|e| format!("Invalid JSONPath: {e}"))?;
    let nodes = path.query(&value).all();
    let count = u32::try_from(nodes.len()).unwrap_or(u32::MAX);
    if nodes.is_empty() {
        return Ok((String::new(), 0));
    }
    let out = if nodes.len() == 1 {
        nodes[0].clone()
    } else {
        serde_json::Value::Array(nodes.into_iter().cloned().collect())
    };
    let text = serde_json::to_string_pretty(&out).map_err(|e| e.to_string())?;
    Ok((text, count))
}

#[derive(Type, Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchOpts {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
}

const MATCH_CAP: usize = 5000;

/// A body indexed for windowing: the stored text plus everything derived from
/// one pass over it, so scroll and search never re-scan.
struct Parsed {
    text: String,
    /// `(start, end)` byte range per line, excluding the trailing `\n`.
    lines: Vec<(usize, usize)>,
    /// See `BodyWindow::fold_ends`. `0` is a safe sentinel — a block always
    /// closes after it opens, so line 0 is never an end.
    folds: Vec<u32>,
}

fn parse(text: String) -> Parsed {
    let lines = line_ranges(&text);
    let folds = fold_ends(&text, &lines);
    Parsed { text, lines, folds }
}

/// Match each block-opening line to the line that closes it, by bracket stack.
/// Bodies reach here pretty-printed (`format_for_storage`), where a trailing
/// `{`/`[` only ever opens a block: a string value ends in `"` and an inline
/// `{}` ends in `}` or `,`. Unbalanced text (non-JSON) simply yields no folds.
fn fold_ends(text: &str, lines: &[(usize, usize)]) -> Vec<u32> {
    let mut ends = vec![0u32; lines.len()];
    let mut open: Vec<usize> = Vec::new();
    for (i, &(s, e)) in lines.iter().enumerate() {
        let line = text[s..e].trim();
        if line.starts_with('}') || line.starts_with(']') {
            if let Some(start) = open.pop() {
                ends[start] = u32::try_from(i).unwrap_or(0);
            }
        }
        if line.ends_with('{') || line.ends_with('[') {
            open.push(i);
        }
    }
    ends
}

/// Matches `str::lines()`: a trailing `\n` does not yield an empty final line.
fn line_ranges(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut ranges = Vec::new();
    let mut start = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            ranges.push((start, i));
            start = i + 1;
        }
    }
    if start < bytes.len() {
        ranges.push((start, bytes.len()));
    }
    ranges
}

/// Pretty-print if the text is valid JSON, else return it unchanged.
pub fn format_for_storage(text: &str) -> String {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok())
        .unwrap_or_else(|| text.to_string())
}

pub fn count_lines(text: &str) -> u32 {
    u32::try_from(line_ranges(text).len()).unwrap_or(u32::MAX)
}

/// Capacity-bounded cache of parsed bodies keyed by response id.
#[derive(Default)]
pub struct BodyCache {
    map: HashMap<String, Arc<Parsed>>,
    order: VecDeque<String>,
}

impl BodyCache {
    fn get_or_load(
        &mut self,
        key: &str,
        load: impl FnOnce() -> Result<String, VoleeoError>,
    ) -> Result<Arc<Parsed>, VoleeoError> {
        if let Some(p) = self.map.get(key) {
            return Ok(p.clone());
        }
        let parsed = Arc::new(parse(load()?));
        self.map.insert(key.to_string(), parsed.clone());
        self.order.push_back(key.to_string());
        while self.order.len() > CACHE_CAP {
            if let Some(evict) = self.order.pop_front() {
                self.map.remove(&evict);
            }
        }
        Ok(parsed)
    }

    pub fn invalidate(&mut self, key: &str) {
        self.map.remove(key);
        self.order.retain(|k| k != key);
    }
}

pub type SharedBodyCache = Arc<Mutex<BodyCache>>;

fn lock(cache: &SharedBodyCache) -> Result<std::sync::MutexGuard<'_, BodyCache>, VoleeoError> {
    cache
        .lock()
        .map_err(|_| VoleeoError::Storage("body cache poisoned".into()))
}

/// Return `count` lines starting at `start_line` from the cached/loaded body.
pub fn window(
    cache: &SharedBodyCache,
    key: &str,
    load: impl FnOnce() -> Result<String, VoleeoError>,
    start_line: u32,
    count: u32,
) -> Result<BodyWindow, VoleeoError> {
    let parsed = lock(cache)?.get_or_load(key, load)?;
    let total = parsed.lines.len();
    let start = (start_line as usize).min(total);
    let end = start.saturating_add(count as usize).min(total);
    let lines = parsed.lines[start..end]
        .iter()
        .map(|&(s, e)| parsed.text[s..e].to_string())
        .collect();
    Ok(BodyWindow {
        lines,
        total_lines: u32::try_from(total).unwrap_or(u32::MAX),
        fold_ends: parsed.folds[start..end].to_vec(),
    })
}

/// Scan the body for `query`, returning up to `MATCH_CAP` `{line, col, len}`.
pub fn search(
    cache: &SharedBodyCache,
    key: &str,
    load: impl FnOnce() -> Result<String, VoleeoError>,
    query: &str,
    opts: &SearchOpts,
) -> Result<BodySearchResult, VoleeoError> {
    let parsed = lock(cache)?.get_or_load(key, load)?;
    if query.is_empty() {
        return Ok(BodySearchResult {
            matches: Vec::new(),
            total: 0,
            truncated: false,
        });
    }

    // ASCII-fold both sides for case-insensitive search — byte-length preserving,
    // so match offsets still index the original text.
    let hay = if opts.case_sensitive {
        parsed.text.clone()
    } else {
        parsed.text.to_ascii_lowercase()
    };
    let needle = if opts.case_sensitive {
        query.to_string()
    } else {
        query.to_ascii_lowercase()
    };
    let needle_chars = u32::try_from(query.chars().count()).unwrap_or(0);
    let bytes = parsed.text.as_bytes();

    let mut matches = Vec::new();
    let mut total = 0u32;
    for (pos, _) in hay.match_indices(&needle) {
        if opts.whole_word && !is_word_bounded(bytes, pos, needle.len()) {
            continue;
        }
        total += 1;
        if matches.len() < MATCH_CAP {
            let li = parsed
                .lines
                .partition_point(|&(s, _)| s <= pos)
                .saturating_sub(1);
            let (ls, _) = parsed.lines.get(li).copied().unwrap_or((0, 0));
            let col = u32::try_from(parsed.text[ls..pos].chars().count()).unwrap_or(0);
            matches.push(BodyMatch {
                line: u32::try_from(li).unwrap_or(0),
                col,
                len: needle_chars,
            });
        }
    }
    Ok(BodySearchResult {
        truncated: total as usize > matches.len(),
        total,
        matches,
    })
}

fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn is_word_bounded(bytes: &[u8], start: usize, len: usize) -> bool {
    let before = start.checked_sub(1).map(|i| bytes[i]);
    let after = bytes.get(start + len).copied();
    before.map(is_word) != Some(true) && after.map(is_word) != Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_ends_pairs_each_block_with_its_closing_line() {
        let text = format_for_storage(r#"{"a":[{"b":1}],"empty":{},"s":"has { brace","z":2}"#);
        let ends = fold_ends(&text, &line_ranges(&text));
        let lines: Vec<&str> = text.lines().collect();

        // 0 `{` · 1 `"a": [` · 2 `{` · 3 `"b": 1` · 4 `},` · 5 `],`
        // 6 `"empty": {},` · 7 `"s": "has { brace",` · 8 `"z": 2` · 9 `}`
        assert_eq!(lines.len(), 10, "layout changed: {text}");
        assert_eq!(ends[0], 9, "root object");
        assert_eq!(ends[1], 5, "array");
        assert_eq!(ends[2], 4, "object inside the array");
        assert_eq!(ends[3], 0, "plain value opens nothing");
        assert_eq!(ends[6], 0, "inline {{}} is not an opener");
        assert_eq!(ends[7], 0, "a brace inside a string is not an opener");
    }
}
