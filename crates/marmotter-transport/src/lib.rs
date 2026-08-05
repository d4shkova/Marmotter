//! Marmotter's byte transport.
//!
//! This crate has exactly one job: open a TCP socket, negotiate TLS, and stream
//! bytes in both directions. It does not parse IRC, and it does not know what a
//! channel is. All protocol logic lives in `packages/protocol`, in TypeScript,
//! so that desktop, web, and Android share one implementation.
//!
//! The one thing it does interpret is the line terminator, because framing is a
//! property of the byte stream rather than of the protocol above it.

#![deny(missing_docs)]

/// Bytes that terminate every IRC message on the wire.
pub const CRLF: &[u8] = b"\r\n";

pub mod connection;
pub mod dcc;
pub mod error;
pub mod lines;
pub mod tls;

pub use connection::{
    connect, Close, ConnectOptions, Connection, Event, Security, DEFAULT_TIMEOUT,
};
pub use dcc::{
    download as dcc_download, DownloadOptions as DccDownloadOptions, DEFAULT_DCC_TIMEOUT,
};
pub use error::{Result, TransportError};
pub use lines::{LineDecoder, MAX_LINE_BYTES};
pub use tls::{
    fingerprint, format_fingerprint, parse_fingerprint, ClientCertificate, Verification,
};
