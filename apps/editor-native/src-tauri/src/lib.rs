// The native half of Editor Studio's desktop/mobile shell. Almost everything
// the app does still runs in the WebView (the same TypeScript engine the web
// build ships - see lib/editor/* in the repo root) - this file's only job is
// the handful of things a browser tab genuinely cannot do: report the real
// amount of system memory so the frontend can raise its own quality ceilings
// past what it would ever assume safe as an ordinary tab (see
// lib/device.ts's `nativeSystemInfo()`), and grant the WebView the
// filesystem/dialog plugins so import/export can talk to the OS directly.

use serde::Serialize;
use sysinfo::System;

#[derive(Serialize)]
struct SystemInfo {
    total_memory_bytes: u64,
    available_memory_bytes: u64,
    cpu_cores: usize,
    /// "windows" | "macos" | "linux" | "android" | "ios"
    os: String,
}

#[tauri::command]
fn system_info() -> SystemInfo {
    let mut sys = System::new();
    sys.refresh_memory();
    SystemInfo {
        total_memory_bytes: sys.total_memory(),
        available_memory_bytes: sys.available_memory(),
        cpu_cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4),
        os: std::env::consts::OS.to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![system_info])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
