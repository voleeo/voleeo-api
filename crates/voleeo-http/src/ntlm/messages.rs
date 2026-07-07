//! NTLM message construction and parsing: Type1 (Negotiate) encode, Type2
//! (Challenge) parse → Type3 (Authenticate) encode, and the `WWW-Authenticate`
//! challenge-token extraction. Transport-free — the handshake flow in the parent
//! module drives these over a connection.

use ntlmclient::{Credentials, Flags, Message};
use voleeo_core::VoleeoError;

/// Resolved NTLM credentials (templates already expanded upstream).
pub struct NtlmCreds {
    pub username: String,
    pub password: String,
    pub domain: String,
    pub workstation: String,
}

const WORKSTATION_FALLBACK: &str = "WORKSTATION";
pub const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

pub fn negotiate_message() -> Result<Vec<u8>, VoleeoError> {
    let flags = Flags::NEGOTIATE_UNICODE
        | Flags::REQUEST_TARGET
        | Flags::NEGOTIATE_NTLM
        | Flags::NEGOTIATE_ALWAYS_SIGN
        | Flags::NEGOTIATE_NTLM2_KEY; // extended session security (NTLMv2)
    Message::Negotiate(ntlmclient::NegotiateMessage {
        flags,
        supplied_domain: String::new(),
        supplied_workstation: String::new(),
        os_version: Default::default(),
    })
    .to_bytes()
    .map_err(|e| VoleeoError::Http(format!("NTLM negotiate encode failed: {e:?}")))
}

/// Parse the Type2 challenge → compute the Type3 authenticate bytes + the target
/// name (for the timeline).
pub fn authenticate_message(
    type2: &[u8],
    creds: &NtlmCreds,
) -> Result<(Vec<u8>, String), VoleeoError> {
    let msg = Message::try_from(type2)
        .map_err(|e| VoleeoError::Http(format!("NTLM challenge parse failed: {e:?}")))?;
    let Message::Challenge(challenge) = msg else {
        return Err(VoleeoError::Http(
            "expected an NTLM Challenge message".into(),
        ));
    };
    // The NTLMv2 proof hashes over the server's *exact* target-info bytes
    // (terminator AV-pair included), so reserialize them byte-for-byte.
    let target_info: Vec<u8> = challenge
        .target_information
        .iter()
        .flat_map(|e| e.to_bytes())
        .collect();
    let c = Credentials {
        username: creds.username.clone(),
        password: creds.password.clone(),
        domain: creds.domain.clone(),
    };
    let resp = ntlmclient::respond_challenge_ntlm_v2(
        challenge.challenge,
        &target_info,
        ntlmclient::get_ntlm_time(),
        &c,
    );
    let workstation = if creds.workstation.trim().is_empty() {
        WORKSTATION_FALLBACK
    } else {
        creds.workstation.trim()
    };
    let bytes = resp
        .to_message(&c, workstation, challenge.flags)
        .to_bytes()
        .map_err(|e| VoleeoError::Http(format!("NTLM authenticate encode failed: {e:?}")))?;
    Ok((bytes, challenge.target_name))
}

/// First `WWW-Authenticate: NTLM <base64>` token, if any.
pub fn ntlm_challenge(headers: &[(String, String)]) -> Option<String> {
    headers
        .iter()
        .filter(|(k, _)| k.eq_ignore_ascii_case("www-authenticate"))
        .find_map(|(_, v)| {
            v.strip_prefix("NTLM ")
                .or_else(|| v.strip_prefix("ntlm "))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    // A canned Type2 challenge (base64) from a go-httpbin-style server, with a
    // realm and a target-info block — exercises the parse → Type3 round-trip.
    const TYPE2_B64: &str = "TlRMTVNTUAACAAAADAAMADgAAAABAoACASNFZ4mrze8AAAAAAAAAACwALABEAAAABgGxHQAAAA9TAEUAUgBWAEUAUgABAAwAUwBFAFIAVgBFAFIAAgAIAEMATwBSAFAABwAIAAAAAAAAAAAAAAAAAA==";

    #[test]
    fn negotiate_message_is_well_formed() {
        let bytes = negotiate_message().unwrap();
        // "NTLMSSP\0" signature + message type 1.
        assert_eq!(&bytes[0..8], b"NTLMSSP\0");
        assert_eq!(bytes[8], 1);
    }

    #[test]
    fn computes_type3_from_challenge() {
        let type2 = B64.decode(TYPE2_B64).unwrap();
        let creds = NtlmCreds {
            username: "alice".into(),
            password: "s3cret".into(),
            domain: "CORP".into(),
            workstation: String::new(),
        };
        let (type3, target) = authenticate_message(&type2, &creds).unwrap();
        assert_eq!(&type3[0..8], b"NTLMSSP\0");
        assert_eq!(type3[8], 3, "message type 3 (Authenticate)");
        assert_eq!(target, "SERVER");
    }

    #[test]
    fn ntlm_challenge_extracts_token() {
        let headers = vec![
            ("Content-Type".into(), "text/html".into()),
            ("WWW-Authenticate".into(), "NTLM TlRMTVNT".into()),
        ];
        assert_eq!(ntlm_challenge(&headers).as_deref(), Some("TlRMTVNT"));
    }
}
