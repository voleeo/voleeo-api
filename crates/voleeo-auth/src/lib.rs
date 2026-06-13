//! Protocol  math for dynamic auth schemes — signing and challenge-response,
//! kept free of Tauri/reqwest so it stays unit-testable against published RFC
//! and AWS test vectors. The HTTP executor calls into here after assembling the
//! final request.

pub mod encode;
pub mod sigv4;

pub use sigv4::{sign as sign_sigv4, SigV4Request, SignedSigV4};
