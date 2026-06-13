//! RFC 3986 percent-encoding helpers shared by signing schemes. AWS SigV4 and
//! OAuth 1.0 both demand the strict "unreserved set only" encoding (uppercase
//! hex, `~` left literal), which differs from `application/x-www-form-urlencoded`.

/// True for the RFC 3986 unreserved set: `A-Z a-z 0-9 - _ . ~`.
fn is_unreserved(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~')
}

/// Percent-encode every byte outside the unreserved set, uppercase hex. Slashes
/// are encoded too — callers that need to preserve path separators split on `/`
/// first and encode each segment.
pub fn uri_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if is_unreserved(b) {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(hex_upper(b >> 4));
            out.push(hex_upper(b & 0x0f));
        }
    }
    out
}

/// Decode `%XX` sequences and `+` (treated as a literal `+`, not space — query
/// canonicalization decodes percent escapes only). Invalid escapes pass through.
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_upper(nibble: u8) -> char {
    match nibble {
        0..=9 => (b'0' + nibble) as char,
        _ => (b'A' + (nibble - 10)) as char,
    }
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Lowercase hex of a byte slice — SigV4 signatures and SHA-256 digests.
pub fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(hex_low(b >> 4));
        out.push(hex_low(b & 0x0f));
    }
    out
}

fn hex_low(nibble: u8) -> char {
    match nibble {
        0..=9 => (b'0' + nibble) as char,
        _ => (b'a' + (nibble - 10)) as char,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreserved_passes_through() {
        assert_eq!(uri_encode("abcABC012-_.~"), "abcABC012-_.~");
    }

    #[test]
    fn encodes_space_slash_and_special() {
        assert_eq!(uri_encode(" "), "%20");
        assert_eq!(uri_encode("/"), "%2F");
        assert_eq!(uri_encode("a&b=c"), "a%26b%3Dc");
    }

    #[test]
    fn percent_decode_roundtrip() {
        assert_eq!(percent_decode("hello%20world"), "hello world");
        assert_eq!(percent_decode("a%26b"), "a&b");
        assert_eq!(percent_decode("plain"), "plain");
    }

    #[test]
    fn hex_lower_known() {
        assert_eq!(hex_lower(&[0x00, 0xff, 0x1a]), "00ff1a");
    }
}
