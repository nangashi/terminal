// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Force software rendering on WSL2 (no GPU passthrough)
    #[cfg(target_os = "linux")]
    if std::fs::read_to_string("/proc/version")
        .map(|v| v.contains("microsoft") || v.contains("WSL"))
        .unwrap_or(false)
    {
        std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    terminal_lib::run();
}
