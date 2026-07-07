use super::super::{redact, ApiBackend};
use super::send::{parse_body, parse_params};
use crate::protocol::ToolResult;
use serde_json::Value;
use voleeo_core::{AuthConfig, VoleeoError};

impl ApiBackend {
    pub(in crate::api) async fn request_list(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let reveal = redact::reveal(args);
        let requests = self.requests.clone();
        super::super::run_blocking(move || {
            let reqs = requests.list_requests(&ws_id);
            let folders = requests.list_folders(&ws_id);
            match (reqs, folders) {
                (Ok(mut reqs), Ok(folders)) => {
                    if !reveal {
                        for r in reqs.iter_mut() {
                            redact::mask_auth(&mut r.auth);
                        }
                    }
                    ToolResult::json(&serde_json::json!({ "requests": reqs, "folders": folders }))
                }
                (Err(e), _) | (_, Err(e)) => ToolResult::error(e.to_string()),
            }
        })
        .await
    }

    pub(in crate::api) async fn request_get(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let reveal = redact::reveal(args);
        let requests = self.requests.clone();
        super::super::run_blocking(move || match requests.get_request(&ws_id, &req_id) {
            Ok(mut req) => {
                if !reveal {
                    redact::mask_auth(&mut req.auth);
                }
                ToolResult::json(&req)
            }
            Err(e) => ToolResult::error(e.to_string()),
        })
        .await
    }

    pub(in crate::api) async fn request_create(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let name = require!(args, "name");
        let method = require!(args, "method");
        let url = require!(args, "url");
        let folder_id = args["folderId"].as_str().map(str::to_string);
        let headers = parse_params(&args["headers"]);
        let query_params = parse_params(&args["queryParams"]);
        let body = match parse_body(&args["body"]) {
            Ok(b) => b,
            Err(e) => return ToolResult::error(e),
        };
        let requests = self.requests.clone();
        let ws = ws_id.clone();
        let result =
            super::super::blocking(move || -> Result<voleeo_core::HttpRequest, VoleeoError> {
                let mut req = requests.create_request(ws.clone(), folder_id, name, method, url)?;
                // create_request only sets name/method/url; persist any extras in a
                // follow-up update so an AI can author a full request in one call.
                if !headers.is_empty() || !query_params.is_empty() || body.is_some() {
                    if !headers.is_empty() {
                        req.headers = headers;
                    }
                    if !query_params.is_empty() {
                        req.parameters = query_params;
                    }
                    if body.is_some() {
                        req.body = body;
                    }
                    requests.update_request(
                        &ws,
                        &req.id,
                        req.method.clone(),
                        req.url.clone(),
                        req.parameters.clone(),
                        req.headers.clone(),
                        req.body.clone(),
                        req.auth.clone(),
                    )?;
                }
                Ok(req)
            })
            .await;
        match result {
            Ok(req) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&req)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(in crate::api) async fn request_update(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");

        // Parse auth up front (cheap, sync) so a bad-JSON error is immediate and
        // serde never runs on the blocking pool. `None` = leave auth untouched.
        let new_auth: Option<AuthConfig> = if args["auth"].is_null() {
            None
        } else {
            match serde_json::from_value(args["auth"].clone()) {
                Ok(a) => Some(a),
                Err(e) => return ToolResult::error(format!("invalid auth: {e}")),
            }
        };

        let name = args["name"].as_str().map(str::to_string);
        let method = args["method"].as_str().map(str::to_string);
        let url = args["url"].as_str().map(str::to_string);
        let graphql_query = args["graphqlQuery"].as_str().map(str::to_string);
        let graphql_vars = args["graphqlVariables"].as_str().map(str::to_string);
        // None = arg absent (preserve existing); Some(..) replaces wholesale.
        let headers = (!args["headers"].is_null()).then(|| parse_params(&args["headers"]));
        let query_params =
            (!args["queryParams"].is_null()).then(|| parse_params(&args["queryParams"]));
        let body = match parse_body(&args["body"]) {
            Ok(b) => b,
            Err(e) => return ToolResult::error(e),
        };

        let requests = self.requests.clone();
        let workspaces = self.workspaces.clone();
        let app_data_dir = self.app_data_dir.clone();
        let ws = ws_id.clone();
        let result =
            super::super::blocking(move || -> Result<voleeo_core::HttpRequest, VoleeoError> {
                let mut req = requests.get_request(&ws, &req_id)?;
                // Rename is separate: the filename stays `req_{id}.yaml`.
                if let Some(n) = name {
                    requests.rename_request(&ws, &req_id, n.clone())?;
                    req.name = n;
                }
                if let Some(m) = method {
                    req.method = m;
                }
                if let Some(u) = url {
                    req.url = u;
                }
                if let Some(q) = graphql_query {
                    req.body = Some(voleeo_core::RequestBody {
                        kind: voleeo_core::BodyKind::Graphql,
                        text: q,
                        graphql_variables: graphql_vars,
                        ..Default::default()
                    });
                    if req.method.eq_ignore_ascii_case("GET") {
                        req.method = "POST".to_string();
                    }
                } else if let (Some(v), Some(body)) = (graphql_vars, req.body.as_mut()) {
                    if matches!(body.kind, voleeo_core::BodyKind::Graphql) {
                        body.graphql_variables = Some(v);
                    }
                }
                if let Some(h) = headers {
                    req.headers = h;
                }
                if let Some(p) = query_params {
                    req.parameters = p;
                }
                if let Some(b) = body {
                    req.body = Some(b);
                }
                if let Some(mut auth) = new_auth {
                    // A masked read (request.get without reveal) echoed back here must
                    // not overwrite the stored secret with the placeholder.
                    redact::restore_masked(&mut auth, &mut req.auth);

                    let ws_encrypted = workspaces.get(&ws).map(|w| w.encrypted).unwrap_or(false);
                    if ws_encrypted {
                        auth.mark_secrets_encrypted();
                        if auth.secret_fields_mut().iter().any(|(_, enc)| *enc) {
                            let key = voleeo_crypto::load_key(&ws, &app_data_dir)?;
                            for (secret, enc) in auth.secret_fields_mut() {
                                if enc && !voleeo_crypto::is_encrypted(secret) {
                                    *secret = voleeo_crypto::encrypt(secret, &key)?;
                                }
                            }
                        }
                    }
                    req.auth = auth;
                }
                requests.update_request(
                    &ws,
                    &req_id,
                    req.method.clone(),
                    req.url.clone(),
                    req.parameters.clone(),
                    req.headers.clone(),
                    req.body.clone(),
                    req.auth.clone(),
                )?;
                Ok(req)
            })
            .await;

        match result {
            Ok(req) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&req)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(in crate::api) async fn request_duplicate(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let requests = self.requests.clone();
        let ws = ws_id.clone();
        match super::super::blocking(move || requests.duplicate_request(&ws, &req_id)).await {
            Ok(req) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&req)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(in crate::api) async fn request_delete(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let req_id = require!(args, "requestId");
        let requests = self.requests.clone();
        let ws = ws_id.clone();
        let rid = req_id.clone();
        match super::super::blocking(move || requests.delete_request(&ws, &rid)).await {
            Ok(()) => {
                self.notify_requests(&ws_id);
                ToolResult::json(&serde_json::json!({ "deleted": req_id }))
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}
