#![allow(clippy::needless_pass_by_value)] // Tauri commands require by-value params

use crate::git;
use crate::pty::{PtyId, PtyManager};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

// TODO: 暫定デバッグログ — Windows exe で WSL シェルが起動しない問題の調査用。
// 問題解決後に削除すること。
pub(crate) fn debug_log(msg: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("terminal-debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "[{now}] {msg}");
    }
}

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
    #[cfg(target_os = "windows")]
    {
        let shell = default_shell_windows();
        // TODO: 暫定デバッグログ
        debug_log(&format!("default_shell selected: {shell}"));
        return shell;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

/// Windows: prefer WSL (if a distribution is installed), otherwise cmd.exe.
///
/// Uses full paths and verifies WSL availability to prevent invisible
/// ConPTY/console windows from spawning when no distribution exists.
#[cfg(target_os = "windows")]
fn default_shell_windows() -> String {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let wsl_path = r"C:\Windows\System32\wsl.exe";
    if std::path::Path::new(wsl_path).exists() {
        // Verify at least one WSL distribution is installed.
        // Without this, wsl.exe exists but exits immediately with an error,
        // causing flickering console windows via ConPTY.
        // TODO: 暫定デバッグログ
        debug_log("wsl.exe exists, checking for distributions...");
        if let Ok(output) = std::process::Command::new(wsl_path)
            .args(["--list", "--quiet"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            // TODO: 暫定デバッグログ
            let stdout_lossy = String::from_utf8_lossy(&output.stdout);
            let stderr_lossy = String::from_utf8_lossy(&output.stderr);
            debug_log(&format!(
                "wsl --list --quiet: status={}, stdout={:?}, stderr={:?}",
                output.status, stdout_lossy, stderr_lossy
            ));
            if output.status.success() {
                return wsl_path.to_string();
            }
        } else {
            // TODO: 暫定デバッグログ
            debug_log("wsl --list --quiet: failed to execute");
        }
    }
    r"C:\Windows\System32\cmd.exe".to_string()
}

#[tauri::command]
#[specta::specta]
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
    // TODO: 暫定デバッグログ
    debug_log(&format!(
        "create_pty: shell={shell}, cols={cols}, rows={rows}, cwd={cwd:?}"
    ));
    let output_handle = app.clone();
    let exit_handle = app;
    let result = state
        .spawn(
            &shell,
            cols,
            rows,
            cwd.as_deref(),
            Box::new(move |id, data| {
                let _ = output_handle.emit(PTY_OUTPUT_EVENT, PtyOutput { id, data });
            }),
            Box::new(move |id| {
                // TODO: 暫定デバッグログ
                debug_log(&format!("pty-exit event fired: id={id}"));
                let _ = exit_handle.emit(PTY_EXIT_EVENT, PtyExit { id });
            }),
        )
        .map_err(|e| e.to_string());
    // TODO: 暫定デバッグログ
    debug_log(&format!("create_pty result: {result:?}"));
    result
}

#[tauri::command]
#[specta::specta]
pub fn write_pty(state: State<'_, PtyManager>, id: PtyId, data: String) -> Result<(), String> {
    state.write(id, data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn resize_pty(
    state: State<'_, PtyManager>,
    id: PtyId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn close_pty(state: State<'_, PtyManager>, id: PtyId) -> Result<(), String> {
    state.close(id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
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
        .get_cwd(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "CWD not available".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_git_info(path: String) -> Option<git::GitInfo> {
    git::get_info(std::path::Path::new(&path))
}
