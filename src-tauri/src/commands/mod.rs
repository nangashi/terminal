#![allow(clippy::needless_pass_by_value)] // Tauri commands require by-value params

use crate::git;
use crate::pty::{PtyId, PtyManager};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

pub const PTY_OUTPUT_EVENT: &str = "pty-output";
pub const PTY_EXIT_EVENT: &str = "pty-exit";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutput {
    pub id: PtyId,
    pub data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExit {
    pub id: PtyId,
}

/// Returns the default shell for the current platform.
fn default_shell() -> String {
    // On Windows, prefer WSL if available, otherwise cmd.exe
    if cfg!(target_os = "windows") {
        if std::path::Path::new("C:\\Windows\\System32\\wsl.exe").exists() {
            return "wsl.exe".to_string();
        }
        return "cmd.exe".to_string();
    }

    // On Linux/macOS, use SHELL env or fall back to /bin/sh
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

#[tauri::command]
pub fn create_pty(
    app: AppHandle,
    state: State<'_, PtyManager>,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
) -> Result<PtyId, String> {
    let shell = default_shell();
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);
    let output_handle = app.clone();
    let exit_handle = app;
    state.spawn(
        &shell,
        cols,
        rows,
        cwd.as_deref(),
        Box::new(move |id, data| {
            let _ = output_handle.emit(PTY_OUTPUT_EVENT, PtyOutput { id, data });
        }),
        Box::new(move |id| {
            let _ = exit_handle.emit(PTY_EXIT_EVENT, PtyExit { id });
        }),
    )
}

#[tauri::command]
pub fn write_pty(state: State<'_, PtyManager>, id: PtyId, data: String) -> Result<(), String> {
    state.write(id, data.as_bytes())
}

#[tauri::command]
pub fn resize_pty(
    state: State<'_, PtyManager>,
    id: PtyId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(id, cols, rows)
}

#[tauri::command]
pub fn close_pty(state: State<'_, PtyManager>, id: PtyId) -> Result<(), String> {
    state.close(id)
}

#[tauri::command]
pub fn get_pty_cwd(state: State<'_, PtyManager>, id: PtyId) -> Result<String, String> {
    // On Linux, try /proc first (works without shell integration)
    #[cfg(target_os = "linux")]
    if let Ok(Some(pid)) = state.get_child_pid(id) {
        if let Ok(link) = std::fs::read_link(format!("/proc/{pid}/cwd")) {
            if let Some(path) = link.to_str() {
                return Ok(path.to_string());
            }
        }
    }

    // Fall back to CWD reported via OSC 7 (works on all platforms)
    state
        .get_cwd(id)?
        .ok_or_else(|| "CWD not available".to_string())
}

#[tauri::command]
pub fn get_git_info(path: String) -> Option<git::GitInfo> {
    git::get_info(std::path::Path::new(&path))
}
