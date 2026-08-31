//! The Tauri commands behind the DCC file monitor's Download button.
//!
//! Thin, like the transport commands beside it: it converts the shape the front
//! end sends into the crate's [`DccDownloadOptions`] and returns the path the
//! file was written to. All the socket and filesystem work — sanitising the
//! name, refusing to overwrite, stopping at the advertised size — lives in
//! `marmotter-transport`, which is where it can be tested without a webview.
//!
//! The one thing added here is progress: the crate calls back as bytes arrive,
//! and each call is forwarded to the front end as an event tagged with the
//! transfer's id, so the row that started the download can show a bar.
//!
//! Shared by both Tauri shells. Opening a socket and writing what comes out of
//! it to a file is the same job on a desktop and on a phone, and the reasons
//! the monitor was desktop-only were the two things around it rather than this:
//! a folder to write into, and a file manager to open afterwards. Android has
//! the first — its own storage, which it may write to without asking for a
//! permission that would let it read the whole device — and does not have the
//! second, so `dcc_default_dir` answers the first and `dcc_reveal_file` is
//! simply not compiled there. What stays out of scope on every platform is
//! unchanged: sending, DCC CHAT, and passive transfers.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[cfg(not(target_os = "android"))]
use std::path::Path;
#[cfg(not(target_os = "android"))]
use std::process::Command;

use marmotter_transport::{
    dcc_cancel_channel, dcc_download, DccCancelHandle, DccDownloadOptions, DEFAULT_DCC_TIMEOUT,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Event emitted as a download proceeds. Payload is [`DccProgress`].
pub const DCC_PROGRESS_EVENT: &str = "marmotter://dcc-progress";

/// The cancel handle of every transfer currently in flight, keyed by its id.
///
/// A download registers its handle here when it starts and removes it when it
/// ends; `dcc_cancel_download` trips the matching one to stop a transfer the
/// user has changed their mind about. A cancel for an id that is not present —
/// a transfer that already finished, or a click that raced the registration —
/// is simply a no-op.
fn transfers() -> &'static Mutex<HashMap<String, DccCancelHandle>> {
    static TRANSFERS: OnceLock<Mutex<HashMap<String, DccCancelHandle>>> = OnceLock::new();
    TRANSFERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// What `dcc_download_file` accepts, mirroring `DccDownloadRequest` in the UI.
#[derive(Debug, Deserialize)]
pub struct DccDownloadRequest {
    pub host: String,
    pub port: u16,
    pub size: Option<u64>,
    pub filename: String,
    pub folder: String,
    /// Whether the transfer's socket is TLS, from an `SSEND` offer.
    #[serde(default)]
    pub secure: bool,
    /// Whether the sender streams without waiting to be acknowledged.
    #[serde(default)]
    pub turbo: bool,
    /// Correlates progress events with the row that started the transfer.
    #[serde(rename = "transferId")]
    pub transfer_id: String,
}

/// One progress update for a transfer in flight.
#[derive(Debug, Clone, Serialize)]
pub struct DccProgress {
    pub id: String,
    pub received: u64,
    /// The total size, where the sender advertised one.
    pub total: Option<u64>,
}

/// Downloads one advertised file into the chosen folder.
///
/// Returns the path it was written to, or a plain-English reason it could not
/// be, which the front end shows against the file.
#[tauri::command]
pub async fn dcc_download_file(
    app: AppHandle,
    request: DccDownloadRequest,
) -> Result<String, String> {
    let transfer_id = request.transfer_id;
    let emitter = app.clone();

    // Register a cancel handle so `dcc_cancel_download` can reach this transfer
    // by its id, and make sure it is removed however the download ends.
    let (cancel_handle, cancel_signal) = dcc_cancel_channel();
    transfers()
        .lock()
        .expect("the transfer registry lock was poisoned")
        .insert(transfer_id.clone(), cancel_handle);
    let _guard = TransferGuard(transfer_id.clone());

    let result = dcc_download(
        DccDownloadOptions {
            host: request.host,
            port: request.port,
            size: request.size,
            filename: request.filename,
            folder: PathBuf::from(request.folder),
            secure: request.secure,
            turbo: request.turbo,
            timeout: DEFAULT_DCC_TIMEOUT,
            cancel: Some(cancel_signal),
        },
        {
            let transfer_id = transfer_id.clone();
            move |received, total| {
                // Best-effort: a dropped progress event only costs a bar that
                // jumps, never the transfer itself.
                let _ = emitter.emit(
                    DCC_PROGRESS_EVENT,
                    DccProgress {
                        id: transfer_id.clone(),
                        received,
                        total,
                    },
                );
            }
        },
    )
    .await;

    let path = result.map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Removes a transfer's cancel channel from the registry when its download ends,
/// whichever way it ends — success, failure, or an early return — so the map
/// does not accumulate senders for transfers that are long gone.
struct TransferGuard(String);

impl Drop for TransferGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = transfers().lock() {
            map.remove(&self.0);
        }
    }
}

/// Cancels a download in flight by its transfer id.
///
/// Trips the cancel signal the transfer is waiting on, which unwinds it with a
/// cancelled error and removes its half-written file. Unknown ids — a transfer
/// that already finished, or a click that raced its start — are a no-op.
#[tauri::command]
pub fn dcc_cancel_download(transfer_id: String) {
    if let Ok(map) = transfers().lock() {
        if let Some(handle) = map.get(&transfer_id) {
            handle.cancel();
        }
    }
}

/// Opens the platform's file manager on a downloaded file, selecting it where
/// the platform can, and otherwise opening the folder that holds it.
///
/// Desktop only, and not registered on Android: there is no file manager there
/// that will open an app's own storage, and the front end hides the button when
/// the shell offers no way to do it rather than drawing one that fails.
///
/// Returns a plain-English reason on failure, which the front end shows as a
/// toast. Refuses a path that does not exist, so a stale row cannot ask the
/// shell to open something that is no longer there.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn dcc_reveal_file(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("That file is no longer where it was saved.".to_owned());
    }
    reveal(&target).map_err(|error| format!("Could not open the folder: {error}"))
}

/// Reveals a file in the platform's file manager.
///
///
/// Each platform has its own way to open a manager with the file selected;
/// where none is reliable — desktop Linux, where the manager is not known
/// ahead of time — it falls back through the freedesktop D-Bus interface to
/// simply opening the containing folder.
#[cfg(not(target_os = "android"))]
fn reveal(target: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg("-R").arg(target).status()?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer /select,<path>` opens the folder with the file highlighted.
        // Its exit status is not a reliable success signal, so it is ignored.
        let mut argument = std::ffi::OsString::from("/select,");
        argument.push(target);
        let _ = Command::new("explorer").arg(argument).status();
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // The freedesktop file-manager interface selects the item in whichever
        // manager is running (Nautilus, Dolphin, Nemo, …). It is best-effort:
        // if it is not present, fall back to opening the containing folder.
        let uri = format!("file://{}", target.to_string_lossy());
        let selected = Command::new("dbus-send")
            .args([
                "--session",
                "--print-reply",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
            ])
            .arg(format!("array:string:{uri}"))
            .arg("string:")
            .status();
        if matches!(selected, Ok(status) if status.success()) {
            return Ok(());
        }

        let folder = target.parent().unwrap_or(target);
        Command::new("xdg-open").arg(folder).status()?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

/// Where downloaded files go when the platform picks the folder rather than the
/// user.
///
/// Android has no folder picker worth offering: an app may write inside its own
/// storage without a permission, and everywhere else costs a grant that lets it
/// read the whole device — which is a great deal to ask in order to save a file
/// somebody was sent. So the shell answers with a folder it is allowed to write
/// to and the settings screen shows the path rather than a Choose button.
///
/// `download_dir` first, because on Android that is the app's own Downloads
/// folder and is the closest thing to where a person would look for a file they
/// downloaded. The app data directory is the fallback for a platform that has
/// no such notion; both are inside the app's own storage, and uninstalling the
/// app takes them with it, which is the platform's rule and not ours.
#[tauri::command]
pub fn dcc_default_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let path = app.path();
    let dir = path
        .download_dir()
        .or_else(|_| path.app_data_dir().map(|data| data.join("downloads")))
        .map_err(|error| format!("Could not find where to save files: {error}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the download folder: {error}"))?;
    Ok(dir.to_string_lossy().into_owned())
}
