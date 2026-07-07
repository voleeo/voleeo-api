//! Pure text helpers for send-time resolution: URL path-param handling,
//! percent-encoding, and base64 (Basic auth).

use std::collections::HashSet;

use super::vars::is_identifier;

/// Extract `:name` path-parameter names from a URL.
pub(super) fn extract_path_params(url: &str) -> HashSet<String> {
    let path = url.split('?').next().unwrap_or(url);
    let mut names = HashSet::new();
    let mut rest = path;
    while let Some(colon) = rest.find(':') {
        rest = &rest[colon + 1..];
        let end = rest
            .find(|c: char| !c.is_alphanumeric() && c != '_')
            .unwrap_or(rest.len());
        let name = &rest[..end];
        if !name.is_empty() && is_identifier(name) {
            names.insert(name.to_string());
        }
        rest = &rest[end..];
    }
    names
}

pub(super) fn strip_query(url: &str) -> &str {
    url.split('?').next().unwrap_or(url)
}

/// Replace `:name` with `replacement` in `url`, respecting word boundaries.
pub(super) fn replace_path_param(url: &str, name: &str, replacement: &str) -> String {
    let pattern = format!(":{name}");
    let mut result = String::with_capacity(url.len());
    let mut rest = url;
    while let Some(pos) = rest.find(&pattern) {
        let after = &rest[pos + pattern.len()..];
        let boundary = after
            .chars()
            .next()
            .is_none_or(|c| !c.is_alphanumeric() && c != '_');
        if boundary {
            result.push_str(&rest[..pos]);
            result.push_str(replacement);
            rest = after;
        } else {
            result.push_str(&rest[..pos + 1]);
            rest = &rest[pos + 1..];
        }
    }
    result.push_str(rest);
    result
}

/// Percent-encode a string for use in a URL query value or path segment.
/// Unreserved chars (RFC 3986) are passed through; everything else is encoded.
pub(super) fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push(hex_digit(b >> 4));
                out.push(hex_digit(b & 0xf));
            }
        }
    }
    out
}

fn hex_digit(n: u8) -> char {
    b"0123456789ABCDEF"[n as usize] as char
}

/// Standard base64 encoding (RFC 4648), used for Basic auth.
pub(super) fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 0x3f) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_param_substitution() {
        assert_eq!(
            replace_path_param("/api/:name/info", "name", "ditto"),
            "/api/ditto/info"
        );
    }

    #[test]
    fn base64_basic() {
        // "man" → "bWFu"
        assert_eq!(base64_encode(b"man"), "bWFu");
        // "Ma" → "TWE="
        assert_eq!(base64_encode(b"Ma"), "TWE=");
    }

    #[test]
    fn url_encode_unreserved_chars_pass_through() {
        let input = "abcABC012-_.~";
        assert_eq!(url_encode(input), input);
    }

    #[test]
    fn url_encode_encodes_space_and_special() {
        assert_eq!(url_encode(" "), "%20");
        assert_eq!(url_encode("a&b=c"), "a%26b%3Dc");
        assert_eq!(url_encode("/"), "%2F");
    }
}
