use super::{redact, ApiBackend};
use crate::protocol::ToolResult;
use serde_json::Value;
use voleeo_core::{Environment, EnvironmentKind, EnvironmentVariable, VoleeoError};
use voleeo_storage::GLOBAL_ENV_ID;

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

    pub(super) async fn env_create(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let name = require!(args, "name");
        let color = args["color"].as_str().unwrap_or("").to_string();
        let shared = args["shared"].as_bool().unwrap_or(false);
        let environments = self.environments.clone();
        let ws = ws_id.clone();
        match super::blocking(move || environments.create_personal(ws, name, color, shared)).await {
            Ok(env) => {
                self.notify_envs(&ws_id);
                ToolResult::json(&env)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn env_set_variable(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let env_id = require!(args, "envId");
        let key = require!(args, "key");
        let delete = args["delete"].as_bool().unwrap_or(false);
        let enabled = args["enabled"].as_bool().unwrap_or(true);
        let encrypted_arg = args["encrypted"].as_bool();

        // `value` is required unless deleting the variable.
        let value = if delete {
            String::new()
        } else {
            let v = require!(args, "value");
            if redact::is_mask(&v) {
                return ToolResult::error(
                    "value is the masked placeholder; pass the real value \
                     (read the env with reveal=true to see the current one)",
                );
            }
            v
        };

        let environments = self.environments.clone();
        let workspaces = self.workspaces.clone();
        let app_data_dir = self.app_data_dir.clone();
        let ws = ws_id.clone();
        let result = super::blocking(move || -> Result<Environment, VoleeoError> {
            let mut env = environments
                .get(&ws, &env_id)?
                .ok_or_else(|| VoleeoError::NotFound("environment".into()))?;

            if delete {
                env.variables.retain(|v| v.key != key);
            } else if let Some(var) = env.variables.iter_mut().find(|v| v.key == key) {
                var.value = value;
                var.enabled = enabled;
                // `encrypted` arg overrides; otherwise keep the variable's flag so
                // an edit never downgrades a sensitive var to plaintext.
                if let Some(enc) = encrypted_arg {
                    var.encrypted = enc;
                }
            } else {
                env.variables.push(EnvironmentVariable {
                    key,
                    value,
                    encrypted: encrypted_arg.unwrap_or(false),
                    enabled,
                });
            }
            env.updated_at = chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S%.6f")
                .to_string();

            // Encrypt flagged secrets at rest on encrypted workspaces — mirrors
            // the Tauri `transform_secrets(Encrypt)` path.
            let ws_encrypted = workspaces.get(&ws).map(|w| w.encrypted).unwrap_or(false);
            if ws_encrypted && env.variables.iter().any(|v| v.encrypted) {
                let key = voleeo_crypto::load_key_from_file(&ws, &app_data_dir)?;
                for var in env.variables.iter_mut() {
                    if var.encrypted && !voleeo_crypto::is_encrypted(&var.value) {
                        var.value = voleeo_crypto::encrypt(&var.value, &key)?;
                    }
                }
            }
            environments.save(&env)?;
            Ok(env)
        })
        .await;

        match result {
            Ok(mut env) => {
                self.notify_envs(&ws_id);
                // Mask before returning so other vars' values aren't echoed back.
                redact::mask_env(&mut env);
                ToolResult::json(&env)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }

    pub(super) async fn env_delete(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let env_id = require!(args, "envId");
        if env_id == GLOBAL_ENV_ID {
            return ToolResult::error("the Global Environment cannot be deleted");
        }
        let environments = self.environments.clone();
        let ws = ws_id.clone();
        let eid = env_id.clone();
        let result = super::blocking(move || -> Result<(), VoleeoError> {
            // Guard the global env by kind too, not just id (idempotent otherwise).
            if let Some(env) = environments.get(&ws, &eid)? {
                if matches!(env.kind, EnvironmentKind::Global) {
                    return Err(VoleeoError::InvalidConfig(
                        "the Global Environment cannot be deleted".into(),
                    ));
                }
            }
            environments.delete(&ws, &eid)
        })
        .await;
        match result {
            Ok(()) => {
                self.notify_envs(&ws_id);
                ToolResult::json(&serde_json::json!({ "deleted": env_id }))
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}
