use std::collections::VecDeque;
use voleeo_core::{
    HttpResponse, HttpResponseHeader, HttpTiming, SseFrame, StoredCookie, TimelineEvent,
};

/// Most kept SSE frames / per-frame timeline rows per run — caps live memory and
/// history-YAML size so an endless stream can't grow unboundedly.
const FRAME_CAP: usize = 2000;

/// Accumulates an SSE stream (status / headers / timeline / frames) as it is
/// read, so a run cancelled mid-flight — the normal way to end an endless
/// `text/event-stream` — can still be rebuilt into a real response instead of an
/// empty status-0 shell. Per-frame rows and frames are capped; connection-setup
/// rows are kept whole. Tauri-free; `src-tauri`'s sink drives it.
#[derive(Default)]
pub struct SseAccum {
    status: u16,
    status_text: String,
    headers: Vec<HttpResponseHeader>,
    open_events: Vec<TimelineEvent>,
    frame_events: VecDeque<TimelineEvent>,
    frames: VecDeque<SseFrame>,
    /// Cumulative frame-data bytes received — kept even as old frames are capped,
    /// so the response "size" reflects the whole stream, not just what's retained.
    bytes: u32,
    /// Cookies captured/sent during the stream, carried so a cancelled/interrupted
    /// rebuild preserves them like a naturally-finished response does.
    captured_cookies: Vec<StoredCookie>,
    attached_cookies: Vec<StoredCookie>,
}

impl SseAccum {
    /// Frame/row cap — the no-sink SSE read in `executor.rs` stops here so an
    /// endless stream terminates.
    pub const FRAME_CAP: usize = FRAME_CAP;

    /// Record the response line + headers + connection-setup timeline (once,
    /// before the first frame).
    pub fn open(
        &mut self,
        status: u16,
        status_text: String,
        headers: Vec<HttpResponseHeader>,
        events: Vec<TimelineEvent>,
    ) {
        self.status = status;
        self.status_text = status_text;
        self.headers = headers;
        self.open_events = events;
    }

    /// Record one frame and its timeline row, dropping the oldest past the cap.
    pub fn frame(&mut self, frame: SseFrame, timeline: TimelineEvent) {
        self.bytes = self.bytes.saturating_add(frame.data.len() as u32);
        self.frame_events.push_back(timeline);
        if self.frame_events.len() > FRAME_CAP {
            self.frame_events.pop_front();
        }
        self.frames.push_back(frame);
        if self.frames.len() > FRAME_CAP {
            self.frames.pop_front();
        }
    }

    /// Store the cookies captured/sent for the stream, so a cancelled or
    /// interrupted rebuild keeps them (a natural finish reads them off the
    /// executor's `HttpResponse`).
    pub fn set_cookies(&mut self, captured: Vec<StoredCookie>, attached: Vec<StoredCookie>) {
        self.captured_cookies = captured;
        self.attached_cookies = attached;
    }

    /// Did we capture an SSE stream? (False for a plain response whose body was
    /// buffered and never touched the sink, or a cancel before any status.)
    pub fn is_sse(&self) -> bool {
        !self.open_events.is_empty() || !self.frames.is_empty()
    }

    /// Connection setup followed by the (capped) per-frame rows.
    fn timeline(&mut self) -> Vec<TimelineEvent> {
        let mut events = std::mem::take(&mut self.open_events);
        events.extend(std::mem::take(&mut self.frame_events));
        events
    }

    /// Natural end: swap the executor response's per-frame timeline (one row per
    /// frame, unbounded) for the bounded one — keeping its final `done` row — and
    /// attach the frames. A non-SSE response is returned untouched.
    pub fn finalize(mut self, mut response: HttpResponse) -> HttpResponse {
        if self.is_sse() {
            let done = response
                .events
                .iter()
                .rev()
                .find(|e| e.kind == "done")
                .cloned();
            let mut events = self.timeline();
            events.extend(done);
            response.events = events;
            response.body_size = self.bytes;
        }
        response.sse_frames = self.frames.into_iter().collect();
        response
    }

    /// Rebuild a stored response for a stream that ended early — cancelled by the
    /// user, or broken mid-flight (server closed / connection dropped). Keeps
    /// everything captured so far and appends a closing row noting how it ended.
    pub fn into_cancelled_response(self, request_id: &str) -> HttpResponse {
        self.rebuild(request_id, "info", "Stream cancelled".into())
    }

    /// Stream broke before its natural end — keep the partial frames/timeline and
    /// surface the error (an `error` row the frontend turns into a banner) rather
    /// than discarding everything.
    pub fn into_interrupted_response(self, request_id: &str, message: String) -> HttpResponse {
        self.rebuild(request_id, "error", message)
    }

    fn rebuild(
        mut self,
        request_id: &str,
        closing_kind: &str,
        closing_text: String,
    ) -> HttpResponse {
        let mut events = self.timeline();
        let total_ms = events.last().map(|e| e.at_ms).unwrap_or(0.0);
        events.push(TimelineEvent {
            at_ms: total_ms,
            kind: closing_kind.into(),
            text: closing_text,
        });
        HttpResponse {
            request_id: request_id.to_string(),
            status: self.status,
            status_text: std::mem::take(&mut self.status_text),
            headers: std::mem::take(&mut self.headers),
            body: String::new(),
            body_size: self.bytes,
            body_is_text: true,
            body_windowed: false,
            body_line_count: 0,
            response_id: String::new(),
            timing: HttpTiming {
                dns_ms: 0.0,
                connect_ms: 0.0,
                tls_ms: 0.0,
                first_byte_ms: 0.0,
                download_ms: total_ms,
                total_ms,
            },
            events,
            redirect_warning: None,
            captured_cookies: std::mem::take(&mut self.captured_cookies),
            attached_cookies: std::mem::take(&mut self.attached_cookies),
            sse_frames: self.frames.into_iter().collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(seq: u32) -> (SseFrame, TimelineEvent) {
        (
            SseFrame {
                seq,
                event: Some("message".into()),
                data: format!("{{\"n\":{seq}}}"),
                last_event_id: None,
                retry: None,
                at_ms: seq as f64,
            },
            TimelineEvent {
                at_ms: seq as f64,
                kind: "recv".into(),
                text: format!("event: message #{seq}"),
            },
        )
    }

    #[test]
    fn caps_frames_and_per_frame_events_keeping_setup() {
        let mut a = SseAccum::default();
        a.open(
            200,
            "OK".into(),
            vec![],
            vec![setup("config"), setup("send")],
        );
        for i in 0..(FRAME_CAP as u32 + 50) {
            let (f, t) = frame(i);
            a.frame(f, t);
        }
        let resp = a.into_cancelled_response("req");
        assert_eq!(resp.status, 200);
        assert_eq!(resp.sse_frames.len(), FRAME_CAP, "frames capped");
        // oldest frames dropped: the first kept frame is #50.
        assert_eq!(resp.sse_frames[0].seq, 50);
        // timeline = 2 setup rows + FRAME_CAP per-frame rows + "Stream cancelled".
        assert_eq!(resp.events.len(), 2 + FRAME_CAP + 1);
        assert_eq!(resp.events.last().unwrap().text, "Stream cancelled");
    }

    #[test]
    fn interrupted_keeps_frames_and_appends_error_row() {
        let mut a = SseAccum::default();
        a.open(200, "OK".into(), vec![], vec![setup("config")]);
        for i in 0..3 {
            let (f, t) = frame(i);
            a.frame(f, t);
        }
        let resp = a.into_interrupted_response("req", "Body stream failed".into());
        assert_eq!(resp.status, 200, "partial status kept");
        assert_eq!(resp.sse_frames.len(), 3, "captured frames kept");
        // 3 frames of `{"n":N}` (7 bytes each) → size survives the interruption.
        assert_eq!(resp.body_size, 21, "cumulative frame bytes kept");
        let last = resp.events.last().unwrap();
        assert_eq!(last.kind, "error");
        assert_eq!(last.text, "Body stream failed");
    }

    #[test]
    fn cancelled_response_preserves_captured_cookies() {
        let mut a = SseAccum::default();
        a.open(200, "OK".into(), vec![], vec![setup("config")]);
        let cookie = StoredCookie {
            id: "c".into(),
            domain: "example.com".into(),
            host_only: true,
            path: "/".into(),
            name: "session".into(),
            value: "abc".into(),
            value_encrypted: false,
            secure: false,
            http_only: false,
            same_site: None,
            expires: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        a.set_cookies(vec![cookie.clone()], vec![cookie.clone()]);
        let (f, t) = frame(0);
        a.frame(f, t);
        let resp = a.into_cancelled_response("req");
        assert_eq!(resp.captured_cookies.len(), 1, "Set-Cookie survives cancel");
        assert_eq!(resp.captured_cookies[0].name, "session");
        assert_eq!(
            resp.attached_cookies.len(),
            1,
            "sent cookie survives cancel"
        );
    }

    #[test]
    fn non_sse_response_passes_through_finalize() {
        let a = SseAccum::default();
        assert!(!a.is_sse());
        let mut r = bare_ok();
        r.events.push(setup("recv"));
        let before = r.events.len();
        let out = a.finalize(r);
        assert_eq!(
            out.events.len(),
            before,
            "plain response timeline untouched"
        );
        assert!(out.sse_frames.is_empty());
    }

    fn setup(kind: &str) -> TimelineEvent {
        TimelineEvent {
            at_ms: 0.0,
            kind: kind.into(),
            text: kind.into(),
        }
    }

    fn bare_ok() -> HttpResponse {
        HttpResponse {
            request_id: "r".into(),
            status: 200,
            status_text: "OK".into(),
            headers: vec![],
            body: "{}".into(),
            body_size: 2,
            body_is_text: true,
            body_windowed: false,
            body_line_count: 0,
            response_id: String::new(),
            timing: HttpTiming {
                dns_ms: 0.0,
                connect_ms: 0.0,
                tls_ms: 0.0,
                first_byte_ms: 0.0,
                download_ms: 0.0,
                total_ms: 0.0,
            },
            events: vec![],
            redirect_warning: None,
            captured_cookies: vec![],
            attached_cookies: vec![],
            sse_frames: vec![],
        }
    }
}
