use crate::secret_store::SecretStore;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use voleeo_core::VoleeoError;
use voleeo_storage::{
    CookieJarStore, EnvironmentStore, GrpcResponseStore, GrpcStore, GrpcTranscriptStore,
    RequestStore, ResponseStore, SelectionStore, SnapshotStore, WorkspaceStore, WsStore,
    WsTranscriptStore,
};

const DEFAULT_THEME: &str = "dark";
const DEFAULT_COLOR_MODE: &str = "dark";

fn default_custom_title_bar() -> bool {
    cfg!(any(target_os = "macos", target_os = "linux"))
}

fn default_auto_update() -> bool {
    true
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PersistedSettings {
    active_theme_id: String,
    #[serde(default)]
    mcp_enabled: bool,
    #[serde(default)]
    color_mode: Option<String>,
    #[serde(default = "default_custom_title_bar")]
    custom_title_bar: bool,
    #[serde(default = "default_auto_update")]
    auto_update: bool,
}

pub struct AppState {
    pub workspaces: WorkspaceStore,
    pub requests: RequestStore,
    pub environments: EnvironmentStore,
    pub cookies: CookieJarStore,
    pub responses: ResponseStore,
    pub snapshots: SnapshotStore,
    pub selections: SelectionStore,
    pub ws: WsStore,
    pub ws_transcripts: WsTranscriptStore,
    pub grpc: GrpcStore,
    pub grpc_responses: GrpcResponseStore,
    pub grpc_transcripts: GrpcTranscriptStore,
    pub executor: voleeo_http::HttpExecutor,
    pub ws_manager: voleeo_ws::WsManager,
    pub grpc_executor: voleeo_grpc::GrpcExecutor,
    pub grpc_manager: voleeo_grpc::GrpcManager,
    pub grpc_descriptors: voleeo_grpc::DescriptorCache,
    pub active_theme_id: Arc<RwLock<String>>,
    pub color_mode: Arc<RwLock<String>>,
    pub settings_path: PathBuf,
    pub secrets: Arc<RwLock<SecretStore>>,
    pub app_data_dir: PathBuf,
    pub mcp_enabled: Arc<RwLock<bool>>,
    pub mcp_token: Arc<RwLock<Option<String>>>,
    pub custom_title_bar: Arc<RwLock<bool>>,
    pub auto_update: Arc<RwLock<bool>>,
    pub ws_settings_lock: Arc<Mutex<()>>,
}

impl AppState {
    pub async fn new(
        settings_path: PathBuf,
        app_data_dir: impl AsRef<Path>,
    ) -> Result<Self, VoleeoError> {
        // Register the OS keychain as keyring-core's default store before any
        // Entry operations. keyring 4.1 moved the old `use_native_store` helper
        // behind its `cli` feature (which drags in the heavy db-keystore/turso
        // backend we don't use); its default `v1` API instead installs the
        // platform store globally on the first `Entry::new`, so a throwaway one
        // does the setup. Best-effort — the keyfile fallback covers a missing store.
        let _ = keyring::Entry::new("voleeo", "keyring-init");
        let app_data_dir = app_data_dir.as_ref().to_path_buf();
        let workspaces = WorkspaceStore::new(&app_data_dir)?;
        let requests = RequestStore::new(&app_data_dir)?;
        let environments = EnvironmentStore::new(&app_data_dir)?;
        let cookies = CookieJarStore::new(&app_data_dir)?;
        let responses = ResponseStore::new(&app_data_dir)?;
        let snapshots = SnapshotStore::new(&app_data_dir, workspaces.clone())?;
        let selections = SelectionStore::new(&app_data_dir)?;
        let ws = WsStore::new(&app_data_dir)?;
        let ws_transcripts = WsTranscriptStore::new(&app_data_dir)?;
        let grpc = GrpcStore::new(&app_data_dir)?;
        let grpc_responses = GrpcResponseStore::new(&app_data_dir)?;
        let grpc_transcripts = GrpcTranscriptStore::new(&app_data_dir)?;
        let secrets = SecretStore::new(&app_data_dir)?;

        let settings: Option<PersistedSettings> = std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());

        let active_theme_id = settings
            .as_ref()
            .map(|s| s.active_theme_id.clone())
            .unwrap_or_else(|| DEFAULT_THEME.to_string());
        let color_mode = settings
            .as_ref()
            .and_then(|s| s.color_mode.clone())
            .unwrap_or_else(|| DEFAULT_COLOR_MODE.to_string());
        let mcp_enabled = settings.as_ref().map(|s| s.mcp_enabled).unwrap_or(false);
        let custom_title_bar = settings
            .as_ref()
            .map(|s| s.custom_title_bar)
            .unwrap_or_else(default_custom_title_bar);
        let auto_update = settings.as_ref().map(|s| s.auto_update).unwrap_or(true);
        let mcp_token = secrets.get("mcp_token").map(str::to_string);

        let executor = voleeo_http::HttpExecutor::new()?;
        let ws_manager = voleeo_ws::WsManager::new();
        let grpc_executor = voleeo_grpc::GrpcExecutor::new();
        let grpc_manager = voleeo_grpc::GrpcManager::new();
        let grpc_descriptors = voleeo_grpc::DescriptorCache::new();

        Ok(Self {
            workspaces,
            requests,
            environments,
            cookies,
            responses,
            snapshots,
            selections,
            ws,
            ws_transcripts,
            grpc,
            grpc_responses,
            grpc_transcripts,
            executor,
            ws_manager,
            grpc_executor,
            grpc_manager,
            grpc_descriptors,
            active_theme_id: Arc::new(RwLock::new(active_theme_id)),
            color_mode: Arc::new(RwLock::new(color_mode)),
            settings_path,
            secrets: Arc::new(RwLock::new(secrets)),
            app_data_dir,
            mcp_enabled: Arc::new(RwLock::new(mcp_enabled)),
            mcp_token: Arc::new(RwLock::new(mcp_token)),
            custom_title_bar: Arc::new(RwLock::new(custom_title_bar)),
            auto_update: Arc::new(RwLock::new(auto_update)),
            ws_settings_lock: Arc::new(Mutex::new(())),
        })
    }

    pub async fn save_settings(&self) {
        let active_theme_id = self.active_theme_id.read().await.clone();
        let color_mode = Some(self.color_mode.read().await.clone());
        let mcp_enabled = *self.mcp_enabled.read().await;
        let custom_title_bar = *self.custom_title_bar.read().await;
        let auto_update = *self.auto_update.read().await;
        let settings = PersistedSettings {
            active_theme_id,
            mcp_enabled,
            color_mode,
            custom_title_bar,
            auto_update,
        };
        let json = match serde_json::to_string(&settings) {
            Ok(json) => json,
            Err(e) => {
                eprintln!("failed to serialize settings: {e}");
                return;
            }
        };
        let path = self.settings_path.clone();
        match tokio::task::spawn_blocking(move || std::fs::write(&path, json)).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => eprintln!("failed to persist settings: {e}"),
            Err(e) => eprintln!("settings write task failed: {e}"),
        }
    }
}
