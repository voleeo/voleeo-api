use crate::commands::request::run_blocking;
use crate::state::AppState;
use tauri::State;
use voleeo_core::VoleeoError;
use voleeo_crypto as workspace_key;

/// Returns the 8×8 hex backup key for display to the user.
/// Only valid when `workspace.encrypted == true`.
#[tauri::command]
#[specta::specta]
pub async fn workspace_get_key_display(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<String, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    run_blocking(move || {
        let key = workspace_key::load_key(&workspace_id, &app_data_dir)?;
        Ok(workspace_key::encode_key_display(&key))
    })
    .await
}

/// Enable encryption on an existing workspace: generate + store a key,
/// re-encrypt any existing plaintext secret, persist `encrypted = true` + a
/// key-check token, and return the display key for the backup card.
#[tauri::command]
#[specta::specta]
pub async fn workspace_enable_encryption(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<String, VoleeoError> {
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    let secrets = state.secrets.clone();
    // Keychain save, secret re-encrypt+persist, and YAML save all block; the
    // secrets guard is taken via blocking_write so it never crosses an .await.
    run_blocking(move || {
        let key = workspace_key::generate_key();
        workspace_key::save_key(&workspace_id, &key, &app_data_dir)?;

        // Re-encrypt any existing plaintext secret for this workspace.
        {
            let mut secrets = secrets.blocking_write();
            if let Some(plain) = secrets.get(&workspace_id).map(|s| s.to_owned()) {
                if !workspace_key::is_encrypted(&plain) {
                    secrets.set_encrypted(workspace_id.clone(), &plain, &key)?;
                }
            }
        }

        // Persist workspace.encrypted = true + a key-verification token.
        let key_check = workspace_key::encrypt(&workspace_id, &key)?;
        let mut ws = workspaces.get(&workspace_id)?;
        ws.encrypted = true;
        ws.key_check = Some(key_check);
        workspaces.save(&ws)?;

        Ok(workspace_key::encode_key_display(&key))
    })
    .await
}

/// Import a backup key, replacing the current one. When the workspace has a
/// `keyCheck` token, decrypt it with the candidate and verify it matches the
/// workspace ID — catches typos before they lock the user out of their secrets.
#[tauri::command]
#[specta::specta]
pub async fn workspace_import_key(
    state: State<'_, AppState>,
    workspace_id: String,
    display_key: String,
) -> Result<(), VoleeoError> {
    let workspaces = state.workspaces.clone();
    let app_data_dir = state.app_data_dir.clone();
    // YAML read + keychain save both block.
    run_blocking(move || {
        let key = workspace_key::decode_key_display(&display_key)?;

        // Verify the key is correct when we have a token to check against.
        if let Ok(ws) = workspaces.get(&workspace_id) {
            if let Some(token) = &ws.key_check {
                let plaintext = workspace_key::decrypt(token, &key).map_err(|_| {
                    VoleeoError::Crypto(
                        "This key does not match the one used to encrypt this workspace. \
                         Please check that you're importing the correct backup key."
                            .to_string(),
                    )
                })?;
                if plaintext != workspace_id {
                    return Err(VoleeoError::Crypto(
                        "Key verification failed — the decrypted token did not match \
                         this workspace. Please import the correct backup key."
                            .to_string(),
                    ));
                }
            }
        }

        workspace_key::save_key(&workspace_id, &key, &app_data_dir)?;
        Ok(())
    })
    .await
}

/// Encrypt a value with the workspace key → `enc:v1:…`. Backs the
/// `{{ encrypt(value) }}` template function. Requires encryption enabled.
#[tauri::command]
#[specta::specta]
pub async fn workspace_encrypt_value(
    state: State<'_, AppState>,
    workspace_id: String,
    plaintext: String,
) -> Result<String, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    run_blocking(move || {
        let key = workspace_key::load_key(&workspace_id, &app_data_dir)?;
        workspace_key::encrypt(&plaintext, &key)
    })
    .await
}

/// Decrypt a ciphertext produced by `workspace_encrypt_value` back to plaintext.
/// The workspace must have encryption enabled and a key available.
#[tauri::command]
#[specta::specta]
pub async fn workspace_decrypt_value(
    state: State<'_, AppState>,
    workspace_id: String,
    ciphertext: String,
) -> Result<String, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    run_blocking(move || {
        let key = workspace_key::load_key(&workspace_id, &app_data_dir)?;
        workspace_key::decrypt(&ciphertext, &key)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn workspace_has_key(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<bool, VoleeoError> {
    let app_data_dir = state.app_data_dir.clone();
    run_blocking(move || Ok(workspace_key::load_key(&workspace_id, &app_data_dir).is_ok())).await
}
