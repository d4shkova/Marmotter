//! TLS configuration, including the two deliberately-dangerous modes.
//!
//! Certificate verification is chosen per server endpoint at profile-creation
//! time, and the default is full verification. The other two modes exist
//! because self-hosted IRC servers commonly use self-signed certificates, and
//! refusing to support them at all would push people onto plaintext — which is
//! strictly worse. They are opt-in, and the interface states the implication in
//! plain language before either is selected.

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::{DigitallySignedStruct, RootCertStore, SignatureScheme};
use rustls_pki_types::{CertificateDer, ServerName, UnixTime};
use sha2::{Digest, Sha256};

use crate::error::{Result, TransportError};

/// How the server's certificate is checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verification {
    /// Verify against the platform trust store. The default, and the only mode
    /// that protects against an active attacker.
    Full,
    /// Accept exactly one certificate, identified by its SHA-256 fingerprint.
    ///
    /// This is the right answer for a self-hosted server: it pins one specific
    /// certificate rather than trusting anything.
    Pinned([u8; 32]),
    /// Accept any certificate at all.
    ///
    /// Encrypts the connection but proves nothing about who is on the other
    /// end. Offered only with an explicit warning, and never as a default.
    None,
}

/// A PEM client certificate and key, for CertFP and SASL EXTERNAL.
#[derive(Debug, Clone)]
pub struct ClientCertificate {
    /// The certificate chain, PEM encoded.
    pub certificate_pem: Vec<u8>,
    /// The private key, PEM encoded.
    pub key_pem: Vec<u8>,
}

/// Formats a fingerprint the way a person would compare it: uppercase hex,
/// colon separated.
#[must_use]
pub fn format_fingerprint(bytes: &[u8; 32]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

/// Parses a fingerprint written with or without separators.
///
/// Accepts `AA:BB:...`, `aa bb ...`, and bare hex, because those are the forms
/// people paste out of other tools.
pub fn parse_fingerprint(text: &str) -> Result<[u8; 32]> {
    let hex: String = text
        .chars()
        .filter(|c| !matches!(c, ':' | ' ' | '-' | '\n' | '\r' | '\t'))
        .collect();

    if hex.len() != 64 {
        return Err(TransportError::Tls(format!(
            "a SHA-256 fingerprint has 64 hex digits, this one has {}",
            hex.len()
        )));
    }

    let mut out = [0u8; 32];
    for (index, pair) in hex.as_bytes().chunks(2).enumerate() {
        let text = std::str::from_utf8(pair)
            .map_err(|_| TransportError::Tls("fingerprint is not valid text".into()))?;
        out[index] = u8::from_str_radix(text, 16)
            .map_err(|_| TransportError::Tls(format!("`{text}` is not a hex byte")))?;
    }
    Ok(out)
}

/// The SHA-256 fingerprint of a certificate, over its DER encoding.
#[must_use]
pub fn fingerprint(certificate: &CertificateDer<'_>) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(certificate.as_ref());
    hasher.finalize().into()
}

/// Accepts one certificate, by fingerprint, and nothing else.
#[derive(Debug)]
struct PinnedVerifier {
    expected: [u8; 32],
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        let actual = fingerprint(end_entity);
        // Constant time is not required — the expected value is not a secret —
        // but comparing the whole array avoids an early-return habit.
        if actual == self.expected {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(format!(
                "certificate fingerprint {} does not match the pinned {}",
                format_fingerprint(&actual),
                format_fingerprint(&self.expected)
            )))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Accepts anything. Used only for `Verification::None`.
#[derive(Debug)]
struct AcceptAnyVerifier {
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl ServerCertVerifier for AcceptAnyVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// The platform trust store, falling back to the bundled Mozilla roots.
///
/// Reading the OS store first is what lets a corporate or user-added CA work
/// without Marmotter needing to know about it.
fn root_store() -> RootCertStore {
    let mut roots = RootCertStore::empty();

    // Partial failure is normal: some platforms hand back a few certificates
    // that fail to parse alongside the ones that do. Take what loaded.
    let native = rustls_native_certs::load_native_certs();
    for certificate in native.certs {
        let _ = roots.add(certificate);
    }

    if roots.is_empty() {
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    }

    roots
}

fn read_client_certificate(
    certificate: &ClientCertificate,
) -> Result<(
    Vec<CertificateDer<'static>>,
    rustls_pki_types::PrivateKeyDer<'static>,
)> {
    let certificates = rustls_pemfile::certs(&mut certificate.certificate_pem.as_slice())
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| TransportError::ClientCertificate(error.to_string()))?;

    if certificates.is_empty() {
        return Err(TransportError::ClientCertificate(
            "the certificate file contains no certificate".into(),
        ));
    }

    let key = rustls_pemfile::private_key(&mut certificate.key_pem.as_slice())
        .map_err(|error| TransportError::ClientCertificate(error.to_string()))?
        .ok_or_else(|| {
            TransportError::ClientCertificate("the key file contains no private key".into())
        })?;

    Ok((certificates, key))
}

/// Builds the rustls client configuration for a verification mode.
pub fn client_config(
    verification: &Verification,
    client_certificate: Option<&ClientCertificate>,
) -> Result<rustls::ClientConfig> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());

    let builder = rustls::ClientConfig::builder_with_provider(Arc::clone(&provider))
        .with_safe_default_protocol_versions()
        .map_err(|error| TransportError::Tls(error.to_string()))?;

    let builder = match verification {
        Verification::Full => builder.with_root_certificates(root_store()),
        Verification::Pinned(expected) => {
            builder
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(PinnedVerifier {
                    expected: *expected,
                    provider: Arc::clone(&provider),
                }))
        }
        Verification::None => builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptAnyVerifier {
                provider: Arc::clone(&provider),
            })),
    };

    let config = match client_certificate {
        Some(certificate) => {
            let (chain, key) = read_client_certificate(certificate)?;
            builder
                .with_client_auth_cert(chain, key)
                .map_err(|error| TransportError::Tls(error.to_string()))?
        }
        None => builder.with_no_client_auth(),
    };

    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_a_fingerprint_the_way_a_person_compares_it() {
        let bytes = [0xABu8; 32];
        let text = format_fingerprint(&bytes);
        assert!(text.starts_with("AB:AB:"));
        assert_eq!(text.len(), 32 * 3 - 1);
    }

    #[test]
    fn parses_the_forms_people_paste() {
        let canonical = format_fingerprint(&[0x0Fu8; 32]);
        assert_eq!(parse_fingerprint(&canonical).unwrap(), [0x0Fu8; 32]);
        assert_eq!(
            parse_fingerprint(&canonical.replace(':', "")).unwrap(),
            [0x0Fu8; 32]
        );
        assert_eq!(
            parse_fingerprint(&canonical.replace(':', " ")).unwrap(),
            [0x0Fu8; 32]
        );
        assert_eq!(
            parse_fingerprint(&canonical.to_lowercase()).unwrap(),
            [0x0Fu8; 32]
        );
    }

    #[test]
    fn rejects_a_fingerprint_of_the_wrong_length() {
        assert!(parse_fingerprint("AA:BB").is_err());
        assert!(parse_fingerprint("").is_err());
    }

    #[test]
    fn rejects_a_fingerprint_that_is_not_hex() {
        let bad = "ZZ".repeat(32);
        assert!(parse_fingerprint(&bad).is_err());
    }

    #[test]
    fn builds_a_configuration_for_every_verification_mode() {
        assert!(client_config(&Verification::Full, None).is_ok());
        assert!(client_config(&Verification::Pinned([0u8; 32]), None).is_ok());
        assert!(client_config(&Verification::None, None).is_ok());
    }

    #[test]
    fn refuses_a_client_certificate_that_is_not_a_certificate() {
        let certificate = ClientCertificate {
            certificate_pem: b"not a certificate".to_vec(),
            key_pem: b"not a key".to_vec(),
        };
        let error = client_config(&Verification::Full, Some(&certificate)).unwrap_err();
        assert_eq!(error.kind(), "client-certificate");
    }
}
