//! Response-body reading for `send_inner`: the SSE (live-sink + no-sink) and
//! buffered branches plus their shared frame/error helpers. Split out of
//! `executor.rs` to keep it within the size limit; behavior is unchanged.

use crate::fmt::{fmt_bytes, push_event};
use crate::sse::{RawFrame, SseDecoder};
use crate::{SseAccum, SseEvent, SseSink};
use base64::Engine;
use futures_util::{Stream, StreamExt};
use std::time::Instant;
use voleeo_core::{
    HttpFailure, HttpResponseHeader, SseFrame, StoredCookie, TimelineEvent, VoleeoError,
};

/// Tag a parsed SSE frame with arrival metadata and hand it (plus its timeline
/// row) to the live sink. Bumps `seq` so each frame keys uniquely in the UI.
/// The row is NOT retained in the executor's `events` Vec — `SseAccum` keeps the
/// bounded copy the final response uses, so a fast/endless stream can't grow that
/// Vec one entry per frame.
fn push_sse_frame(sink: &SseSink, seq: &mut u32, started: Instant, raw: RawFrame) {
    let at_ms = started.elapsed().as_secs_f64() * 1000.0;
    let label = raw.event.as_deref().unwrap_or("message");
    let timeline = TimelineEvent {
        at_ms,
        kind: "recv".into(),
        text: format!("event: {label} · {} B", raw.data.len()),
    };
    let frame = SseFrame {
        seq: *seq,
        event: raw.event,
        data: raw.data,
        last_event_id: raw.id,
        retry: raw.retry,
        at_ms,
    };
    sink(SseEvent::Frame { frame, timeline });
    *seq += 1;
}

/// Log a body-stream read failure on the timeline and turn it into the error
/// (taking ownership of `events`); shared by the SSE and buffered read loops.
fn body_stream_err(
    events: &mut Vec<TimelineEvent>,
    started: Instant,
    e: reqwest::Error,
) -> VoleeoError {
    let msg = format!("Body stream failed: {e}");
    push_event(events, started, "error", msg.clone());
    VoleeoError::HttpFailed(HttpFailure {
        message: msg,
        events: std::mem::take(events),
    })
}

/// Drain the response body into `(body, size, is_text, sse_frames)`. SSE streams
/// (no natural EOF) parse frames as they arrive: a live `sink` taps them for the
/// streaming UI, otherwise they accumulate locally (capped) so the response still
/// carries them. Buffered bodies read to completion, base64-ing non-UTF-8.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn read_response_body<S, B>(
    mut stream: S,
    is_sse: bool,
    sse_sink: Option<SseSink>,
    status_code: u16,
    status_text: &str,
    headers: &[HttpResponseHeader],
    captured_cookies: &[StoredCookie],
    attached_cookies: &[StoredCookie],
    events: &mut Vec<TimelineEvent>,
    started: Instant,
) -> Result<(String, u32, bool, Option<Vec<SseFrame>>), VoleeoError>
where
    S: Stream<Item = reqwest::Result<B>> + Unpin,
    B: AsRef<[u8]>,
{
    if is_sse {
        if let Some(sink) = sse_sink {
            // Hand the command the status/headers/timeline up front so a stream
            // cancelled mid-flight can still be rebuilt into a real response.
            sink(SseEvent::Open {
                status: status_code,
                status_text: status_text.to_string(),
                headers: headers.to_vec(),
                events: events.clone(),
                captured_cookies: captured_cookies.to_vec(),
                attached_cookies: attached_cookies.to_vec(),
            });
            let mut decoder = SseDecoder::default();
            let mut seq: u32 = 0;
            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => return Err(body_stream_err(events, started, e)),
                };
                for raw in decoder.push(chunk.as_ref()) {
                    push_sse_frame(&sink, &mut seq, started, raw);
                }
            }
            for raw in decoder.finish() {
                push_sse_frame(&sink, &mut seq, started, raw);
            }
            Ok((String::new(), 0u32, true, None))
        } else {
            // No live sink (plain `send`, MCP): accumulate frames locally,
            // capped, so the response carries them and the read terminates
            // instead of looping on a stream that never EOFs. Cancellation and
            // timeout still abort via the outer `select!` in `send_scoped`.
            let mut decoder = SseDecoder::default();
            let mut frames: Vec<SseFrame> = Vec::new();
            let mut bytes: u32 = 0;
            let mut push = |frames: &mut Vec<SseFrame>, raw: RawFrame| {
                bytes = bytes.saturating_add(raw.data.len() as u32);
                frames.push(SseFrame {
                    seq: frames.len() as u32,
                    event: raw.event,
                    data: raw.data,
                    last_event_id: raw.id,
                    retry: raw.retry,
                    at_ms: started.elapsed().as_secs_f64() * 1000.0,
                });
            };
            let mut capped = false;
            'read: while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    // Mid-stream failure on a no-sink SSE read: keep the frames
                    // parsed so far and surface the error inline instead of
                    // discarding a partial stream (mirrors the live-sink path's
                    // interrupted-response rebuild). Non-SSE reads still hard-fail.
                    Err(e) => {
                        push_event(events, started, "error", format!("Body stream failed: {e}"));
                        break 'read;
                    }
                };
                for raw in decoder.push(chunk.as_ref()) {
                    push(&mut frames, raw);
                    if frames.len() >= SseAccum::FRAME_CAP {
                        capped = true;
                        break 'read;
                    }
                }
            }
            if !capped {
                for raw in decoder.finish() {
                    push(&mut frames, raw);
                }
            } else {
                push_event(
                    events,
                    started,
                    "info",
                    format!(
                        "SSE frame cap reached ({}); stopped reading",
                        SseAccum::FRAME_CAP
                    ),
                );
            }
            Ok((String::new(), bytes, true, Some(frames)))
        }
    } else {
        let mut body_bytes: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => return Err(body_stream_err(events, started, e)),
            };
            push_event(
                events,
                started,
                "chunk",
                format!("{} chunk received", fmt_bytes(chunk.as_ref().len())),
            );
            body_bytes.extend_from_slice(chunk.as_ref());
        }
        let body_size = u32::try_from(body_bytes.len()).unwrap_or(u32::MAX);
        let (body, body_is_text) = if body_bytes.is_empty() {
            (String::new(), true)
        } else {
            match String::from_utf8(body_bytes.clone()) {
                Ok(s) => (s, true),
                Err(_) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&body_bytes);
                    (b64, false)
                }
            }
        };
        Ok((body, body_size, body_is_text, None))
    }
}
