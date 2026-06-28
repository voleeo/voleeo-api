//! Per-workspace AES-256-GCM encryption and key management for Voleeo.
pub mod cipher;
pub mod keys;
pub mod text;

pub use cipher::{decrypt, encrypt, is_encrypted};
pub use keys::{
    decode_key_display, delete_key, encode_key_display, generate_key, load_key, load_key_from_file,
    save_key,
};
pub use text::{decrypt_inline, decrypt_inline_text, has_encrypt_chip, strip_encrypt_chips};
