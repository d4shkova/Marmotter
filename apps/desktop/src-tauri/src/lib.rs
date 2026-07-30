//! Marmotter desktop shell.
//!
//! Phase 2 of BUILD_PLAN.md registers the `marmotter-transport` commands here.

/// Builds and runs the Tauri application.
///
/// # Panics
///
/// Panics if the webview or the application context fails to initialise.
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Marmotter");
}
