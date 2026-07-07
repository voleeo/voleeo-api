//! Incremental Server-Sent Events decoder. Raw response chunks go in, complete
//! frames come out. Partial lines are buffered across chunk boundaries, so a
//! frame split mid-`data:` by the network still parses correctly.
//!
//! Follows the WHATWG event-stream parse, minus two deliberate omissions:
//! lone-`\r` line terminators (no real SSE server emits them) and the spec's
//! persistent `lastEventId` (we surface the `id:` seen in each frame's block,
//! which is what a debugger wants to read).

/// A frame as parsed off the wire, before arrival metadata (seq/time) is added.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct RawFrame {
    pub event: Option<String>,
    pub data: String,
    pub id: Option<String>,
    pub retry: Option<u32>,
}

#[derive(Default)]
pub(crate) struct SseDecoder {
    buf: Vec<u8>, // bytes past the last newline — an unterminated line
    event: Option<String>,
    data: Vec<String>,
    id: Option<String>,
    retry: Option<u32>,
    dirty: bool,       // a field line landed since the last dispatch
    bom_checked: bool, // leading UTF-8 BOM stripped (checked once at stream start)
}

impl SseDecoder {
    /// Feed a chunk; return every frame whose terminating blank line arrived.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<RawFrame> {
        self.buf.extend_from_slice(chunk);
        // Per the event-stream spec, strip a single leading BOM once at the very
        // start; otherwise it corrupts the first field name and drops frame one.
        if !self.bom_checked && self.buf.len() >= 3 {
            self.bom_checked = true;
            if self.buf.starts_with(&[0xEF, 0xBB, 0xBF]) {
                self.buf.drain(..3);
            }
        }
        let mut frames = Vec::new();
        // Split on LF; a trailing CR is stripped so CRLF and LF both work. The
        // remainder after the last LF stays buffered for the next chunk.
        while let Some(nl) = self.buf.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.buf.drain(..=nl).collect();
            line.pop(); // drop '\n'
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if let Some(frame) = self.feed_line(&line) {
                frames.push(frame);
            }
        }
        frames
    }

    /// Flush a trailing frame the stream left unterminated (connection closed
    /// after the fields but before the blank line).
    pub fn finish(&mut self) -> Vec<RawFrame> {
        let mut frames = Vec::new();
        if !self.buf.is_empty() {
            let line = std::mem::take(&mut self.buf);
            if let Some(frame) = self.feed_line(&line) {
                frames.push(frame);
            }
        }
        if self.dirty {
            frames.push(self.take_frame());
        }
        frames
    }

    fn feed_line(&mut self, line: &[u8]) -> Option<RawFrame> {
        if line.is_empty() {
            return self.dirty.then(|| self.take_frame());
        }
        if line[0] == b':' {
            return None; // comment / heartbeat
        }
        let text = String::from_utf8_lossy(line);
        let (field, value) = match text.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (text.as_ref(), ""), // a bare field name, empty value
        };
        match field {
            "event" => self.event = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            "id" => self.id = Some(value.to_string()),
            "retry" => self.retry = value.parse().ok(),
            _ => return None, // unknown field: ignored, not dirtying
        }
        self.dirty = true;
        None
    }

    fn take_frame(&mut self) -> RawFrame {
        let frame = RawFrame {
            event: self.event.take(),
            data: self.data.join("\n"),
            id: self.id.take(),
            retry: self.retry.take(),
        };
        self.data.clear();
        self.dirty = false;
        frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(chunk: &str) -> Vec<RawFrame> {
        let mut d = SseDecoder::default();
        let mut out = d.push(chunk.as_bytes());
        out.extend(d.finish());
        out
    }

    #[test]
    fn parses_single_json_frame() {
        let f = one("data: {\"a\":1}\n\n");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].data, "{\"a\":1}");
    }

    #[test]
    fn joins_multiple_data_lines_with_newline() {
        let f = one("data: one\ndata: two\ndata: three\n\n");
        assert_eq!(f[0].data, "one\ntwo\nthree");
    }

    #[test]
    fn captures_event_id_and_retry() {
        let f = one("event: tick\nid: 7\nretry: 500\ndata: x\n\n");
        assert_eq!(f[0].event.as_deref(), Some("tick"));
        assert_eq!(f[0].id.as_deref(), Some("7"));
        assert_eq!(f[0].retry, Some(500));
    }

    #[test]
    fn ignores_comments_and_heartbeats() {
        let f = one(": keep-alive\ndata: real\n\n");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].data, "real");
    }

    #[test]
    fn handles_crlf_terminators() {
        let f = one("data: hi\r\n\r\n");
        assert_eq!(f[0].data, "hi");
    }

    #[test]
    fn reassembles_a_frame_split_across_chunks() {
        let mut d = SseDecoder::default();
        assert!(d.push(b"data: {\"par").is_empty());
        assert!(d.push(b"tial\":true}").is_empty());
        let f = d.push(b"}\n\n"); // closes the JSON + the frame
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].data, "{\"partial\":true}}");
    }

    #[test]
    fn dispatches_two_back_to_back_frames() {
        let f = one("data: a\n\ndata: b\n\n");
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].data, "a");
        assert_eq!(f[1].data, "b");
    }

    #[test]
    fn strips_leading_bom_before_first_field() {
        let mut d = SseDecoder::default();
        let mut input = vec![0xEF, 0xBB, 0xBF];
        input.extend_from_slice(b"data: first\n\n");
        let mut out = d.push(&input);
        out.extend(d.finish());
        assert_eq!(out.len(), 1, "BOM must not swallow the first frame");
        assert_eq!(out[0].data, "first");
    }

    #[test]
    fn flushes_unterminated_trailing_frame_on_finish() {
        let f = one("data: no blank line after me\n");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].data, "no blank line after me");
    }
}
