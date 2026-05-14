use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, Debouncer};
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct OutputWatcher {
    _debouncer: Debouncer<notify::RecommendedWatcher>,
}

pub fn watch(app: AppHandle, dir: &Path) -> anyhow::Result<OutputWatcher> {
    let (tx, rx) = mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(120), tx)?;
    debouncer
        .watcher()
        .watch(dir, RecursiveMode::NonRecursive)?;

    thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            if event.is_ok() {
                let _ = app.emit("output:changed", ());
            }
        }
    });

    Ok(OutputWatcher {
        _debouncer: debouncer,
    })
}
