//! Marmotter desktop shell.
//!
//! Registers the transport commands and runs the window. All IRC protocol
//! logic lives in `packages/protocol`, in TypeScript.

pub mod opener;
pub mod secrets;

// The socket, the log files, the settings file and the DCC download are the
// same job on every Tauri shell, so they come from `marmotter-shell` and are
// shared with Android. What is left in this crate is what only a desktop has.
use marmotter_shell::{dcc, logstore, prefs, transport};

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
        // The local log database. Off by default and empty until somebody
        // switches logging on; the plugin only opens what the front end asks
        // it to open, so an unused install has no database file at all.
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(transport::Transports::default())
        .invoke_handler(tauri::generate_handler![
            transport::transport_connect,
            transport::transport_send,
            transport::transport_disconnect,
            dcc::dcc_download_file,
            dcc::dcc_cancel_download,
            dcc::dcc_reveal_file,
            dcc::dcc_default_dir,
            opener::open_external_url,
            logstore::log_default_dir,
            logstore::log_append,
            logstore::log_read,
            logstore::log_list,
            logstore::log_write,
            logstore::log_delete,
            opener::log_reveal,
            prefs::prefs_read,
            prefs::prefs_write,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            secrets::secret_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Marmotter");
}
