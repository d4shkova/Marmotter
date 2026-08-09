//! The Tauri command behind the DCC file monitor's Download button.
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

use std::path::{Path, PathBuf};
use std::process::Command;

use marmotter_transport::{dcc_download, DccDownloadOptions, DEFAULT_DCC_TIMEOUT};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Event emitted as a download proceeds. Payload is [`DccProgress`].
pub const DCC_PROGRESS_EVENT: &str = "marmotter://dcc-progress";

/// What `dcc_download_file` accepts, mirroring `DccDownloadRequest` in the UI.
#[derive(Debug, Deserialize)]
pub struct DccDownloadRequest {
    pub host: String,
    pub port: u16,
    pub size: Option<u64>,
    pub filename: String,
    pub folder: String,
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

    let path = dcc_download(
        DccDownloadOptions {
            host: request.host,
            port: request.port,
            size: request.size,
            filename: request.filename,
            folder: PathBuf::from(request.folder),
            timeout: DEFAULT_DCC_TIMEOUT,
        },
        move |received, total| {
            // Best-effort: a dropped progress event only costs a bar that jumps,
            // never the transfer itself.
            let _ = emitter.emit(
                DCC_PROGRESS_EVENT,
                DccProgress {
                    id: transfer_id.clone(),
                    received,
                    total,
                },
            );
        },
    )
    .await
    .map_err(|error| error.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}

/// Opens the platform's file manager on a downloaded file, selecting it where
/// the platform can, and otherwise opening the folder that holds it.
///
/// Returns a plain-English reason on failure, which the front end shows as a
/// toast. Refuses a path that does not exist, so a stale row cannot ask the
/// shell to open something that is no longer there.
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
/// Each platform has its own way to open a manager with the file selected;
/// where none is reliable — desktop Linux, where the manager is not known
/// ahead of time — it falls back through the freedesktop D-Bus interface to
/// simply opening the containing folder.
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
