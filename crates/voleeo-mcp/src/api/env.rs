use super::{redact, ApiBackend};
use crate::protocol::ToolResult;
use serde_json::Value;
use voleeo_core::EnvironmentVariable;

impl ApiBackend {
    pub(super) async fn env_list(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let reveal = redact::reveal(args);
        let environments = self.environments.clone();
        super::run_blocking(move || match environments.list(&ws_id) {
            Ok(mut envs) => {
                if !reveal {
                    for env in envs.iter_mut() {
                        redact::mask_env(env);
                    }
                }
                ToolResult::json(&envs)
            }
            Err(e) => ToolResult::error(e.to_string()),
        })
        .await
    }

    pub(super) async fn env_get(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let env_id = require!(args, "envId");
        let reveal = redact::reveal(args);
        let environments = self.environments.clone();
        super::run_blocking(move || match environments.get(&ws_id, &env_id) {
            Ok(Some(mut env)) => {
                if !reveal {
                    redact::mask_env(&mut env);
                }
                ToolResult::json(&env)
            }
            Ok(None) => ToolResult::error("Environment not found"),
            Err(e) => ToolResult::error(e.to_string()),
        })
        .await
    }

    pub(super) fn env_create(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let name = require!(args, "name");
        let color = args["color"].as_str().unwrap_or("").to_string();
        let shared = args["shared"].as_bool().unwrap_or(false);
        match self
            .environments
            .create_personal(ws_id.clone(), name, color, shared)
        {
            Ok(env) => {
                self.notify_envs(&ws_id);
                ToolResult::json(&env)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) fn env_set_variable(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let env_id = require!(args, "envId");
        let key = require!(args, "key");
        let value = require!(args, "value");
        let enabled = args["enabled"].as_bool().unwrap_or(true);

        if redact::is_mask(&value) {
            return ToolResult::error(
                "value is the masked placeholder; pass the real value \
                 (read the env with reveal=true to see the current one)",
            );
        }

        let mut env = match self.environments.get(&ws_id, &env_id) {
            Ok(Some(e)) => e,
            Ok(None) => return ToolResult::error("Environment not found"),
            Err(e) => return ToolResult::error(e.to_string()),
        };

        if let Some(var) = env.variables.iter_mut().find(|v| v.key == key) {
            var.value = value;
            var.enabled = enabled;
            // `encrypted` arg overrides; otherwise keep the variable's flag so an
            // edit never downgrades a sensitive var to plaintext.
            if let Some(enc) = args["encrypted"].as_bool() {
                var.encrypted = enc;
            }
        } else {
            env.variables.push(EnvironmentVariable {
                key,
                value,
                encrypted: args["encrypted"].as_bool().unwrap_or(false),
                enabled,
            });
        }
        env.updated_at = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.6f")
            .to_string();

        // Encrypt flagged secrets at rest on encrypted workspaces — mirrors the
        // Tauri `transform_secrets(Encrypt)` path.
        let ws_encrypted = self
            .workspaces
            .get(&ws_id)
            .map(|w| w.encrypted)
            .unwrap_or(false);
        if ws_encrypted && env.variables.iter().any(|v| v.encrypted) {
            let key = match voleeo_crypto::load_key_from_file(&ws_id, &self.app_data_dir) {
                Ok(k) => k,
                Err(e) => return ToolResult::error(e.to_string()),
            };
            for var in env.variables.iter_mut() {
                if var.encrypted && !voleeo_crypto::is_encrypted(&var.value) {
                    match voleeo_crypto::encrypt(&var.value, &key) {
                        Ok(ct) => var.value = ct,
                        Err(e) => return ToolResult::error(e.to_string()),
                    }
                }
            }
        }

        match self.environments.save(&env) {
            Ok(()) => {
                self.notify_envs(&ws_id);
                // Mask before returning so other vars' values aren't echoed back.
                redact::mask_env(&mut env);
                ToolResult::json(&env)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}
