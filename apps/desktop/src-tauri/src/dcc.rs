//! The Tauri command behind the DCC file monitor's Download button.
//!
//! Thin, like the transport commands beside it: it converts the shape the front
//! end sends into the crate's [`DccDownloadOptions`] and returns the path the
//! file was written to. All the socket and filesystem work — sanitising the
//! name, refusing to overwrite, stopping at the advertised size — lives in
//! `marmotter-transport`, which is where it can be tested without a webview.

use std::path::PathBuf;

use marmotter_transport::{dcc_download, DccDownloadOptions, DEFAULT_DCC_TIMEOUT};
use serde::Deserialize;

/// What `dcc_download` accepts, mirroring `DccDownloadRequest` in the UI.
#[derive(Debug, Deserialize)]
pub struct DccDownloadRequest {
    pub host: String,
    pub port: u16,
    pub size: Option<u64>,
    pub filename: String,
    pub folder: String,
}

/// Downloads one advertised file into the chosen folder.
///
/// Returns the path it was written to, or a plain-English reason it could not
/// be, which the front end shows against the file.
#[tauri::command]
pub async fn dcc_download_file(request: DccDownloadRequest) -> Result<String, String> {
    let path = dcc_download(DccDownloadOptions {
        host: request.host,
        port: request.port,
        size: request.size,
        filename: request.filename,
        folder: PathBuf::from(request.folder),
        timeout: DEFAULT_DCC_TIMEOUT,
    })
    .await
    .map_err(|error| error.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}
