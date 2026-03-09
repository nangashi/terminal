#![allow(clippy::needless_pass_by_value)] // Tauri commands require by-value params

use crate::git;
use crate::pty::{PtyId, PtyManager};
use serde::Serialize;
use std::sync::Once;
use tauri::{AppHandle, Emitter, State};

/// Debug log file for diagnosing Windows PTY issues.
/// Writes to `terminal-debug.log` in the user's home directory.
fn debug_log(msg: &str) {
    use std::io::Write;
    static INIT: Once = Once::new();
    let path = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string())
        + "/terminal-debug.log";
    INIT.call_once(|| {
        // Truncate on first write per session
        let _ = std::fs::write(&path, "");
    });
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&path)
    {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let _ = writeln!(f, "[{:.3}] {msg}", now.as_secs_f64());
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
        return default_shell_windows();
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

    debug_log("default_shell_windows: start");
    let wsl_path = r"C:\Windows\System32\wsl.exe";
    if std::path::Path::new(wsl_path).exists() {
        debug_log("default_shell_windows: wsl.exe exists, checking distros");
        if let Ok(output) = std::process::Command::new(wsl_path)
            .args(["--list", "--quiet"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            debug_log(&format!(
                "default_shell_windows: wsl --list --quiet exit={}, stdout={:?}",
                output.status,
                stdout.trim()
            ));
            if output.status.success() {
                debug_log("default_shell_windows: using wsl.exe");
                return wsl_path.to_string();
            }
        } else {
            debug_log("default_shell_windows: wsl --list --quiet failed to run");
        }
    } else {
        debug_log("default_shell_windows: wsl.exe not found");
    }
    debug_log("default_shell_windows: falling back to cmd.exe");
    r"C:\Windows\System32\cmd.exe".to_string()
}

#[tauri::command]
pub fn create_pty(
    app: AppHandle,
    state: State<'_, PtyManager>,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
) -> Result<PtyId, String> {
    debug_log(&format!(
        "create_pty: called cols={cols:?} rows={rows:?} cwd={cwd:?}"
    ));
    let shell = default_shell();
    debug_log(&format!("create_pty: shell={shell:?}"));
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);
    let output_handle = app.clone();
    let exit_handle = app;
    let result = state.spawn(
        &shell,
        cols,
        rows,
        cwd.as_deref(),
        Box::new(move |id, data| {
            let _ = output_handle.emit(PTY_OUTPUT_EVENT, PtyOutput { id, data });
        }),
        Box::new(move |id| {
            debug_log(&format!("pty_exit: id={id}"));
            let _ = exit_handle.emit(PTY_EXIT_EVENT, PtyExit { id });
        }),
    );
    debug_log(&format!("create_pty: result={result:?}"));
    result
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
