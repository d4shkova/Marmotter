//! Opening a link, on Android.
//!
//! Same command name and same allowlist as the desktop shell; what differs is
//! only what actually opens the link. The desktop's `opener` crate has no
//! Android support, so this goes through `tauri-plugin-opener`, whose Android
//! side hands the URL to the system as an `ACTION_VIEW` intent — the browser
//! the user has chosen, or whichever app has registered for the scheme.
//!
//! The allowlist in front of it is `marmotter_shell::links`, shared with
//! desktop so neither shell can quietly become the more permissive one. It
//! matters more here, not less: an Android intent will resolve `file://` and a
//! long list of app-private schemes, so the set of things that must never reach
//! it is larger than on a desktop.

/// Opens a URL in whichever app the platform has registered for it.
///
/// Returns a plain-English reason on failure, which the front end can surface.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !marmotter_shell::links::is_openable(&url) {
        return Err("That link cannot be opened.".to_owned());
    }
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|error| format!("Could not open the link: {error}"))
}
