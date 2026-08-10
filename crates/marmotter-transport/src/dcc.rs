//! DCC file download: open a direct socket to an advertised peer and stream one
//! file to disk.
//!
//! This is the receive half of DCC, and only that. It opens a plain TCP
//! connection to the address the sender advertised — DCC never runs over the
//! IRC server — reads the file, and writes it into the folder the user chose. It
//! parses nothing: the offer was decoded in `packages/protocol`, and this is
//! handed the host, port and size it already worked out.
//!
//! The name in an offer is chosen by a stranger, so it is treated as hostile.
//! Any directory part is stripped, the reserved characters are removed, and an
//! existing file is never overwritten — the transfer lands beside it under a
//! numbered name instead. The one thing this refuses outright is a passive
//! (reverse) offer, where the sender expects *us* to listen: a receive-only
//! downloader does not open a listening socket.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::watch;

use crate::error::{Result, TransportError};

/// A cancellation signal a caller can trip to abort a download in flight.
///
/// It is the receiving half of a [`watch`] channel carrying a single flag: the
/// caller keeps the [`CancelHandle`] and trips it to cancel, which unblocks the
/// connect or the next read and unwinds the transfer with
/// [`TransportError::Cancelled`], cleaning up the partial file on the way out.
/// A channel whose handle has been dropped simply never cancels.
pub type CancelSignal = watch::Receiver<bool>;

/// The sending half of a cancellation: hold it, then [`cancel`] the transfer.
///
/// Paired with a [`CancelSignal`] by [`cancel_channel`]. It wraps the watch
/// sender so a caller — the desktop shell's transfer registry, in practice —
/// can carry it without depending on the channel type directly.
///
/// [`cancel`]: CancelHandle::cancel
#[derive(Clone)]
pub struct CancelHandle(watch::Sender<bool>);

impl CancelHandle {
    /// Trips the signal, cancelling the transfer it was paired with. Cancelling
    /// one that has already finished is harmless — the signal is simply unheard.
    pub fn cancel(&self) {
        let _ = self.0.send(true);
    }
}

/// Creates a linked cancel handle and signal.
///
/// The handle goes to whatever wants to be able to stop the transfer; the signal
/// goes into [`DownloadOptions::cancel`]. Keeps the watch channel an internal
/// detail of this crate, so callers need no async runtime dependency of their
/// own to make a download cancellable.
#[must_use]
pub fn cancel_channel() -> (CancelHandle, CancelSignal) {
    let (sender, receiver) = watch::channel(false);
    (CancelHandle(sender), receiver)
}

/// Resolves once the signal has been tripped, or never when there is none.
///
/// Used as the other arm of a `select!` against a connect or a read, so a
/// cancellation is noticed the moment it arrives rather than only between
/// chunks. Marks each observed value as seen so the next `changed()` waits for
/// the following one; a dropped sender parks forever, since a gone caller is
/// not a cancellation.
async fn cancelled(signal: &mut Option<CancelSignal>) {
    match signal {
        Some(receiver) => loop {
            if *receiver.borrow_and_update() {
                return;
            }
            if receiver.changed().await.is_err() {
                std::future::pending::<()>().await;
            }
        },
        None => std::future::pending::<()>().await,
    }
}

/// Time allowed to wait on any single read once connected.
pub const DEFAULT_DCC_TIMEOUT: Duration = Duration::from_secs(60);

/// Time allowed to establish the connection to the advertised address.
///
/// Kept well short of the read timeout: a serving bot re-offers a pack within a
/// few seconds if the receiver has not connected, so a connection that is going
/// to succeed does so quickly. A long wait here just leaves the row spinning on
/// an address that is, in practice, unreachable — a filtered port, a blocked
/// route, or a bot that only accepts the transfer from the IRC session's own IP.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// The ceiling used when the sender advertised no size, to bound disk use.
///
/// A transfer with a known size stops exactly at it; one without could run
/// forever, so it is cut off here rather than allowed to fill the disk.
pub const MAX_UNKNOWN_SIZE: u64 = 4 * 1024 * 1024 * 1024;

const READ_CHUNK: usize = 64 * 1024;

/// Everything needed to fetch one advertised file.
#[derive(Debug, Clone)]
pub struct DownloadOptions {
    /// The advertised host, as a dotted IPv4 or an IPv6 literal.
    pub host: String,
    /// The advertised TCP port. Zero means a passive offer, which is refused.
    pub port: u16,
    /// The advertised size in bytes, where the sender gave one.
    pub size: Option<u64>,
    /// The advertised name. Sanitised again here before anything is written.
    pub filename: String,
    /// The folder chosen in settings.
    pub folder: PathBuf,
    /// Connect and per-read timeout.
    pub timeout: Duration,
    /// A signal the caller can trip to abort the transfer, if it wants one.
    pub cancel: Option<CancelSignal>,
}

/// How often progress is reported: once per this many bytes, plus a first and
/// last call. A 64 KiB read on a multi-gigabyte file would otherwise fire tens
/// of thousands of updates for a bar that moves a pixel each time.
const PROGRESS_STEP: u64 = 1024 * 1024;

/// Downloads the file, returning the path it was written to.
///
/// `on_progress` is called with the bytes received so far and the total where it
/// is known — once at the start, roughly once per megabyte, and once at the end.
///
/// # Errors
///
/// Returns [`TransportError`] for a passive offer, a folder that is not usable,
/// a connection that fails or stalls, a transfer that ends before the whole
/// advertised size has arrived, or [`TransportError::Cancelled`] when the
/// caller trips the [`CancelSignal`] mid-transfer.
pub async fn download(
    mut options: DownloadOptions,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<PathBuf> {
    if options.port == 0 {
        return Err(TransportError::Network(
            "this is a passive transfer, which Marmotter can't fetch".to_owned(),
        ));
    }

    if !options.folder.is_dir() {
        return Err(TransportError::Network(
            "the download folder does not exist".to_owned(),
        ));
    }

    let target = unique_target_path(&options.folder, &options.filename);

    // The cancel signal is consumed here so it can be shared by the connect and
    // the read loop, which run one after the other on the same transfer.
    let mut cancel = options.cancel.take();

    let address = format!("{}:{}", options.host, options.port);
    let stream = tokio::select! {
        biased;
        // A cancel while the connect is still pending unwinds before any file
        // is created, so there is nothing to clean up here.
        () = cancelled(&mut cancel) => return Err(TransportError::Cancelled),
        connected = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(&address)) => connected
            .map_err(|_| {
                TransportError::Network(format!(
                    "could not connect to {address} within {}s — the address may be unreachable or the port blocked",
                    CONNECT_TIMEOUT.as_secs()
                ))
            })?
            .map_err(|error| TransportError::Network(format!("could not connect to {address}: {error}")))?,
    };

    match stream_to_file(
        stream,
        &target,
        options.size,
        options.timeout,
        &mut cancel,
        &mut on_progress,
    )
    .await
    {
        Ok(()) => Ok(target),
        Err(error) => {
            // A half-written file is worse than none: it looks complete in the
            // folder. Best-effort removal, since the error being returned is the
            // one that matters.
            let _ = tokio::fs::remove_file(&target).await;
            Err(error)
        }
    }
}

/// Reads the socket into the file, acknowledging bytes as DCC expects.
async fn stream_to_file(
    mut stream: TcpStream,
    target: &Path,
    size: Option<u64>,
    timeout: Duration,
    cancel: &mut Option<CancelSignal>,
    on_progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<()> {
    let mut file = File::create(target)
        .await
        .map_err(|error| TransportError::Network(error.to_string()))?;

    let cap = size.unwrap_or(MAX_UNKNOWN_SIZE);
    let mut received: u64 = 0;
    let mut reported: u64 = 0;
    let mut buffer = vec![0_u8; READ_CHUNK];

    on_progress(0, size);

    while received < cap {
        let read = tokio::select! {
            biased;
            // Cancelling mid-transfer returns here; the caller then removes the
            // partial file, so a stopped download never looks like a whole one.
            () = cancelled(cancel) => return Err(TransportError::Cancelled),
            chunk = tokio::time::timeout(timeout, stream.read(&mut buffer)) => chunk
                .map_err(|_| TransportError::Timeout)?
                .map_err(|error| TransportError::Network(error.to_string()))?,
        };

        if read == 0 {
            break; // The peer closed the connection.
        }

        // Never write past a known size, even if the sender over-sends.
        let remaining = cap - received;
        let take = (read as u64).min(remaining) as usize;

        file.write_all(&buffer[..take])
            .await
            .map_err(|error| TransportError::Network(error.to_string()))?;
        received += take as u64;

        // The classic DCC acknowledgement: the total received so far, as a
        // four-byte big-endian value. Some senders ignore it and some wait for
        // it, so it is sent best-effort — a sender that has closed its read side
        // must not fail an otherwise complete transfer.
        let ack = (received as u32).to_be_bytes();
        let _ = stream.write_all(&ack).await;

        if received - reported >= PROGRESS_STEP {
            reported = received;
            on_progress(received, size);
        }

        if take < read {
            break; // More arrived than was promised; stop at the promised size.
        }
    }

    file.flush()
        .await
        .map_err(|error| TransportError::Network(error.to_string()))?;

    if let Some(expected) = size {
        if received < expected {
            return Err(TransportError::Network(
                "the connection closed before the whole file arrived".to_owned(),
            ));
        }
    }

    on_progress(received, size);
    Ok(())
}

/// A safe name derived from the advertised one: last path component only, with
/// control characters and reserved punctuation removed.
///
/// Mirrors `sanitizeDccFilename` in `packages/protocol`, so the two agree on
/// what a name reduces to. This is the check that actually guards the
/// filesystem; the TypeScript one is the first line, not the only one.
#[must_use]
pub fn sanitize_filename(name: &str) -> String {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .chars()
        .filter(|character| {
            !character.is_control() && !matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
        .collect::<String>();
    let trimmed = base.trim();

    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "download".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// A path inside the folder that no existing file holds, so a download never
/// overwrites. A clash gets " (2)", " (3)", and so on before the extension.
fn unique_target_path(folder: &Path, filename: &str) -> PathBuf {
    let safe = sanitize_filename(filename);
    let candidate = folder.join(&safe);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(&safe);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&safe);
    let extension = path.extension().and_then(|value| value.to_str());

    for counter in 2..10_000 {
        let name = match extension {
            Some(ext) => format!("{stem} ({counter}).{ext}"),
            None => format!("{stem} ({counter})"),
        };
        let candidate = folder.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }

    // Astronomically unlikely; fall back to the sanitised name and let the
    // create overwrite rather than loop forever.
    folder.join(safe)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    async fn serve(bytes: Vec<u8>) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let _ = socket.write_all(&bytes).await;
                let _ = socket.flush().await;
                // Read and discard acks so the client's writes never block.
                let mut scratch = [0_u8; 64];
                while let Ok(read) = socket.read(&mut scratch).await {
                    if read == 0 {
                        break;
                    }
                }
            }
        });
        port
    }

    #[tokio::test]
    async fn downloads_a_file_of_known_size() {
        let folder = tempfile::tempdir().unwrap();
        let payload = b"marmot photographs".to_vec();
        let port = serve(payload.clone()).await;

        let path = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(payload.len() as u64),
                filename: "photos.dat".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), payload);
        assert_eq!(path.file_name().unwrap(), "photos.dat");
    }

    #[tokio::test]
    async fn reports_progress_ending_at_the_full_size() {
        let folder = tempfile::tempdir().unwrap();
        let payload = b"marmot photographs".to_vec();
        let port = serve(payload.clone()).await;

        let mut updates: Vec<(u64, Option<u64>)> = Vec::new();
        download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(payload.len() as u64),
                filename: "photos.dat".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                timeout: Duration::from_secs(5),
            },
            |received, total| updates.push((received, total)),
        )
        .await
        .unwrap();

        assert_eq!(updates.first(), Some(&(0, Some(payload.len() as u64))));
        assert_eq!(
            updates.last(),
            Some(&(payload.len() as u64, Some(payload.len() as u64)))
        );
    }

    #[tokio::test]
    async fn stops_at_the_advertised_size_when_the_sender_over_sends() {
        let folder = tempfile::tempdir().unwrap();
        let port = serve(b"exactlytenXXXXX".to_vec()).await;

        let path = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(10),
                filename: "clip.bin".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"exactlyten");
    }

    #[tokio::test]
    async fn fails_when_the_file_arrives_short() {
        let folder = tempfile::tempdir().unwrap();
        let port = serve(b"tooshort".to_vec()).await;

        let result = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(1_000),
                filename: "big.bin".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await;

        assert!(result.is_err());
        // The partial file is cleaned up rather than left looking complete.
        assert!(!folder.path().join("big.bin").exists());
    }

    #[tokio::test]
    async fn refuses_a_passive_offer() {
        let folder = tempfile::tempdir().unwrap();
        let result = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port: 0,
                size: Some(1),
                filename: "x".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                timeout: Duration::from_secs(1),
            },
            |_, _| {},
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn never_overwrites_an_existing_file() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("dup.txt"), b"old").unwrap();
        let port = serve(b"new".to_vec()).await;

        let path = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(3),
                filename: "dup.txt".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await
        .unwrap();

        assert_eq!(path.file_name().unwrap(), "dup (2).txt");
        assert_eq!(
            std::fs::read(folder.path().join("dup.txt")).unwrap(),
            b"old"
        );
    }

    #[test]
    fn sanitize_strips_directories_and_reserved_characters() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("a:b*c.txt"), "abc.txt");
        assert_eq!(sanitize_filename(".."), "download");
        assert_eq!(sanitize_filename(""), "download");
    }

    #[tokio::test]
    async fn keeps_the_download_inside_the_chosen_folder() {
        let folder = tempfile::tempdir().unwrap();
        let port = serve(b"data".to_vec()).await;

        let path = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(4),
                filename: "../escape.txt".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await
        .unwrap();

        assert_eq!(path.parent().unwrap(), folder.path());
        assert_eq!(path.file_name().unwrap(), "escape.txt");
    }

    #[tokio::test]
    async fn a_cancel_stops_the_transfer_and_removes_the_partial_file() {
        let folder = tempfile::tempdir().unwrap();

        // A server that accepts the connection and then holds it open without
        // sending the rest, so the client blocks on the read until cancelled.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((socket, _)) = listener.accept().await {
                let _held = socket;
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });

        let (handle, signal) = cancel_channel();
        // Trip the cancel a moment after the transfer is under way.
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            handle.cancel();
        });

        let result = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(1_000_000),
                filename: "big.bin".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: Some(signal),
                timeout: Duration::from_secs(30),
            },
            |_, _| {},
        )
        .await;

        assert_eq!(result.unwrap_err(), TransportError::Cancelled);
        // The partial file is cleaned up, exactly as a failed transfer is.
        assert!(!folder.path().join("big.bin").exists());
    }
}
