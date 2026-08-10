//! Errors this crate can produce.

use std::fmt;

/// Why a connection ended or failed to start.
///
/// The variants mirror `CloseReason` on the TypeScript side, so the front end
/// can render a plain-English sentence without re-deriving what went wrong.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    /// The host could not be resolved, or no address accepted a connection.
    Resolve(String),
    /// The TCP connection failed or was lost.
    Network(String),
    /// The connection was not established before the timeout elapsed.
    Timeout,
    /// TLS setup or the handshake failed. Certificate rejection lands here.
    Tls(String),
    /// A client certificate or key could not be read.
    ClientCertificate(String),
    /// The peer sent more than [`crate::MAX_LINE_BYTES`] without a newline.
    LineTooLong,
    /// The connection has already been closed.
    Closed,
    /// The operation was cancelled by the user before it finished.
    Cancelled,
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Resolve(detail) => write!(f, "could not reach the server: {detail}"),
            Self::Network(detail) => write!(f, "network error: {detail}"),
            Self::Timeout => write!(f, "the server did not answer in time"),
            Self::Tls(detail) => write!(f, "the secure connection failed: {detail}"),
            Self::ClientCertificate(detail) => {
                write!(f, "the client certificate could not be used: {detail}")
            }
            Self::LineTooLong => write!(f, "the server sent an oversized line"),
            Self::Closed => write!(f, "the connection is closed"),
            Self::Cancelled => write!(f, "the download was cancelled"),
        }
    }
}

impl std::error::Error for TransportError {}

/// A short machine-readable tag, so the front end can switch on the cause
/// without matching on prose.
impl TransportError {
    /// A stable tag for this cause.
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Resolve(_) => "resolve",
            Self::Network(_) => "network",
            Self::Timeout => "timeout",
            Self::Tls(_) => "tls",
            Self::ClientCertificate(_) => "client-certificate",
            Self::LineTooLong => "line-too-long",
            Self::Closed => "closed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// Result specialised to [`TransportError`].
pub type Result<T> = std::result::Result<T, TransportError>;
