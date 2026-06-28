//! Decrypt secrets embedded in arbitrary text: `{{ encrypt(value="…") }}` chips
//! and bare `enc:v1:<hex>` blobs → plaintext. Used by export to flatten inline
//! secrets that live in any field (URL, params, headers, body), mirroring
//! send-time resolution minus env-var substitution.

const ENC_PREFIX: &str = "enc:v1:";
const CHIP_PREFIX: &str = r#"{{ encrypt(value=""#;
const CHIP_SUFFIX: &str = r#"") }}"#;

/// Replace every `{{ encrypt(value="<cipher>") }}` chip and bare `enc:v1:<hex>`
/// blob with its decrypted plaintext. A decrypt failure leaves the ciphertext in
/// place — visible breakage beats a silent empty.
pub fn decrypt_inline_text(text: &str, key: &[u8; 32]) -> String {
    decrypt_inline(&strip_encrypt_chips(text), Some(key))
}

/// `true` if `text` contains an inline `encrypt()` secret chip.
pub fn has_encrypt_chip(text: &str) -> bool {
    text.contains("encrypt(value=")
}

/// Unwrap each `{{ encrypt(value="…") }}` chip to its inner `value` arg (usually
/// `enc:v1:<hex>`, decrypted next). Literal-string match — the chip format is
/// hand-written by the template serializer.
pub fn strip_encrypt_chips(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find(CHIP_PREFIX) {
        result.push_str(&rest[..idx]);
        let after = &rest[idx + CHIP_PREFIX.len()..];
        if let Some(end) = after.find(CHIP_SUFFIX) {
            result.push_str(&after[..end]);
            rest = &after[end + CHIP_SUFFIX.len()..];
        } else {
            result.push_str(&rest[idx..]);
            return result;
        }
    }
    result.push_str(rest);
    result
}

/// Replace each `enc:v1:<hex>` substring with its plaintext. `key = None` (an
/// unencrypted workspace) leaves the ciphertext in place.
pub fn decrypt_inline(text: &str, key: Option<&[u8; 32]>) -> String {
    let Some(key) = key else {
        return text.to_string();
    };
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find(ENC_PREFIX) {
        result.push_str(&rest[..idx]);
        let after_prefix = &rest[idx + ENC_PREFIX.len()..];
        let hex_len = after_prefix
            .as_bytes()
            .iter()
            .take_while(|b| b.is_ascii_hexdigit())
            .count();
        let total = ENC_PREFIX.len() + hex_len;
        let cipher = &rest[idx..idx + total];
        match crate::decrypt(cipher, key) {
            Ok(plain) => result.push_str(&plain),
            Err(_) => result.push_str(cipher),
        }
        rest = &rest[idx + total..];
    }
    result.push_str(rest);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{encrypt, generate_key};

    #[test]
    fn unwraps_chip_and_decrypts() {
        let key = generate_key();
        let cipher = encrypt("s3cret", &key).unwrap();
        let text =
            format!(r#"https://api/x?t={{{{ encrypt(value="{cipher}") }}}}&keep={{{{ VAR }}}}"#);
        let out = decrypt_inline_text(&text, &key);
        assert_eq!(out, "https://api/x?t=s3cret&keep={{ VAR }}");
        assert!(has_encrypt_chip(&text));
        assert!(!has_encrypt_chip(&out));
    }

    #[test]
    fn plaintext_passes_through() {
        let key = generate_key();
        assert_eq!(
            decrypt_inline_text("just text {{ VAR }}", &key),
            "just text {{ VAR }}"
        );
    }
}
