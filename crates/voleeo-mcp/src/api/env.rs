use super::ApiBackend;
use crate::protocol::ToolResult;
use serde_json::Value;
use voleeo_core::EnvironmentVariable;

impl ApiBackend {
    pub(super) async fn env_list(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let environments = self.environments.clone();
        super::run_blocking(move || match environments.list(&ws_id) {
            Ok(envs) => ToolResult::json(&envs),
            Err(e) => ToolResult::error(e.to_string()),
        })
        .await
    }

    pub(super) async fn env_get(&self, args: &Value) -> ToolResult {
        let ws_id = require!(args, "workspaceId");
        let env_id = require!(args, "envId");
        let environments = self.environments.clone();
        super::run_blocking(move || match environments.get(&ws_id, &env_id) {
            Ok(Some(env)) => ToolResult::json(&env),
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

        let mut env = match self.environments.get(&ws_id, &env_id) {
            Ok(Some(e)) => e,
            Ok(None) => return ToolResult::error("Environment not found"),
            Err(e) => return ToolResult::error(e.to_string()),
        };

        if let Some(var) = env.variables.iter_mut().find(|v| v.key == key) {
            var.value = value;
            var.enabled = enabled;
        } else {
            env.variables.push(EnvironmentVariable {
                key,
                value,
                encrypted: false,
                enabled,
            });
        }
        env.updated_at = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.6f")
            .to_string();

        match self.environments.save(&env) {
            Ok(()) => {
                self.notify_envs(&ws_id);
                ToolResult::json(&env)
            }
            Err(e) => ToolResult::error(e.to_string()),
        }
    }
}
