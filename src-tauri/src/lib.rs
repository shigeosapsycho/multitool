mod commands;
mod config;
mod update;
mod watcher;

use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub struct AppState {
    pub config: Mutex<config::Config>,
    pub watcher: Mutex<Option<watcher::OutputWatcher>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();

            let cfg = config::Config::load(&handle).unwrap_or_default();
            app.manage(AppState {
                config: Mutex::new(cfg),
                watcher: Mutex::new(None),
            });

            if let Err(err) = commands::ensure_output_dir(&handle) {
                eprintln!("ensure_output_dir failed: {err}");
            }
            if let Err(err) = commands::start_output_watcher(&handle) {
                eprintln!("start_output_watcher failed: {err}");
            }

            if let Some(window) = app.get_webview_window("main") {
                let win_for_event = window.clone();
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)
                    ) {
                        let maximized = win_for_event.is_maximized().unwrap_or(false);
                        let _ = win_for_event.emit("window:maximized-changed", maximized);
                    }
                });
                let _ = window.show();
            }

            // If a `.old` exe leftover is present we just self-updated. Tell the
            // renderer once it's had a moment to mount its event listeners.
            if update::cleanup_after_update() {
                let handle_for_upgrade = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    let _ = handle_for_upgrade.emit("upgrade-applied", env!("CARGO_PKG_VERSION"));
                });
            }

            // Side mouse buttons (Mouse4/Mouse5) — reserved hook; the renderer
            // also listens via DOM events which covers most cases.
            #[cfg(target_os = "windows")]
            {
                let handle_for_appcommand = handle.clone();
                if let Some(window) = app.get_webview_window("main") {
                    crate::commands::install_app_command_hook(&window, handle_for_appcommand);
                }
            }

            #[cfg(not(target_os = "windows"))]
            let _ = &handle;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::window_minimize,
            commands::window_maximize,
            commands::window_close,
            commands::window_is_maximized,
            commands::files_open,
            commands::files_pick_output_dir,
            commands::files_read,
            commands::files_write_output,
            commands::files_write_outputs,
            commands::files_reveal,
            commands::files_open_file,
            commands::files_open_output_dir,
            commands::files_list_output,
            commands::files_clear_output,
            commands::files_delete_output,
            commands::files_shuffle_output,
            commands::files_get_output_dir,
            commands::config_get,
            commands::config_set_file_preview,
            commands::config_set_delete_to_trash,
            commands::config_set_theme,
            commands::config_set_output_sort,
            commands::app_get_version,
            update::updater_check,
            update::updater_apply_and_restart,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
