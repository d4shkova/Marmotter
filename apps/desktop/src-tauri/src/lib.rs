//! Marmotter desktop shell.
//!
//! Registers the transport commands and runs the window. All IRC protocol
//! logic lives in `packages/protocol`, in TypeScript.

pub mod dcc;
pub mod transport;

/// Builds and runs the Tauri application.
///
/// # Panics
///
/// Panics if the webview or the application context fails to initialise.
pub fn run() {
    tauri::Builder::default()
        // Windows' WebView2 does not implement the web Notification API, so the
        // plugin is how a mention reaches somebody whose window is behind
        // something else — which is the only time a notification matters.
        .plugin(tauri_plugin_notification::init())
        // The folder picker for where DCC downloads are saved. Desktop only —
        // the browser build has no such capability, and the file monitor is
        // absent there entirely.
        .plugin(tauri_plugin_dialog::init())
        .manage(transport::Transports::default())
        .invoke_handler(tauri::generate_handler![
            transport::transport_connect,
            transport::transport_send,
            transport::transport_disconnect,
            dcc::dcc_download_file,
            dcc::dcc_reveal_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Marmotter");
}
