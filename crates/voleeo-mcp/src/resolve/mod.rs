//! Backend mirror of `sendResolution.ts`, shared by the Tauri commands and MCP
//! tools. `vars` loads env/folder variables and resolves `{{ VAR }}` tokens;
//! `http` applies them to HTTP/WS requests (+ auth); `grpc` does the gRPC
//! equivalent; `text` holds the pure URL/encoding helpers. Only plain
//! `{{ VAR }}` tokens resolve — function tokens (`{{ uuid.v4() }}`) pass through.

mod grpc;
mod http;
mod text;
mod vars;

pub use grpc::{apply_to_grpc, grpc_vars, resolve_grpc_for_send};
pub(crate) use http::auth_header;
pub use http::{apply_to_connection, apply_to_request};
pub use vars::{
    apply_folder_vars, load_env_vars, load_env_vars_from, merge_inherited_metadata, resolve_str,
};
