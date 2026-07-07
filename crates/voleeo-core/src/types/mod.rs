//! Domain data types shared across the app, grouped by concern: `common`
//! (workspace/env/params + id helpers), `http`, `ws`, and `grpc`.

mod common;
mod grpc;
mod http;
mod ws;

pub use common::*;
pub use grpc::*;
pub use http::*;
pub use ws::*;
