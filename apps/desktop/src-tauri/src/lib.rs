//! Marmotter desktop shell.
//!
//! Registers the transport commands and runs the window. All IRC protocol
//! logic lives in `packages/protocol`, in TypeScript.

pub mod transport;

/// Builds and runs the Tauri application.
///
/// # Panics
///
/// Panics if the webview or the application context fails to initialise.
pub fn run() {
    tauri::Builder::default()
        .manage(transport::Transports::default())
        .invoke_handler(tauri::generate_handler![
            transport::transport_connect,
            transport::transport_send,
            transport::transport_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Marmotter");
}
