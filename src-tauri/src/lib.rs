mod commands;
mod config;
mod email_unsubscribe;
mod imap_cleaner;
mod imap_creds;
mod update;
#[cfg(target_os = "windows")]
mod uninstall_old;
mod watcher;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

pub struct AppState {
    pub config: Mutex<config::Config>,
    pub watcher: Mutex<Option<watcher::OutputWatcher>>,
    pub proxy_cancel: Arc<AtomicBool>,
    pub imap_cancel: Arc<AtomicBool>,
    pub unsub_cancel: Arc<AtomicBool>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let handle = app.handle().clone();

            let cfg = config::Config::load(&handle).unwrap_or_default();
            app.manage(AppState {
                config: Mutex::new(cfg),
                watcher: Mutex::new(None),
                proxy_cancel: Arc::new(AtomicBool::new(false)),
                imap_cancel: Arc::new(AtomicBool::new(false)),
                unsub_cancel: Arc::new(AtomicBool::new(false)),
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

            // Remove the legacy Electron-based BeuMultiTool if it's still
            // installed, so only this Tauri build remains. Runs off-thread so a
            // slow NSIS uninstaller never blocks the window from painting.
            #[cfg(target_os = "windows")]
            {
                let handle_for_uninstall = handle.clone();
                let skip_uninstall = {
                    let state = handle.state::<AppState>();
                    let cfg = state.config.lock().unwrap();
                    cfg.old_version_removed.unwrap_or(false)
                };
                std::thread::spawn(move || {
                    let outcome = uninstall_old::detect_and_remove_old_version(skip_uninstall);
                    if outcome.attempted {
                        // Give the renderer a moment to mount its listeners.
                        std::thread::sleep(std::time::Duration::from_millis(1200));
                        let _ = handle_for_uninstall.emit("old-version-removed", ());
                    }
                    // Persist the run-once flag only on a confirmed removal, so
                    // a partial uninstall is retried on the next launch.
                    if outcome.fully_removed {
                        if let Some(state) = handle_for_uninstall.try_state::<AppState>() {
                            let mut cfg = state.config.lock().unwrap();
                            cfg.old_version_removed = Some(true);
                            let _ = cfg.save(&handle_for_uninstall);
                        }
                    }
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
            commands::files_open_url,
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
            commands::config_set_pokemon_grouping,
            commands::config_set_restore_last_module,
            commands::app_get_version,
            commands::net_test_proxies,
            commands::net_cancel_proxies,
            update::updater_check,
            update::updater_apply_and_restart,
            imap_cleaner::imap_list_accounts,
            imap_cleaner::imap_save_account,
            imap_cleaner::imap_delete_account,
            imap_cleaner::imap_test,
            imap_cleaner::imap_scan,
            imap_cleaner::imap_cancel,
            imap_cleaner::imap_delete,
            imap_cleaner::imap_fetch_body,
            email_unsubscribe::unsub_scan,
            email_unsubscribe::unsub_cancel,
            email_unsubscribe::unsub_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
