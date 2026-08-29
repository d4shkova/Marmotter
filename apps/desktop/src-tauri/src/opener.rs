//! Opening a link in the platform's default browser.
//!
//! The app's own webview cannot navigate to an arbitrary page, so a link in a
//! message is handed to the platform instead. Kept deliberately narrow: only
//! web and IRC schemes are opened, and the URL never passes through a shell, so
//! it cannot be turned into a way to run a command or open a local file.
//!
//! The handing-over itself goes through the `opener` crate rather than a
//! subprocess we spawn. That is a correctness fix, not tidying: `explorer <url>`
//! — the obvious way to open a link on Windows, and what this module used to do
//! — hands the string to the file manager, which decides for itself whether it
//! is looking at an address or a path. On a URL carrying a query string it
//! regularly decides "path" and opens a File Explorer window instead of the
//! browser, which is what a YouTube watch link is: `?v=…&t=…`. `ShellExecuteW`,
//! which is what the crate calls, is the API Windows documents for this and
//! does not guess. Linux gains a fallback chain past `xdg-open` from the same
//! change.

/// Opens a URL in the platform's default browser.
///
/// Returns a plain-English reason on failure, which the front end can surface.
/// Refuses anything that is not a web, IRC, or mail link — the interface only
/// ever asks this to open a link it detected in a message.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !marmotter_shell::links::is_openable(&url) {
        return Err("That link cannot be opened.".to_owned());
    }
    opener::open(&url).map_err(|error| format!("Could not open the link: {error}"))
}

/// Shows the log folder in the platform's file manager.
///
/// Desktop-only, and not in `marmotter-shell` with the rest of the log-file
/// commands for that reason: Android has no file manager that will open an
/// app's own storage, so its shell does not register this and the settings
/// screen hides the button rather than offering one that fails.
#[tauri::command]
pub fn log_reveal(root: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&root);
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("Could not create the log folder: {error}"))?;
    opener::open(&path).map_err(|error| format!("Could not open the log folder: {error}"))
}
