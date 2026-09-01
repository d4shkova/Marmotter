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
//! `keyring` crate, which has no Android backend at all. There is no folder
//! picker and no file manager to reveal a download in, so the shell answers
//! with a folder of its own instead; see `src/App.tsx`.

pub mod connection;
pub mod opener;
pub mod secrets;

// The socket, the log files and the settings file are the same job on every
// Tauri shell, so they come from `marmotter-shell` and are shared with desktop.
use marmotter_shell::{dcc, logstore, prefs, transport};

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
    // Logcat, before anything that could fail.
    //
    // Nothing else in this process writes anywhere a person can read: `println!`
    // goes to a stdout Android discards, and a panic in a release build aborts
    // without a word. So an app that starts and draws nothing looks identical to
    // one whose entry point was never called, and that ambiguity costs a build
    // cycle every time. This is the line that distinguishes them.
    #[cfg(target_os = "android")]
    {
        android_logger::init_once(
            android_logger::Config::default()
                .with_max_level(log::LevelFilter::Debug)
                .with_tag("Marmotter"),
        );
        log::info!("starting the shell");
    }

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
        // The foreground service that keeps a connection alive while the app is
        // not in front. Registers the Kotlin side that owns it.
        .plugin(connection::init())
        .setup(|_app| {
            // Reached only once every plugin's own setup has run, which is
            // where the Android ones ask Kotlin for their class. Between the
            // "starting" line and this one is where a plugin that cannot find
            // its class, or that blocks waiting on the main thread, will stop.
            log::info!("plugins registered, building the window");
            Ok(())
        })
        .manage(transport::Transports::default())
        .invoke_handler(tauri::generate_handler![
            transport::transport_connect,
            transport::transport_send,
            transport::transport_disconnect,
            // The DCC file monitor, shared with desktop. `dcc_reveal_file` is
            // not among them and is not compiled on Android: there is no file
            // manager here that will open an app's own storage, and the front
            // end hides the button where the shell offers no way to do it.
            // `dcc_default_dir` takes the folder picker's place — an app may
            // write inside its own storage without a permission, and every
            // other folder costs one that would let it read the whole device.
            dcc::dcc_download_file,
            dcc::dcc_receive_passive,
            dcc::dcc_resumable_bytes,
            dcc::dcc_cancel_download,
            dcc::dcc_default_dir,
            opener::open_external_url,
            connection::connection_hold,
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
        // Logged rather than unwrapped. A panic here unwinds into tao's
        // catch_unwind, which prints to a stdout Android discards and then
        // aborts — so the one thing worth knowing goes missing at exactly the
        // moment it is needed.
        .unwrap_or_else(|error| log::error!("the shell stopped: {error}"));

    log::info!("the shell has exited");
}
