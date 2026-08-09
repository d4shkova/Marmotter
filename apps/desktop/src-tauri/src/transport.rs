//! Tauri commands wrapping `marmotter-transport`.
//!
//! This layer is deliberately thin: it converts between the shapes the front
//! end sends and the crate's types, keeps a registry of live connections, and
//! forwards lines as events. It contains no protocol knowledge, and the crate
//! it wraps contains none either.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use marmotter_transport::{
    connect, parse_fingerprint, ClientCertificate, Close, ConnectOptions, Connection, Event,
    Security, Verification,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// Event emitted for every line received. Payload is [`LinePayload`].
pub const LINE_EVENT: &str = "marmotter://line";
/// Event emitted once when a connection ends. Payload is [`ClosePayload`].
pub const CLOSE_EVENT: &str = "marmotter://close";

/// How the front end describes certificate verification.
///
/// Mirrors `TlsConfig` in `packages/shared`, so the profile schema maps across
/// without an intermediate translation step.
#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum TlsRequest {
    /// No TLS at all.
    Off,
    /// TLS. `verifyCert` false with no fingerprint means accept anything.
    Tls {
        #[serde(rename = "verifyCert")]
        verify_cert: bool,
        #[serde(rename = "pinnedFingerprint")]
        pinned_fingerprint: Option<String>,
    },
}

/// A client certificate, already read by the front end.
///
/// The file is read on the TypeScript side so that path handling and the file
/// picker stay in one place, and so this layer never touches the filesystem.
#[derive(Debug, Deserialize)]
pub struct ClientCertificateRequest {
    #[serde(rename = "certificatePem")]
    pub certificate_pem: String,
    #[serde(rename = "keyPem")]
    pub key_pem: String,
}

/// What `transport_connect` accepts.
#[derive(Debug, Deserialize)]
pub struct ConnectRequest {
    pub host: String,
    pub port: u16,
    pub tls: TlsRequest,
    #[serde(rename = "clientCertificate")]
    pub client_certificate: Option<ClientCertificateRequest>,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinePayload {
    pub id: String,
    pub line: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClosePayload {
    pub id: String,
    /// One of `user`, `server`, `timeout`, `tls-error`, `network-error`.
    pub kind: String,
    pub message: String,
}

/// Why `transport_connect` rejected.
///
/// Carries the same `kind` tags a close does, so the front end can tell a
/// certificate that would not verify (`tls-error`) from a server that could not
/// be reached (`network-error`) and offer to trust the certificate rather than
/// only reporting a failure.
#[derive(Debug, Clone, Serialize)]
pub struct ConnectError {
    /// One of `timeout`, `tls-error`, `network-error`.
    pub kind: String,
    pub message: String,
}

/// The `CloseReason` tag for a transport error.
fn error_kind(error: &marmotter_transport::TransportError) -> &'static str {
    match error.kind() {
        "timeout" => "timeout",
        "tls" | "client-certificate" => "tls-error",
        _ => "network-error",
    }
}

/// Live connections, keyed by the id handed back to the front end.
#[derive(Default)]
pub struct Transports {
    connections: Mutex<HashMap<String, Connection>>,
    next_id: Mutex<u64>,
}

impl Transports {
    fn allocate_id(&self) -> String {
        let mut next = self.next_id.lock().expect("transport id lock");
        *next += 1;
        format!("conn-{next}")
    }
}

fn verification_from(tls: &TlsRequest) -> Result<Security, String> {
    match tls {
        TlsRequest::Off => Ok(Security::Plaintext),
        TlsRequest::Tls {
            verify_cert,
            pinned_fingerprint,
        } => {
            if *verify_cert {
                return Ok(Security::Tls(Verification::Full));
            }
            match pinned_fingerprint {
                Some(text) => {
                    let expected = parse_fingerprint(text).map_err(|error| error.to_string())?;
                    Ok(Security::Tls(Verification::Pinned(expected)))
                }
                // Verification off with nothing pinned. The interface makes the
                // implication explicit before this can be selected.
                None => Ok(Security::Tls(Verification::None)),
            }
        }
    }
}

/// Maps a close reason onto the `CloseReason` union in `packages/shared`.
fn close_payload(id: String, close: &Close) -> ClosePayload {
    match close {
        Close::Requested => ClosePayload {
            id,
            kind: "user".into(),
            message: String::new(),
        },
        Close::Server => ClosePayload {
            id,
            kind: "server".into(),
            message: String::new(),
        },
        Close::Error(error) => ClosePayload {
            id,
            kind: error_kind(error).into(),
            message: error.to_string(),
        },
    }
}

/// Opens a connection. Returns the id used by the other commands.
#[tauri::command]
pub async fn transport_connect(
    app: AppHandle,
    transports: State<'_, Transports>,
    request: ConnectRequest,
) -> Result<String, ConnectError> {
    let security = verification_from(&request.tls).map_err(|message| ConnectError {
        kind: "network-error".into(),
        message,
    })?;

    let client_certificate = request
        .client_certificate
        .map(|certificate| ClientCertificate {
            certificate_pem: certificate.certificate_pem.into_bytes(),
            key_pem: certificate.key_pem.into_bytes(),
        });

    let options = ConnectOptions {
        host: request.host,
        port: request.port,
        security,
        client_certificate,
        timeout: request
            .timeout_ms
            .map_or(marmotter_transport::DEFAULT_TIMEOUT, Duration::from_millis),
    };

    // Classify a handshake failure the same way a close is classified, so a
    // rejected certificate arrives at the front end as a `tls-error`.
    let (connection, mut events) = connect(options).await.map_err(|error| ConnectError {
        kind: error_kind(&error).into(),
        message: error.to_string(),
    })?;

    let id = transports.allocate_id();
    transports
        .connections
        .lock()
        .expect("transport registry lock")
        .insert(id.clone(), connection);

    let forward_id = id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                Event::Line(line) => {
                    let _ = app.emit(
                        LINE_EVENT,
                        LinePayload {
                            id: forward_id.clone(),
                            line,
                        },
                    );
                }
                Event::Closed(close) => {
                    let _ = app.emit(CLOSE_EVENT, close_payload(forward_id.clone(), &close));

                    // Drop the handle so the registry does not grow for the
                    // lifetime of the process.
                    let transports = app.state::<Transports>();
                    if let Ok(mut registry) = transports.connections.lock() {
                        registry.remove(&forward_id);
                    }
                    break;
                }
            }
        }
    });

    Ok(id)
}

/// Queues one line on an open connection.
#[tauri::command]
pub fn transport_send(
    transports: State<'_, Transports>,
    id: String,
    line: String,
) -> Result<(), String> {
    let registry = transports
        .connections
        .lock()
        .map_err(|_| "the connection registry is unavailable".to_string())?;

    let connection = registry
        .get(&id)
        .ok_or_else(|| format!("no open connection called {id}"))?;

    connection.send(&line).map_err(|error| error.to_string())
}

/// Closes a connection. Closing one that has already gone is not an error.
#[tauri::command]
pub fn transport_disconnect(transports: State<'_, Transports>, id: String) -> Result<(), String> {
    let mut registry = transports
        .connections
        .lock()
        .map_err(|_| "the connection registry is unavailable".to_string())?;

    if let Some(mut connection) = registry.remove(&id) {
        connection.disconnect();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_three_verification_modes_the_profile_can_express() {
        assert_eq!(
            verification_from(&TlsRequest::Off).unwrap(),
            Security::Plaintext
        );
        assert_eq!(
            verification_from(&TlsRequest::Tls {
                verify_cert: true,
                pinned_fingerprint: None
            })
            .unwrap(),
            Security::Tls(Verification::Full)
        );
        assert_eq!(
            verification_from(&TlsRequest::Tls {
                verify_cert: false,
                pinned_fingerprint: None
            })
            .unwrap(),
            Security::Tls(Verification::None)
        );
    }

    #[test]
    fn a_pinned_fingerprint_wins_over_accepting_anything() {
        let pinned = marmotter_transport::format_fingerprint(&[0x11u8; 32]);
        assert_eq!(
            verification_from(&TlsRequest::Tls {
                verify_cert: false,
                pinned_fingerprint: Some(pinned)
            })
            .unwrap(),
            Security::Tls(Verification::Pinned([0x11u8; 32]))
        );
    }

    #[test]
    fn a_malformed_fingerprint_is_refused_rather_than_ignored() {
        // Silently falling back to accepting anything would turn a typo into a
        // downgrade.
        let result = verification_from(&TlsRequest::Tls {
            verify_cert: false,
            pinned_fingerprint: Some("nonsense".into()),
        });
        assert!(result.is_err());
    }

    #[test]
    fn maps_every_close_onto_the_shared_close_reason_union() {
        assert_eq!(close_payload("a".into(), &Close::Requested).kind, "user");
        assert_eq!(close_payload("a".into(), &Close::Server).kind, "server");
        assert_eq!(
            close_payload(
                "a".into(),
                &Close::Error(marmotter_transport::TransportError::Timeout)
            )
            .kind,
            "timeout"
        );
        assert_eq!(
            close_payload(
                "a".into(),
                &Close::Error(marmotter_transport::TransportError::Tls("bad".into()))
            )
            .kind,
            "tls-error"
        );
        assert_eq!(
            close_payload(
                "a".into(),
                &Close::Error(marmotter_transport::TransportError::Network("bad".into()))
            )
            .kind,
            "network-error"
        );
    }

    #[test]
    fn hands_out_distinct_connection_ids() {
        let transports = Transports::default();
        let first = transports.allocate_id();
        let second = transports.allocate_id();
        assert_ne!(first, second);
    }
}
