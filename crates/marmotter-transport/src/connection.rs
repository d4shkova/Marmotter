//! The connection itself: open a socket, negotiate TLS, stream lines.
//!
//! This is the whole job. The connection does not know what a channel is, what
//! a nick is, or that PING deserves a PONG — all of that lives in
//! `packages/protocol`, in TypeScript, so desktop and web share one
//! implementation.

use std::sync::Arc;
use std::time::Duration;

use socket2::{SockRef, TcpKeepalive};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_rustls::TlsConnector;

use crate::error::{Result, TransportError};
use crate::lines::LineDecoder;
use crate::tls::{client_config, ClientCertificate, Verification};

/// Default time allowed to establish a connection, including the handshake.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// How long the socket may be idle before the kernel probes the far end.
///
/// The client's own `PING` in `packages/client/src/keepalive.ts` is the primary
/// answer to a half-open connection and this does not replace it: an IRC client
/// has to notice a server that is reachable but no longer talking, which is a
/// question only the protocol can ask. What this adds is the case the timers
/// above cannot cover — a machine that suspends, or a webview whose timers the
/// operating system has throttled to nothing. The kernel keeps probing either
/// way, and when it gives up the socket closes for real, which is a close event
/// arriving where otherwise there would be silence.
///
/// Two minutes rather than the system default of two hours, which is long
/// enough to be indistinguishable from never.
const KEEPALIVE_IDLE: Duration = Duration::from_secs(120);

/// How long between probes once the far end has stopped answering.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);

/// Asks the kernel to probe an idle socket, and shrugs if it will not.
///
/// Best-effort on purpose. The knobs behind this are not portable — the retry
/// count is unavailable on Windows, and a sandboxed platform may refuse the
/// option outright — and none of it is load-bearing: the client's own `PING` is
/// what actually decides a connection is dead. A refusal here should cost
/// nothing, so it is not an error and is not reported as one.
fn enable_tcp_keepalive(stream: &TcpStream) {
    let keepalive = TcpKeepalive::new()
        .with_time(KEEPALIVE_IDLE)
        .with_interval(KEEPALIVE_INTERVAL);
    let _ = SockRef::from(stream).set_tcp_keepalive(&keepalive);
}

/// How the socket is secured.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Security {
    /// Plaintext. Everything, including the password, is readable in transit.
    Plaintext,
    /// TLS, with the given certificate verification mode.
    Tls(Verification),
}

#[derive(Debug, Clone)]
/// Everything needed to open one connection.
pub struct ConnectOptions {
    /// Hostname or IP literal. Used for both the connection and SNI.
    pub host: String,
    /// TCP port.
    pub port: u16,
    /// Whether and how to secure the socket.
    pub security: Security,
    /// Client certificate, for CertFP and SASL EXTERNAL.
    pub client_certificate: Option<ClientCertificate>,
    /// Time allowed to establish the connection, handshake included.
    pub timeout: Duration,
}

impl ConnectOptions {
    /// A connection with the defaults CLAUDE.md specifies for a new endpoint:
    /// TLS on port 6697 with certificate verification on.
    #[must_use]
    pub fn secure(host: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port: 6697,
            security: Security::Tls(Verification::Full),
            client_certificate: None,
            timeout: DEFAULT_TIMEOUT,
        }
    }
}

/// What the connection reports back to its owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// One complete line, with its terminator removed.
    Line(String),
    /// The connection ended. No further events follow.
    Closed(Close),
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Why a connection ended.
pub enum Close {
    /// `disconnect` was called.
    Requested,
    /// The peer closed the connection cleanly.
    Server,
    /// Something went wrong. The connection is gone either way.
    Error(TransportError),
}

/// A live connection.
///
/// Dropping the handle closes the socket: the reader task stops as soon as its
/// event channel has no receiver, and the writer stops when its queue closes.
#[derive(Debug)]
pub struct Connection {
    outgoing: mpsc::UnboundedSender<Vec<u8>>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Connection {
    /// Queues one line. The CRLF terminator is appended here, so no caller can
    /// forget it and no caller can inject a second message by including one.
    pub fn send(&self, line: &str) -> Result<()> {
        let mut bytes = Vec::with_capacity(line.len() + 2);
        bytes.extend_from_slice(line.as_bytes());
        bytes.extend_from_slice(b"\r\n");

        self.outgoing
            .send(bytes)
            .map_err(|_| TransportError::Closed)
    }

    /// Closes the connection. Idempotent.
    pub fn disconnect(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.disconnect();
    }
}

/// Opens a connection and starts streaming.
///
/// Returns the handle plus the event stream. Both halves must be kept: dropping
/// the receiver stops the reader.
pub async fn connect(
    options: ConnectOptions,
) -> Result<(Connection, mpsc::UnboundedReceiver<Event>)> {
    let stream = tokio::time::timeout(
        options.timeout,
        TcpStream::connect((options.host.as_str(), options.port)),
    )
    .await
    .map_err(|_| TransportError::Timeout)?
    .map_err(|error| TransportError::Resolve(error.to_string()))?;

    // Interactive traffic: a 200ms delay on every short line is very noticeable
    // in a chat client.
    let _ = stream.set_nodelay(true);
    enable_tcp_keepalive(&stream);

    let (events_tx, events_rx) = mpsc::unbounded_channel();
    let (outgoing_tx, outgoing_rx) = mpsc::unbounded_channel();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

    match &options.security {
        Security::Plaintext => {
            tokio::spawn(pump(stream, events_tx, outgoing_rx, shutdown_rx));
        }
        Security::Tls(verification) => {
            let config = client_config(verification, options.client_certificate.as_ref())?;
            let connector = TlsConnector::from(Arc::new(config));

            // SNI. An IP literal is sent as such rather than as a hostname,
            // which is what rustls requires and what servers expect.
            let server_name = rustls_pki_types::ServerName::try_from(options.host.clone())
                .map_err(|_| {
                    TransportError::Tls(format!("`{}` is not a valid server name", options.host))
                })?;

            let tls = tokio::time::timeout(options.timeout, connector.connect(server_name, stream))
                .await
                .map_err(|_| TransportError::Timeout)?
                .map_err(|error| TransportError::Tls(error.to_string()))?;

            tokio::spawn(pump(tls, events_tx, outgoing_rx, shutdown_rx));
        }
    }

    Ok((
        Connection {
            outgoing: outgoing_tx,
            shutdown: Some(shutdown_tx),
        },
        events_rx,
    ))
}

/// Moves bytes in both directions until something stops it.
async fn pump<S>(
    stream: S,
    events: mpsc::UnboundedSender<Event>,
    mut outgoing: mpsc::UnboundedReceiver<Vec<u8>>,
    mut shutdown: tokio::sync::oneshot::Receiver<()>,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut decoder = LineDecoder::new();
    let mut buffer = vec![0u8; 8192];

    let close = loop {
        tokio::select! {
            // Biased so a pending disconnect wins over more reading, which
            // makes teardown deterministic rather than racy.
            biased;

            _ = &mut shutdown => break Close::Requested,

            queued = outgoing.recv() => {
                match queued {
                    Some(bytes) => {
                        if let Err(error) = writer.write_all(&bytes).await {
                            break Close::Error(TransportError::Network(error.to_string()));
                        }
                        if let Err(error) = writer.flush().await {
                            break Close::Error(TransportError::Network(error.to_string()));
                        }
                    }
                    None => break Close::Requested,
                }
            }

            read = reader.read(&mut buffer) => {
                match read {
                    Ok(0) => break Close::Server,
                    Ok(count) => match decoder.push(&buffer[..count]) {
                        Ok(lines) => {
                            for line in lines {
                                if events.send(Event::Line(line)).is_err() {
                                    // Nobody is listening any more.
                                    return;
                                }
                            }
                        }
                        Err(error) => break Close::Error(error),
                    },
                    Err(error) => break Close::Error(TransportError::Network(error.to_string())),
                }
            }
        }
    };

    // Best effort: a peer that has already gone away cannot be told goodbye.
    let _ = writer.shutdown().await;
    let _ = events.send(Event::Closed(close));
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncBufReadExt;
    use tokio::net::TcpListener;

    /// A plaintext server that greets, echoes one line, then closes.
    async fn echo_server() -> std::net::SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, mut writer) = tokio::io::split(stream);
            writer
                .write_all(b":server 001 you :Welcome\r\n")
                .await
                .unwrap();

            let mut lines = tokio::io::BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                writer
                    .write_all(format!("ECHO :{line}\r\n").as_bytes())
                    .await
                    .unwrap();
                if line.starts_with("QUIT") {
                    break;
                }
            }
        });

        address
    }

    fn plaintext(address: std::net::SocketAddr) -> ConnectOptions {
        ConnectOptions {
            host: address.ip().to_string(),
            port: address.port(),
            security: Security::Plaintext,
            client_certificate: None,
            timeout: Duration::from_secs(5),
        }
    }

    #[tokio::test]
    async fn receives_lines_from_the_server() {
        let address = echo_server().await;
        let (_connection, mut events) = connect(plaintext(address)).await.unwrap();

        assert_eq!(
            events.recv().await.unwrap(),
            Event::Line(":server 001 you :Welcome".into())
        );
    }

    #[tokio::test]
    async fn sends_lines_and_appends_the_terminator() {
        let address = echo_server().await;
        let (connection, mut events) = connect(plaintext(address)).await.unwrap();

        let _ = events.recv().await;
        connection.send("PING :token").unwrap();

        assert_eq!(
            events.recv().await.unwrap(),
            Event::Line("ECHO :PING :token".into())
        );
    }

    #[tokio::test]
    async fn reports_the_server_closing() {
        let address = echo_server().await;
        let (connection, mut events) = connect(plaintext(address)).await.unwrap();

        let _ = events.recv().await;
        connection.send("QUIT :bye").unwrap();

        let mut last = None;
        while let Some(event) = events.recv().await {
            last = Some(event);
        }
        assert_eq!(last, Some(Event::Closed(Close::Server)));
    }

    #[tokio::test]
    async fn reports_a_requested_disconnect() {
        let address = echo_server().await;
        let (mut connection, mut events) = connect(plaintext(address)).await.unwrap();

        let _ = events.recv().await;
        connection.disconnect();

        let mut last = None;
        while let Some(event) = events.recv().await {
            last = Some(event);
        }
        assert_eq!(last, Some(Event::Closed(Close::Requested)));
    }

    #[tokio::test]
    async fn disconnecting_twice_is_harmless() {
        let address = echo_server().await;
        let (mut connection, _events) = connect(plaintext(address)).await.unwrap();
        connection.disconnect();
        connection.disconnect();
    }

    #[tokio::test]
    async fn sending_after_close_reports_closed_rather_than_panicking() {
        let address = echo_server().await;
        let (mut connection, mut events) = connect(plaintext(address)).await.unwrap();
        let _ = events.recv().await;

        connection.disconnect();
        while events.recv().await.is_some() {}

        // The queue survives; the failure surfaces on the next send at latest.
        let _ = connection.send("PING :after");
    }

    #[tokio::test]
    async fn refuses_a_port_with_nothing_listening() {
        let options = ConnectOptions {
            host: "127.0.0.1".into(),
            // Port 1 is privileged and reliably unbound in a test environment.
            port: 1,
            security: Security::Plaintext,
            client_certificate: None,
            timeout: Duration::from_secs(2),
        };
        assert!(connect(options).await.is_err());
    }

    #[tokio::test]
    async fn times_out_rather_than_hanging() {
        // 10.255.255.1 is in a private range and reliably unroutable, so the
        // connection attempt hangs rather than being refused.
        let options = ConnectOptions {
            host: "10.255.255.1".into(),
            port: 6667,
            security: Security::Plaintext,
            client_certificate: None,
            timeout: Duration::from_millis(200),
        };

        let error = connect(options).await.unwrap_err();
        assert!(matches!(
            error,
            TransportError::Timeout | TransportError::Resolve(_)
        ));
    }

    #[tokio::test]
    async fn reports_a_name_that_cannot_be_resolved() {
        let options = ConnectOptions {
            host: "no-such-host.invalid".into(),
            port: 6667,
            security: Security::Plaintext,
            client_certificate: None,
            timeout: Duration::from_secs(5),
        };
        let error = connect(options).await.unwrap_err();
        assert_eq!(error.kind(), "resolve");
    }

    #[test]
    fn the_secure_default_is_tls_on_6697_with_verification() {
        let options = ConnectOptions::secure("irc.libera.chat");
        assert_eq!(options.port, 6697);
        assert_eq!(options.security, Security::Tls(Verification::Full));
    }
}
