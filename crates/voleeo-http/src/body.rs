use crate::fmt::{fmt_bytes, push_event};
use reqwest::RequestBuilder;
use std::path::Path;
use std::time::Instant;
use voleeo_core::{BodyKind, RequestBody, RequestParameter, TimelineEvent, VoleeoError};

/// Content-Type for a raw body kind. `None` for non-raw kinds (reqwest owns the
/// header for form/multipart; binary derives it from the field).
fn raw_content_type(kind: &BodyKind) -> Option<&'static str> {
    match kind {
        BodyKind::Json => Some("application/json"),
        BodyKind::Xml => Some("application/xml"),
        BodyKind::Html => Some("text/html"),
        BodyKind::Text => Some("text/plain"),
        _ => None,
    }
}

/// The exact bytes a non-streaming body puts on the wire — the single home for
/// the `BodyKind` → bytes mapping shared by SigV4 payload hashing and the NTLM
/// authenticate leg. `None` for multipart/binary (boundaries / file streams
/// aren't cheaply reproducible). Form encoding byte-matches reqwest's `.form()`.
pub(crate) fn reproducible_body_bytes(body: &RequestBody) -> Option<Vec<u8>> {
    match body.kind {
        BodyKind::None => Some(Vec::new()),
        BodyKind::Json | BodyKind::Xml | BodyKind::Text | BodyKind::Html => {
            Some(body.text.clone().into_bytes())
        }
        BodyKind::Graphql => Some(body.graphql_payload().into_bytes()),
        BodyKind::FormUrlEncoded => {
            let pairs: Vec<(&str, &str)> = body
                .fields
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .filter(|f| f.enabled && !f.name.trim().is_empty())
                .map(|f| (f.name.as_str(), f.value.as_str()))
                .collect();
            Some(
                serde_urlencoded::to_string(&pairs)
                    .unwrap_or_default()
                    .into_bytes(),
            )
        }
        BodyKind::Multipart | BodyKind::Binary => None,
    }
}

/// True when the body would put bytes on the wire — used by the redirect
/// warning logic to decide whether a 301/302/303 downgrade dropped a payload.
pub(crate) fn has_content(body: &RequestBody) -> bool {
    match body.kind {
        BodyKind::None => false,
        BodyKind::Json | BodyKind::Xml | BodyKind::Text | BodyKind::Html | BodyKind::Graphql => {
            !body.text.is_empty()
        }
        BodyKind::FormUrlEncoded | BodyKind::Multipart => body
            .fields
            .as_ref()
            .is_some_and(|f| f.iter().any(|x| x.enabled && !x.name.trim().is_empty())),
        BodyKind::Binary => body
            .file_path
            .as_ref()
            .is_some_and(|p| !p.trim().is_empty()),
    }
}

fn read_file(path: &str) -> Result<Vec<u8>, VoleeoError> {
    std::fs::read(path).map_err(|e| VoleeoError::Http(format!("Cannot read file \"{path}\": {e}")))
}

fn filename_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string()
}

/// Attach the request body to `builder`, branching on body kind. File reads for
/// multipart/binary run on a blocking thread so the runtime isn't stalled.
pub(crate) async fn attach_body(
    mut builder: RequestBuilder,
    body: &RequestBody,
    headers: &[RequestParameter],
    events: &mut Vec<TimelineEvent>,
    started: Instant,
) -> Result<RequestBuilder, VoleeoError> {
    let user_set_ct = headers
        .iter()
        .any(|h| h.enabled && h.name.trim().eq_ignore_ascii_case("content-type"));
    let empty: Vec<voleeo_core::BodyField> = Vec::new();
    let fields = body.fields.as_ref().unwrap_or(&empty);

    match body.kind {
        BodyKind::None => Ok(builder),

        BodyKind::Json | BodyKind::Xml | BodyKind::Text | BodyKind::Html => {
            if body.text.is_empty() {
                return Ok(builder);
            }
            let ct = raw_content_type(&body.kind).unwrap_or("application/octet-stream");
            if !user_set_ct {
                builder = builder.header("content-type", ct);
            }
            push_event(
                events,
                started,
                "send",
                format!("Sending body: {} ({ct})", fmt_bytes(body.text.len())),
            );
            Ok(builder.body(body.text.clone()))
        }

        BodyKind::Graphql => {
            if body.text.is_empty() {
                return Ok(builder);
            }
            let payload = body.graphql_payload();
            if !user_set_ct {
                builder = builder.header("content-type", "application/json");
            }
            push_event(
                events,
                started,
                "send",
                format!("Sending GraphQL body: {}", fmt_bytes(payload.len())),
            );
            Ok(builder.body(payload))
        }

        BodyKind::FormUrlEncoded => {
            let pairs: Vec<(&str, &str)> = fields
                .iter()
                .filter(|f| f.enabled && !f.name.trim().is_empty())
                .map(|f| (f.name.as_str(), f.value.as_str()))
                .collect();
            push_event(
                events,
                started,
                "send",
                format!(
                    "Sending form body: {} field{} (application/x-www-form-urlencoded)",
                    pairs.len(),
                    if pairs.len() == 1 { "" } else { "s" }
                ),
            );
            // reqwest sets Content-Type: application/x-www-form-urlencoded.
            Ok(builder.form(&pairs))
        }

        BodyKind::Multipart => {
            let mut form = reqwest::multipart::Form::new();
            let mut file_count = 0usize;
            let mut text_count = 0usize;
            for f in fields
                .iter()
                .filter(|f| f.enabled && !f.name.trim().is_empty())
            {
                if f.is_file {
                    let path = f.value.clone();
                    let data = tokio::task::spawn_blocking(move || read_file(&path))
                        .await
                        .map_err(|e| VoleeoError::Http(e.to_string()))??;
                    let mut part =
                        reqwest::multipart::Part::bytes(data).file_name(filename_of(&f.value));
                    if let Some(ct) = &f.content_type {
                        part = part.mime_str(ct).map_err(|_| {
                            VoleeoError::Http(format!(
                                "Invalid content type for \"{}\": {ct}",
                                f.name
                            ))
                        })?;
                    }
                    form = form.part(f.name.clone(), part);
                    file_count += 1;
                } else {
                    form = form.text(f.name.clone(), f.value.clone());
                    text_count += 1;
                }
            }
            push_event(
                events,
                started,
                "send",
                format!("Sending multipart/form-data: {text_count} field(s), {file_count} file(s)"),
            );
            // Must NOT set Content-Type — reqwest appends the boundary itself.
            Ok(builder.multipart(form))
        }

        BodyKind::Binary => {
            let path = body
                .file_path
                .clone()
                .filter(|p| !p.trim().is_empty())
                .ok_or_else(|| VoleeoError::Http("Binary body has no file selected".into()))?;
            let read_path = path.clone();
            let data = tokio::task::spawn_blocking(move || read_file(&read_path))
                .await
                .map_err(|e| VoleeoError::Http(e.to_string()))??;
            let ct = body
                .content_type
                .clone()
                .filter(|c| !c.trim().is_empty())
                .unwrap_or_else(|| "application/octet-stream".into());
            if !user_set_ct {
                builder = builder.header("content-type", ct.clone());
            }
            push_event(
                events,
                started,
                "send",
                format!(
                    "Sending binary body: {} ({ct}) from {}",
                    fmt_bytes(data.len()),
                    filename_of(&path)
                ),
            );
            Ok(builder.body(data))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voleeo_core::BodyField;

    fn field(name: &str, value: &str, enabled: bool, is_file: bool) -> BodyField {
        BodyField {
            id: "x".into(),
            name: name.into(),
            value: value.into(),
            enabled,
            is_file,
            content_type: None,
        }
    }

    #[test]
    fn raw_content_types() {
        assert_eq!(raw_content_type(&BodyKind::Json), Some("application/json"));
        assert_eq!(raw_content_type(&BodyKind::Html), Some("text/html"));
        assert_eq!(raw_content_type(&BodyKind::Text), Some("text/plain"));
        assert_eq!(raw_content_type(&BodyKind::Binary), None);
    }

    #[test]
    fn filename_extraction() {
        assert_eq!(filename_of("/tmp/data/report.pdf"), "report.pdf");
        assert_eq!(filename_of("plain.txt"), "plain.txt");
    }

    #[test]
    fn has_content_per_kind() {
        let none = RequestBody::default();
        assert!(!has_content(&none));

        let empty_raw = RequestBody {
            kind: BodyKind::Json,
            ..Default::default()
        };
        assert!(!has_content(&empty_raw));

        let raw = RequestBody {
            kind: BodyKind::Json,
            text: "{}".into(),
            ..Default::default()
        };
        assert!(has_content(&raw));

        let form = RequestBody {
            kind: BodyKind::FormUrlEncoded,
            fields: Some(vec![field("a", "1", true, false)]),
            ..Default::default()
        };
        assert!(has_content(&form));

        let form_disabled = RequestBody {
            kind: BodyKind::FormUrlEncoded,
            fields: Some(vec![field("a", "1", false, false)]),
            ..Default::default()
        };
        assert!(!has_content(&form_disabled));

        let binary = RequestBody {
            kind: BodyKind::Binary,
            file_path: Some("/tmp/x.bin".into()),
            ..Default::default()
        };
        assert!(has_content(&binary));

        let binary_empty = RequestBody {
            kind: BodyKind::Binary,
            file_path: Some("  ".into()),
            ..Default::default()
        };
        assert!(!has_content(&binary_empty));

        let gql = RequestBody {
            kind: BodyKind::Graphql,
            text: "query { me }".into(),
            ..Default::default()
        };
        assert!(has_content(&gql));
    }
}
