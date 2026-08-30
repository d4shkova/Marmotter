//! Reading and writing one text file the user pointed at.
//!
//! For the settings export and import, and only for those. Everything else the
//! shell writes lives inside a folder it owns — the log store's commands refuse
//! a path that climbs out of the log folder, which is exactly right for a name
//! built from a channel and exactly wrong for a file somebody has just chosen
//! in a save dialog.
//!
//! So these take an absolute path and do not second-guess it. What makes that
//! safe is where the path comes from: the front end only ever passes one the
//! platform's own file dialog returned, which is the user saying "this file" in
//! the way the platform means it. They are registered on desktop alone for the
//! same reason — Android has no such dialog, and there the settings move by
//! copying the text rather than by naming a file.
//!
//! Nothing here knows what is in the file. The document is built and checked in
//! TypeScript, where it can be tested without a webview.

use std::fs;
use std::path::PathBuf;

/// How large a file this will read.
///
/// A settings export is a few kilobytes; a megabyte is generous by three orders
/// of magnitude. The cap is here so that picking the wrong file — a disk image,
/// a video — fails with a sentence rather than by reading it all into memory
/// and handing it to a JSON parser.
const MAX_BYTES: u64 = 1024 * 1024;

/// The contents of a file the user chose, as text.
///
/// Returns a plain-English reason on failure, which the front end shows in the
/// import screen: a file that is not there, one that cannot be read, one too
/// large to be a settings file, and one that is not text at all.
#[tauri::command]
pub fn text_file_read(path: String) -> Result<String, String> {
    let target = PathBuf::from(&path);
    let size = fs::metadata(&target)
        .map_err(|error| format!("Could not open that file: {error}"))?
        .len();
    if size > MAX_BYTES {
        return Err("That file is too large to be a Marmotter settings file.".to_owned());
    }
    let bytes = fs::read(&target).map_err(|error| format!("Could not read that file: {error}"))?;
    String::from_utf8(bytes).map_err(|_| "That file is not text.".to_owned())
}

/// Writes text to the file the user chose, replacing whatever was there.
///
/// The dialog has already asked about replacing an existing file, so this does
/// not ask again.
#[tauri::command]
pub fn text_file_write(path: String, text: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create that folder: {error}"))?;
    }
    fs::write(&target, text.as_bytes())
        .map_err(|error| format!("Could not write that file: {error}"))
}
