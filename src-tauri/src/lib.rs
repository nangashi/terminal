mod commands;
pub mod git;
pub mod pty;

use commands::{close_pty, create_pty, get_git_info, get_pty_cwd, resize_pty, write_pty};
use pty::PtyManager;

/// # Panics
///
/// Panics if the Tauri application fails to initialize.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            create_pty,
            write_pty,
            resize_pty,
            close_pty,
            get_pty_cwd,
            get_git_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
