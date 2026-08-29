//! Settings that outlive a launch.
//!
//! One JSON file in the app data directory, read and written whole. The shape
//! of what is in it is decided in TypeScript and never parsed here — this reads
//! and writes a string, which is the same division of labour the log store and
//! the transport follow.
//!
//! **No secrets go in this file.** Passwords resolve through a `SecretRef`
//! against the platform keychain; what lives here is a nick, a couple of
//! fallbacks, and a real name, all of which IRC broadcasts to anyone who asks.

use std::fs;
use std::path::PathBuf;

use tauri::Manager;

/// Where the settings file lives.
fn path_of(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not find where to keep your settings: {error}"))?;
    Ok(dir.join("preferences.json"))
}

/// Reads the settings file, or nothing at all on a first launch.
///
/// A missing file is the ordinary first-run state rather than a failure, and a
/// file that cannot be read is reported so the front end can say so rather than
/// silently starting over with blank settings.
#[tauri::command]
pub fn prefs_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = path_of(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read your settings: {error}")),
    }
}

/// Writes the settings file, replacing what was there.
///
/// Written to a temporary file and renamed over the original, so a crash or a
/// full disk midway leaves the previous settings intact rather than a truncated
/// file that reads as corrupt on the next launch.
#[tauri::command]
pub fn prefs_write(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = path_of(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the settings folder: {error}"))?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, contents.as_bytes())
        .map_err(|error| format!("Could not save your settings: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| {
        // Leaving the temporary file behind would be litter in somebody's app
        // data folder that nothing ever cleans up.
        let _ = fs::remove_file(&temporary);
        format!("Could not save your settings: {error}")
    })
}
