//! Plaintext log files on disk.
//!
//! The same division of labour the rest of the app follows: Rust owns the file
//! handle and nothing else. It does not know what a channel is, what a log line
//! looks like, which file a message belongs in, or when something is old enough
//! to delete — all of that is in `packages/client/src/logging`, in TypeScript,
//! where it is tested without a disk. What is here is open, append, read, list,
//! write, and delete.
//!
//! Showing the folder is deliberately not here. It is the one file operation
//! that is not the same job on both platforms: a desktop hands the path to a
//! file manager, and Android has none that will open an app's own storage, so
//! that shell registers no such command and the settings screen draws no
//! button. See `apps/desktop/src-tauri/src/opener.rs`.
//!
//! Every path is resolved inside the log folder the caller was given by
//! `log_default_dir`, or inside a folder the user chose themselves. A path that
//! climbs out of it is refused: the front end builds these from channel names,
//! and a channel is allowed to be called `../../../etc/passwd`.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// A file in the log folder, as the settings screen lists it.
#[derive(Serialize)]
pub struct LogFile {
    /// Path relative to the log folder, using forward slashes on every platform.
    pub name: String,
    pub bytes: u64,
    /// Last modified, as milliseconds since the epoch.
    pub modified_ms: f64,
}

/// The default folder for logs: `<app data>/logs`.
///
/// Returned rather than assumed by the front end, because the app data
/// directory differs on every platform and only the shell knows it.
#[tauri::command]
pub fn log_default_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not find where to keep logs: {error}"))?
        .join("logs");
    Ok(dir.to_string_lossy().into_owned())
}

/// Appends text to a file inside `root`, creating the file and its folders.
#[tauri::command]
pub fn log_append(root: String, name: String, text: String) -> Result<(), String> {
    let path = resolve(&root, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| describe("create the log folder", &error))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| describe("open the log file", &error))?;
    file.write_all(text.as_bytes())
        .map_err(|error| describe("write to the log file", &error))
}

/// Reads a file inside `root`. A file that is not there reads as empty.
///
/// Empty rather than an error because the caller is usually searching, and a
/// conversation with no log yet is an ordinary answer rather than a failure.
#[tauri::command]
pub fn log_read(root: String, name: String) -> Result<String, String> {
    let path = resolve(&root, &name)?;
    let mut file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(describe("read the log file", &error)),
    };
    // Logs are text, but a file somebody has edited or a disk that has gone bad
    // can hold bytes that are not. Lossy rather than an error: showing a line
    // with a replacement character in it beats refusing to show the file.
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| describe("read the log file", &error))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Every log file under `root`, recursively.
#[tauri::command]
pub fn log_list(root: String) -> Result<Vec<LogFile>, String> {
    let base = PathBuf::from(&root);
    let mut found = Vec::new();
    if !base.exists() {
        return Ok(found);
    }
    collect(&base, &base, &mut found)?;
    found.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(found)
}

/// Replaces a file's contents. Used to rewrite a file with old lines dropped.
#[tauri::command]
pub fn log_write(root: String, name: String, text: String) -> Result<(), String> {
    let path = resolve(&root, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| describe("create the log folder", &error))?;
    }
    fs::write(&path, text.as_bytes()).map_err(|error| describe("write the log file", &error))
}

/// Deletes a file. A file that is not there is already in the wanted state.
#[tauri::command]
pub fn log_delete(root: String, name: String) -> Result<(), String> {
    let path = resolve(&root, &name)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(describe("delete the log file", &error)),
    }
}

/// Walks a folder, recording every file relative to the log root.
fn collect(base: &Path, dir: &Path, found: &mut Vec<LogFile>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| describe("read the log folder", &error))?;
    for entry in entries {
        let entry = entry.map_err(|error| describe("read the log folder", &error))?;
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(meta) => meta,
            // A file that vanished between listing and asking about it is not
            // an error worth failing the whole listing over.
            Err(_) => continue,
        };
        if meta.is_dir() {
            collect(base, &path, found)?;
            continue;
        }
        let Ok(relative) = path.strip_prefix(base) else {
            continue;
        };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0.0, |since| since.as_millis() as f64);
        found.push(LogFile {
            // Forward slashes everywhere, so the front end's paths mean the
            // same thing on Windows as they do on Linux.
            name: relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/"),
            bytes: meta.len(),
            modified_ms,
        });
    }
    Ok(())
}

/// Joins a relative name onto the log root, refusing anything that escapes it.
///
/// The front end builds these names from channel names, and a channel may be
/// called anything the network allows — including `..`. Rejecting rather than
/// sanitising, because a name that needed sanitising is a bug upstream and
/// quietly rewriting it would hide that.
fn resolve(root: &str, name: &str) -> Result<PathBuf, String> {
    if root.is_empty() {
        return Err("No log folder is set.".to_owned());
    }
    let relative = Path::new(name);
    if relative.components().any(|part| {
        matches!(
            part,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("That is not a name inside the log folder.".to_owned());
    }
    Ok(Path::new(root).join(relative))
}

/// An error a person can act on, rather than an io::Error's own words.
fn describe(action: &str, error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => {
            format!("Marmotter is not allowed to {action}. Check the folder's permissions.")
        }
        std::io::ErrorKind::StorageFull => {
            format!("There is no room left on the disk to {action}.")
        }
        _ => format!("Could not {action}: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{log_append, log_delete, log_list, log_read, log_write, resolve};

    /// A scratch folder that cleans up after itself.
    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("marmotter-logstore-{name}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("scratch folder");
            Self(path)
        }
        fn root(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn appends_and_reads_back() {
        let scratch = Scratch::new("append");
        log_append(scratch.root(), "Libera/#a.log".into(), "one\n".into()).expect("append");
        log_append(scratch.root(), "Libera/#a.log".into(), "two\n".into()).expect("append");

        assert_eq!(
            log_read(scratch.root(), "Libera/#a.log".into()).expect("read"),
            "one\ntwo\n"
        );
    }

    #[test]
    fn a_conversation_with_no_log_yet_reads_as_empty() {
        let scratch = Scratch::new("missing");
        assert_eq!(
            log_read(scratch.root(), "Libera/#nothing.log".into()).expect("read"),
            ""
        );
    }

    #[test]
    fn lists_every_file_with_a_path_that_means_the_same_everywhere() {
        let scratch = Scratch::new("list");
        log_append(scratch.root(), "Libera/#a.log".into(), "x\n".into()).expect("append");
        log_append(scratch.root(), "OFTC/#b.log".into(), "yy\n".into()).expect("append");

        let files = log_list(scratch.root()).expect("list");
        let names: Vec<_> = files.iter().map(|file| file.name.as_str()).collect();
        assert_eq!(names, vec!["Libera/#a.log", "OFTC/#b.log"]);
        assert_eq!(files[1].bytes, 3);
    }

    #[test]
    fn listing_a_folder_that_is_not_there_is_empty_rather_than_an_error() {
        let scratch = Scratch::new("absent");
        let root = format!("{}/never-created", scratch.root());
        assert!(log_list(root).expect("list").is_empty());
    }

    #[test]
    fn rewrites_and_deletes() {
        let scratch = Scratch::new("rewrite");
        log_append(scratch.root(), "Libera/#a.log".into(), "old\n".into()).expect("append");
        log_write(scratch.root(), "Libera/#a.log".into(), "new\n".into()).expect("write");
        assert_eq!(
            log_read(scratch.root(), "Libera/#a.log".into()).expect("read"),
            "new\n"
        );

        log_delete(scratch.root(), "Libera/#a.log".into()).expect("delete");
        assert_eq!(
            log_read(scratch.root(), "Libera/#a.log".into()).expect("read"),
            ""
        );
        // Deleting again is the wanted state already, not a failure.
        log_delete(scratch.root(), "Libera/#a.log".into()).expect("delete again");
    }

    #[test]
    fn refuses_a_name_that_climbs_out_of_the_log_folder() {
        // A channel may be called almost anything, `..` included. The front end
        // makes names safe; this is what makes that a belt as well as braces.
        assert!(resolve("/logs", "../../etc/passwd").is_err());
        assert!(resolve("/logs", "Libera/../../../etc/passwd").is_err());
        assert!(resolve("/logs", "/etc/passwd").is_err());
        assert!(resolve("/logs", "Libera/#a.log").is_ok());
    }

    #[test]
    fn refuses_to_write_with_no_log_folder_set() {
        assert!(resolve("", "Libera/#a.log").is_err());
    }
}
