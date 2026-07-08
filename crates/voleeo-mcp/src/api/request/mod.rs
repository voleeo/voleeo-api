//! HTTP request MCP tools. CRUD handlers live in `crud`; the send path
//! (`request.send` + cookie ingest + arg parsing) lives in `send`. Both add
//! handlers to the shared `impl ApiBackend` block.

mod crud;
mod send;
