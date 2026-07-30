//! Marmotter's byte transport.
//!
//! This crate has exactly one job: open a TCP socket, negotiate TLS, and stream
//! bytes in both directions. It does not parse IRC, and it does not know what a
//! channel is. All protocol logic lives in `packages/protocol`, in TypeScript,
//! so that desktop, web, and Android share one implementation.
//!
//! Phase 2 of BUILD_PLAN.md implements this over `tokio` and `rustls`, with
//! certificate verification on, off, and fingerprint-pinned; client certificates
//! for CertFP; SNI; and connection timeouts.

#![deny(missing_docs)]

/// Bytes that terminate every IRC message on the wire.
pub const CRLF: &[u8] = b"\r\n";

#[cfg(test)]
mod tests {
    use super::CRLF;

    #[test]
    fn crlf_is_two_bytes() {
        assert_eq!(CRLF, b"\r\n");
    }
}
