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
use std::sync::Arc;
use std::time::Duration;

use tokio::fs::File;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio_rustls::TlsConnector;

use crate::error::{Result, TransportError};
use crate::tls::{client_config, Verification};

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
    /// Whether the socket is TLS, from an `SSEND` offer.
    ///
    /// The certificate is not verified, and cannot usefully be: the peer is an
    /// address rather than a name, the certificate is invariably self-signed,
    /// and there is no authority that would vouch for it. What the handshake
    /// buys is that the file is not readable in transit — which is the whole of
    /// what the sender is offering, and is why a receiver that dials such an
    /// offer in the clear simply hangs until the sender gives up.
    pub secure: bool,
    /// Whether the sender is in "turbo" mode, from a `TSEND` offer.
    ///
    /// A turbo sender streams without waiting to be acknowledged, and does not
    /// read its socket. Sending the acknowledgements anyway fills its receive
    /// window, blocks our write, and stalls a transfer that was working, so
    /// they are omitted for these.
    pub turbo: bool,
    /// Where to continue from, when the sender agreed to resume.
    ///
    /// Only ever a position the sender acknowledged in a `DCC ACCEPT`: it is
    /// the offset the sender starts sending from, so a position we merely
    /// assumed would splice two different parts of a file together and produce
    /// something that looks complete and is not.
    pub resume_from: Option<u64>,
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

    let target = plan_target(&options.folder, &options.filename);

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

    // A secure offer is a TLS socket. The handshake is bounded by the same
    // connect timeout: a sender that opened a plain socket and called it SSEND
    // would otherwise leave us waiting on a `ServerHello` that is never coming.
    let result = if options.secure {
        let connector = TlsConnector::from(Arc::new(client_config(&Verification::None, None)?));
        let server_name = server_name_for(&options.host)?;
        let tls = tokio::select! {
            biased;
            () = cancelled(&mut cancel) => return Err(TransportError::Cancelled),
            shaken = tokio::time::timeout(CONNECT_TIMEOUT, connector.connect(server_name, stream)) => shaken
                .map_err(|_| TransportError::Network(format!(
                    "the encrypted transfer from {address} did not start within {}s",
                    CONNECT_TIMEOUT.as_secs()
                )))?
                .map_err(|error| TransportError::Tls(error.to_string()))?,
        };
        stream_to_file(
            tls,
            &target.partial_path,
            Terms {
                size: options.size,
                timeout: options.timeout,
                turbo: options.turbo,
                resume_from: options.resume_from,
            },
            &mut cancel,
            &mut on_progress,
        )
        .await
    } else {
        stream_to_file(
            stream,
            &target.partial_path,
            Terms {
                size: options.size,
                timeout: options.timeout,
                turbo: options.turbo,
                resume_from: options.resume_from,
            },
            &mut cancel,
            &mut on_progress,
        )
        .await
    };

    settle(result, target).await
}

/// Turns a finished transfer into a file, or a failed one into what is left.
///
/// On success the part-file becomes the real one. On a cancel the part-file is
/// removed: stopping a download is the user saying they do not want it, and
/// leaving the bytes behind to be silently continued is not what they asked
/// for. On any other failure it is kept, because that is the whole of what
/// makes the next attempt a resume rather than a fresh multi-gigabyte start.
async fn settle(result: Result<()>, target: TransferTarget) -> Result<PathBuf> {
    match result {
        Ok(()) => {
            // Between planning and finishing, something else may have taken the
            // name; the transfer is not thrown away over that.
            let final_path = if target.final_path.exists() {
                unique_target_path(
                    target.final_path.parent().unwrap_or(Path::new(".")),
                    target
                        .final_path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("download"),
                )
            } else {
                target.final_path
            };
            tokio::fs::rename(&target.partial_path, &final_path)
                .await
                .map_err(|error| {
                    TransportError::Network(format!("could not save the file: {error}"))
                })?;
            Ok(final_path)
        }
        Err(TransportError::Cancelled) => {
            let _ = tokio::fs::remove_file(&target.partial_path).await;
            Err(TransportError::Cancelled)
        }
        Err(error) => Err(error),
    }
}

/// How long a passive transfer's listening socket waits to be connected to.
///
/// A reverse offer is answered the moment the sender reads our reply, so a
/// sender that is coming connects within seconds. The wait is nonetheless
/// generous, because it is bounded by something real — the socket is closed
/// when it elapses — and a sender queueing behind its own transfers is the
/// ordinary case rather than a fault.
pub const LISTEN_TIMEOUT: Duration = Duration::from_secs(120);

/// Everything needed to receive one passive (reverse) transfer.
///
/// The shape differs from [`DownloadOptions`] in the one way that matters: no
/// port to dial. The sender is firewalled — that is what a passive offer says —
/// so we open the socket and it connects to us, which means the port is an
/// output of starting the transfer rather than an input to it, and has to reach
/// the caller in time to be put in the reply.
#[derive(Debug, Clone)]
pub struct PassiveOptions {
    /// The sender's advertised address, used to check who connected.
    pub peer_host: String,
    /// The advertised size in bytes, where the sender gave one.
    pub size: Option<u64>,
    /// The advertised name. Sanitised again here before anything is written.
    pub filename: String,
    /// The folder chosen in settings.
    pub folder: PathBuf,
    /// Whether the sender streams without waiting to be acknowledged.
    pub turbo: bool,
    /// Where to continue from, when the sender agreed to resume.
    ///
    /// Only ever a position the sender acknowledged in a `DCC ACCEPT`: it is
    /// the offset the sender starts sending from, so a position we merely
    /// assumed would splice two different parts of a file together and produce
    /// something that looks complete and is not.
    pub resume_from: Option<u64>,
    /// Per-read timeout once the sender has connected.
    pub timeout: Duration,
    /// A signal the caller can trip to abort the transfer, if it wants one.
    pub cancel: Option<CancelSignal>,
}

/// Receives a passive (reverse) transfer: we listen, the sender connects.
///
/// `on_listening` is called once with the port that was bound, and the caller
/// must send the sender its half of the handshake with that port in it —
/// nothing will connect until it does. The listening socket is closed as soon
/// as one connection has been accepted, or when the wait elapses.
///
/// Only a connection from the sender's own address is taken. The port is
/// advertised in a channel or a private message that anyone may be reading, and
/// the alternative is that the first stranger to dial it decides what lands in
/// the download folder.
///
/// # Errors
///
/// Returns [`TransportError`] when the socket cannot be bound, when nothing
/// connects within [`LISTEN_TIMEOUT`], or for any of the reasons an ordinary
/// download fails once the bytes are moving.
pub async fn receive_passive(
    mut options: PassiveOptions,
    on_listening: impl FnOnce(u16),
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<PathBuf> {
    if !options.folder.is_dir() {
        return Err(TransportError::Network(
            "the download folder does not exist".to_owned(),
        ));
    }

    let listener = TcpListener::bind(("0.0.0.0", 0))
        .await
        .map_err(|error| TransportError::Network(format!("could not open a socket: {error}")))?;
    let port = listener
        .local_addr()
        .map_err(|error| TransportError::Network(error.to_string()))?
        .port();

    let target = plan_target(&options.folder, &options.filename);
    let mut cancel = options.cancel.take();
    let expected: Option<std::net::IpAddr> = options.peer_host.parse().ok();

    on_listening(port);

    let stream = tokio::select! {
        biased;
        () = cancelled(&mut cancel) => return Err(TransportError::Cancelled),
        accepted = tokio::time::timeout(LISTEN_TIMEOUT, accept_from(&listener, expected)) => accepted
            .map_err(|_| {
                TransportError::Network(format!(
                    "{} did not connect within {}s",
                    options.peer_host,
                    LISTEN_TIMEOUT.as_secs()
                ))
            })??,
    };
    // Nothing else is coming, and a socket left listening is a port left open.
    drop(listener);

    let result = stream_to_file(
        stream,
        &target.partial_path,
        Terms {
            size: options.size,
            timeout: options.timeout,
            turbo: options.turbo,
            resume_from: options.resume_from,
        },
        &mut cancel,
        &mut on_progress,
    )
    .await;

    settle(result, target).await
}

/// Accepts until the sender itself connects, dropping anyone else.
///
/// A connection from another address is closed rather than treated as a
/// failure: an unrelated dial — a port scan, or a second client that saw the
/// same advertisement — must not cost the transfer we are waiting for.
async fn accept_from(
    listener: &TcpListener,
    expected: Option<std::net::IpAddr>,
) -> Result<TcpStream> {
    loop {
        let (stream, from) = listener
            .accept()
            .await
            .map_err(|error| TransportError::Network(error.to_string()))?;
        match expected {
            Some(address) if from.ip() != address => continue,
            _ => return Ok(stream),
        }
    }
}

/// The address to advertise to a peer, as seen from the route towards it.
///
/// Found by asking the operating system which interface it would use to reach
/// that address: a UDP socket is connected, which sends nothing, and its local
/// address is read back. It is the machine's own address, so behind NAT it is
/// the private one — a passive transfer needs an incoming connection, and no
/// amount of guessing here substitutes for one being possible.
#[must_use]
pub fn local_address_towards(peer: &str) -> Option<String> {
    use std::net::{IpAddr, SocketAddr, UdpSocket};

    let address: IpAddr = peer.parse().ok()?;
    let socket = UdpSocket::bind(if address.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    })
    .ok()?;
    // Port 9 is discard; nothing is transmitted by connecting a UDP socket.
    socket.connect(SocketAddr::new(address, 9)).ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

/// The name a DCC peer is dialled under, which is an address rather than a host.
///
/// The certificate is not checked against it — the verifier accepts anything —
/// but rustls still needs a name for the handshake, and an IP literal has to be
/// offered as one rather than as a hostname or the connection is refused before
/// it starts.
fn server_name_for(host: &str) -> Result<rustls_pki_types::ServerName<'static>> {
    rustls_pki_types::ServerName::try_from(host.to_owned())
        .map_err(|_| TransportError::Tls(format!("`{host}` is not a valid peer address")))
}

/// What the read loop needs to know about the transfer it is reading.
///
/// Grouped rather than passed one by one: they are four answers to the same
/// question — how these particular bytes arrive — and every caller carries all
/// four together anyway.
#[derive(Debug, Clone, Copy)]
struct Terms {
    size: Option<u64>,
    timeout: Duration,
    turbo: bool,
    resume_from: Option<u64>,
}

/// Reads the socket into the file, acknowledging bytes as DCC expects.
///
/// Generic over the stream so a plain socket and a TLS one go through exactly
/// the same loop: the only thing encryption changes is what the bytes travelled
/// inside, and having two copies of the read-and-write path is how the two
/// quietly stop behaving alike.
async fn stream_to_file<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    target: &Path,
    terms: Terms,
    cancel: &mut Option<CancelSignal>,
    on_progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<()> {
    let Terms {
        size,
        timeout,
        turbo,
        resume_from,
    } = terms;
    // Resuming opens the part-file where it was left and cuts it back to the
    // position the sender agreed to, which is the only position the bytes about
    // to arrive belong after. Anything beyond it was never acknowledged and
    // would otherwise sit in the middle of the finished file.
    let mut file = match resume_from {
        Some(position) if position > 0 => {
            let handle = tokio::fs::OpenOptions::new()
                .write(true)
                .open(target)
                .await
                .map_err(|error| TransportError::Network(error.to_string()))?;
            handle
                .set_len(position)
                .await
                .map_err(|error| TransportError::Network(error.to_string()))?;
            let mut handle = handle;
            handle
                .seek(std::io::SeekFrom::Start(position))
                .await
                .map_err(|error| TransportError::Network(error.to_string()))?;
            handle
        }
        _ => File::create(target)
            .await
            .map_err(|error| TransportError::Network(error.to_string()))?,
    };

    let cap = size.unwrap_or(MAX_UNKNOWN_SIZE);
    let mut received: u64 = resume_from.unwrap_or(0);
    let mut reported: u64 = received;
    let mut buffer = vec![0_u8; READ_CHUNK];

    on_progress(received, size);

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
        // must not fail an otherwise complete transfer. A turbo sender is the
        // one case where sending it is actively harmful: it never reads, so the
        // acknowledgements fill its window until our write blocks.
        if !turbo {
            let ack = (received as u32).to_be_bytes();
            let _ = stream.write_all(&ack).await;
        }

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

/// The suffix a transfer writes under while it is still running.
///
/// A file in the download folder should be a file that arrived. Writing to a
/// marked name and renaming at the end keeps a half-finished download out of
/// the folder proper, and — the reason it is here — leaves something for the
/// next attempt to continue from instead of starting a multi-gigabyte file
/// again because the connection dropped near the end.
pub const PARTIAL_SUFFIX: &str = ".part";

/// Where a transfer writes, and how much of it is already on disk.
#[derive(Debug, Clone)]
pub struct TransferTarget {
    /// Where the finished file goes.
    pub final_path: PathBuf,
    /// Where the bytes go while it runs.
    pub partial_path: PathBuf,
    /// Bytes already written by an earlier attempt, which may be resumed.
    pub resumable: u64,
}

/// Decides where a transfer of this name writes, and what it can continue from.
///
/// A part-file left by an earlier attempt is continued under the same name; a
/// finished file of that name is never touched, and the new transfer takes the
/// next free name. Exposed so the caller can ask what is resumable *before* the
/// transfer starts — the sender has to be asked to resume, over IRC, and by the
/// time the socket is open it is too late to ask.
#[must_use]
pub fn plan_target(folder: &Path, filename: &str) -> TransferTarget {
    let safe = sanitize_filename(filename);
    let partial = folder.join(format!("{safe}{PARTIAL_SUFFIX}"));

    if let Ok(metadata) = std::fs::metadata(&partial) {
        if metadata.is_file() {
            return TransferTarget {
                final_path: folder.join(&safe),
                partial_path: partial,
                resumable: metadata.len(),
            };
        }
    }

    let final_path = unique_target_path(folder, &safe);
    let name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&safe)
        .to_owned();
    TransferTarget {
        partial_path: folder.join(format!("{name}{PARTIAL_SUFFIX}")),
        final_path,
        resumable: 0,
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
                secure: false,
                turbo: false,
                resume_from: None,
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
                secure: false,
                turbo: false,
                resume_from: None,
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
                secure: false,
                turbo: false,
                resume_from: None,
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
                secure: false,
                turbo: false,
                resume_from: None,
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await;

        assert!(result.is_err());
        // Nothing in the folder looks like a file that arrived...
        assert!(!folder.path().join("big.bin").exists());
        // ...but what did arrive is kept under the part name, which is what the
        // next attempt resumes from rather than starting the file again.
        assert_eq!(
            std::fs::read(folder.path().join("big.bin.part")).unwrap(),
            b"tooshort"
        );
    }

    #[tokio::test]
    async fn continues_a_part_file_from_where_the_sender_agreed() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("big.bin.part"), b"first-half").unwrap();

        // What is resumable is what the caller asks the sender for, so it has to
        // be readable before the transfer starts.
        let planned = plan_target(folder.path(), "big.bin");
        assert_eq!(planned.resumable, 10);

        let port = serve(b"second-half".to_vec()).await;
        let path = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(21),
                filename: "big.bin".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                secure: false,
                turbo: false,
                resume_from: Some(10),
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await
        .unwrap();

        assert_eq!(path, folder.path().join("big.bin"));
        assert_eq!(std::fs::read(&path).unwrap(), b"first-halfsecond-half");
        assert!(!folder.path().join("big.bin.part").exists());
    }

    #[tokio::test]
    async fn cuts_a_part_file_back_to_the_position_the_sender_agreed() {
        // The sender may accept a smaller position than we offered. Anything
        // past it was never acknowledged and must not survive in the middle of
        // the finished file.
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("f.bin.part"), b"aaaaaGARBAGE").unwrap();

        let port = serve(b"bbbbb".to_vec()).await;
        let path = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(10),
                filename: "f.bin".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                secure: false,
                turbo: false,
                resume_from: Some(5),
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"aaaaabbbbb");
    }

    #[tokio::test]
    async fn a_resumed_transfer_reports_progress_from_where_it_started() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("p.bin.part"), b"12345").unwrap();
        let port = serve(b"67890".to_vec()).await;

        let mut updates: Vec<u64> = Vec::new();
        download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(10),
                filename: "p.bin".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                secure: false,
                turbo: false,
                resume_from: Some(5),
                timeout: Duration::from_secs(5),
            },
            |received, _| updates.push(received),
        )
        .await
        .unwrap();

        // A bar that restarted at zero would report a transfer going backwards.
        assert_eq!(updates.first(), Some(&5));
        assert_eq!(updates.last(), Some(&10));
    }

    #[test]
    fn a_finished_file_of_the_same_name_is_never_resumed_over() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("done.bin"), b"complete").unwrap();

        let planned = plan_target(folder.path(), "done.bin");
        assert_eq!(planned.resumable, 0);
        assert_eq!(planned.final_path, folder.path().join("done (2).bin"));
        assert_eq!(
            planned.partial_path,
            folder.path().join("done (2).bin.part")
        );
    }

    /// A sender that never reads, and reports whatever the client wrote to it.
    ///
    /// This is a turbo sender: it streams the file and does not touch its read
    /// side until the transfer is over, which is exactly the condition under
    /// which acknowledging every chunk is the thing that stalls a download.
    async fn serve_without_reading(bytes: Vec<u8>) -> (u16, tokio::sync::oneshot::Receiver<usize>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sent, received) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let _ = socket.write_all(&bytes).await;
                let _ = socket.flush().await;
                // Only now look at what came back the other way.
                let mut scratch = [0_u8; 1024];
                let read =
                    tokio::time::timeout(Duration::from_millis(250), socket.read(&mut scratch))
                        .await
                        .unwrap_or(Ok(0))
                        .unwrap_or(0);
                let _ = sent.send(read);
            }
        });
        (port, received)
    }

    #[tokio::test]
    async fn a_turbo_transfer_sends_no_acknowledgements() {
        let folder = tempfile::tempdir().unwrap();
        let payload = b"marmot photographs".to_vec();
        let (port, acknowledged) = serve_without_reading(payload.clone()).await;

        let path = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(payload.len() as u64),
                filename: "photos.dat".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                secure: false,
                turbo: true,
                resume_from: None,
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), payload);
        assert_eq!(acknowledged.await.unwrap(), 0);
    }

    #[tokio::test]
    async fn an_ordinary_transfer_acknowledges_what_it_received() {
        let folder = tempfile::tempdir().unwrap();
        let payload = b"marmot photographs".to_vec();
        let (port, acknowledged) = serve_without_reading(payload.clone()).await;

        download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(payload.len() as u64),
                filename: "photos.dat".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                secure: false,
                turbo: false,
                resume_from: None,
                timeout: Duration::from_secs(5),
            },
            |_, _| {},
        )
        .await
        .unwrap();

        // Four bytes: the running total, big-endian, as DCC has always spelt it.
        assert_eq!(acknowledged.await.unwrap(), 4);
    }

    #[tokio::test]
    async fn a_secure_offer_is_not_dialled_in_the_clear() {
        // A plain listener answering an SSEND offer: the handshake cannot
        // complete, and the transfer has to fail rather than sit there until
        // the sender's own timeout gives up on it.
        let folder = tempfile::tempdir().unwrap();
        let port = serve(b"not a ServerHello".to_vec()).await;

        let result = download(
            DownloadOptions {
                host: "127.0.0.1".to_owned(),
                port,
                size: Some(4),
                filename: "x.bin".to_owned(),
                folder: folder.path().to_path_buf(),
                cancel: None,
                secure: true,
                turbo: false,
                resume_from: None,
                timeout: Duration::from_secs(2),
            },
            |_, _| {},
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn receives_a_passive_transfer_from_the_sender() {
        let folder = tempfile::tempdir().unwrap();
        let payload = b"reverse marmot".to_vec();
        let (port_tx, port_rx) = tokio::sync::oneshot::channel();

        let receiving = tokio::spawn({
            let folder = folder.path().to_path_buf();
            let payload_len = payload.len() as u64;
            async move {
                receive_passive(
                    PassiveOptions {
                        peer_host: "127.0.0.1".to_owned(),
                        size: Some(payload_len),
                        filename: "reverse.bin".to_owned(),
                        folder,
                        turbo: false,
                        resume_from: None,
                        timeout: Duration::from_secs(5),
                        cancel: None,
                    },
                    |port| {
                        let _ = port_tx.send(port);
                    },
                    |_, _| {},
                )
                .await
            }
        });

        // The sender reads the port out of our reply and dials it.
        let port = port_rx.await.unwrap();
        let mut sender = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        sender.write_all(&payload).await.unwrap();
        sender.flush().await.unwrap();
        let mut scratch = [0_u8; 64];
        let _ = sender.read(&mut scratch).await;

        let path = receiving.await.unwrap().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), payload);
    }

    #[tokio::test]
    async fn a_passive_socket_ignores_a_dial_from_anyone_but_the_sender() {
        // The port is advertised in a message anybody may be reading, so the
        // first stranger to connect must not get to decide what is downloaded.
        let folder = tempfile::tempdir().unwrap();
        let (port_tx, port_rx) = tokio::sync::oneshot::channel();

        let receiving = tokio::spawn({
            let folder = folder.path().to_path_buf();
            async move {
                receive_passive(
                    PassiveOptions {
                        // Nothing on this machine dials from here.
                        peer_host: "203.0.113.7".to_owned(),
                        size: Some(4),
                        filename: "reverse.bin".to_owned(),
                        folder,
                        turbo: false,
                        resume_from: None,
                        timeout: Duration::from_millis(200),
                        cancel: None,
                    },
                    |port| {
                        let _ = port_tx.send(port);
                    },
                    |_, _| {},
                )
                .await
            }
        });

        let port = port_rx.await.unwrap();
        let mut stranger = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let _ = stranger.write_all(b"take this").await;

        // The transfer is still waiting for the sender rather than saving that.
        assert!(tokio::time::timeout(Duration::from_millis(300), receiving)
            .await
            .is_err());
        assert!(!folder.path().join("reverse.bin").exists());
    }

    #[test]
    fn the_local_address_towards_a_peer_is_one_of_ours() {
        let address = local_address_towards("127.0.0.1").expect("a route to loopback");
        assert_eq!(address, "127.0.0.1");
        assert!(local_address_towards("not-an-address").is_none());
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
                secure: false,
                turbo: false,
                resume_from: None,
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
                secure: false,
                turbo: false,
                resume_from: None,
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
                secure: false,
                turbo: false,
                resume_from: None,
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
                secure: false,
                turbo: false,
                resume_from: None,
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
