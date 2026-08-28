//! Marmotter Android shell.
//!
//! The same job as the desktop shell and mostly the same code: it registers the
//! commands the front end calls and starts the app. All IRC protocol logic
//! lives in `packages/protocol`, in TypeScript — this side opens sockets and
//! files, and knows nothing about channels.
//!
//! What differs from desktop is the short list this crate implements itself:
//! opening a link is an intent rather than a `ShellExecuteW`, and the keychain
//! is the Android Keystore reached through a Kotlin plugin rather than the
//! `keyring` crate, which has no Android backend at all. There is no DCC file
//! monitor and no folder picker, both by design; see `src/App.tsx`.

pub mod opener;
pub mod secrets;

// The socket, the log files and the settings file are the same job on every
// Tauri shell, so they come from `marmotter-shell` and are shared with desktop.
use marmotter_shell::{logstore, prefs, transport};

/// Builds and runs the app.
///
/// `mobile_entry_point` is what the generated Android activity calls through
/// JNI once its `WryActivity` is up. On a development machine the same function
/// is reached through `main.rs` instead.
///
/// # Panics
///
/// Panics if the webview or the application context fails to initialise.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // An Android WebView has no web Notification API, so this is the only
        // way a mention reaches somebody who is not looking at the app.
        .plugin(tauri_plugin_notification::init())
        // The local log database. Off by default and empty until somebody
        // switches logging on, so an unused install has no database file.
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Hands a link to the system as an ACTION_VIEW intent. The allowlist
        // that decides which links reach it is in `opener.rs`.
        .plugin(tauri_plugin_opener::init())
        // Passwords, in the Android Keystore. Registers the Kotlin side that
        // actually holds the key; see `secrets.rs`.
        .plugin(secrets::init())
        .manage(transport::Transports::default())
        .invoke_handler(tauri::generate_handler![
            transport::transport_connect,
            transport::transport_send,
            transport::transport_disconnect,
            opener::open_external_url,
            logstore::log_default_dir,
            logstore::log_append,
            logstore::log_read,
            logstore::log_list,
            logstore::log_write,
            logstore::log_delete,
            // No `log_reveal`: Android has no file manager that will open an
            // app's own storage. The settings screen hides the button when the
            // log store offers no way to do it, rather than drawing one that
            // fails — see `packages/platform-tauri/src/logging/index.ts`.
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
