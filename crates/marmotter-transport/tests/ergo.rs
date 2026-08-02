//! Phase 2 acceptance: connect to a real IRC server, over plaintext and over
//! TLS with a self-signed certificate pinned by fingerprint, completing
//! registration and joining a channel in both cases.
//!
//! The server is a real ergo, spawned per test with a generated configuration.
//! Nothing here mocks a socket: the point is to prove the transport works
//! against software that did not know it was being tested.
//!
//! Every test skips, rather than fails, when `ergo` is not on PATH, so a
//! contributor without it can still run `cargo test`.

use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use marmotter_transport::{
    connect, format_fingerprint, Close, ConnectOptions, Event, Security, Verification,
};
use tokio::sync::mpsc::UnboundedReceiver;

/// Whether an ergo binary is available to test against.
fn ergo_available() -> bool {
    Command::new("ergo")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// A port nothing is listening on. Racy in principle, fine in practice.
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("a local port")
        .local_addr()
        .expect("an address")
        .port()
}

/// A running ergo, killed when the guard drops.
struct Ergo {
    child: Child,
    plaintext_port: u16,
    tls_port: u16,
    certificate_fingerprint: [u8; 32],
    _directory: tempfile::TempDir,
}

impl Drop for Ergo {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn write_config(directory: &Path, plaintext: u16, tls: u16) -> PathBuf {
    let config = format!(
        r#"
network:
  name: MarmotterTest
server:
  name: ergo.test
  listeners:
    "127.0.0.1:{plaintext}":
    "127.0.0.1:{tls}":
      tls:
        cert: tls.crt
        key: tls.key
  casemapping: ascii
  enforce-utf8: true
  lookup-hostnames: false
  check-ident: false
  motd:
  max-sendq: 96k
  ip-limits:
    count: false
    throttle: false
accounts:
  authentication-enabled: true
  registration:
    enabled: true
    allow-before-connect: true
    email-verification:
      enabled: false
  login-via-pass-command: true
  advertise-scram: true
channels:
  registration:
    enabled: true
datastore:
  path: ircd.db
limits:
  nicklen: 32
  channellen: 64
  awaylen: 390
  kicklen: 390
  topiclen: 390
history:
  enabled: true
  channel-length: 2048
  autoresize-window: 3d
  chathistory-maxmessages: 100
logging:
  - method: stderr
    level: error
    type: "* -userinput -useroutput"
"#
    );

    let path = directory.join("ircd.yaml");
    let mut file = std::fs::File::create(&path).expect("write the config");
    file.write_all(config.as_bytes()).expect("write the config");
    path
}

/// Generates the self-signed certificate ergo will present, and returns its
/// SHA-256 fingerprint so a test can pin it.
fn write_certificate(directory: &Path) -> [u8; 32] {
    let certificate =
        rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()])
            .expect("generate a certificate");

    let der = certificate.cert.der();
    let fingerprint = marmotter_transport::fingerprint(der);

    std::fs::write(directory.join("tls.crt"), certificate.cert.pem()).expect("write the cert");
    std::fs::write(
        directory.join("tls.key"),
        certificate.key_pair.serialize_pem(),
    )
    .expect("write the key");

    fingerprint
}

fn start_ergo() -> Ergo {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let plaintext_port = free_port();
    let tls_port = free_port();

    let certificate_fingerprint = write_certificate(directory.path());
    let config = write_config(directory.path(), plaintext_port, tls_port);

    let status = Command::new("ergo")
        .args(["initdb", "--conf"])
        .arg(&config)
        .arg("--quiet")
        .current_dir(directory.path())
        .status()
        .expect("run ergo initdb");
    assert!(status.success(), "ergo initdb failed");

    let child = Command::new("ergo")
        .args(["run", "--conf"])
        .arg(&config)
        .arg("--quiet")
        .current_dir(directory.path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("start ergo");

    let ergo = Ergo {
        child,
        plaintext_port,
        tls_port,
        certificate_fingerprint,
        _directory: directory,
    };

    wait_for_port(plaintext_port);
    ergo
}

fn wait_for_port(port: u16) {
    for _ in 0..100 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("ergo did not start listening on port {port}");
}

/// Reads events until one satisfies the predicate, or the deadline passes.
async fn wait_for(
    events: &mut UnboundedReceiver<Event>,
    seen: &mut Vec<String>,
    predicate: impl Fn(&str) -> bool,
) -> String {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);

    loop {
        let event = tokio::time::timeout_at(deadline, events.recv())
            .await
            .unwrap_or_else(|_| panic!("timed out; saw:\n{}", seen.join("\n")));

        match event {
            Some(Event::Line(line)) => {
                let matched = predicate(&line);
                seen.push(line.clone());
                if matched {
                    return line;
                }
            }
            Some(Event::Closed(close)) => {
                panic!("connection closed as {close:?}; saw:\n{}", seen.join("\n"))
            }
            None => panic!("event stream ended; saw:\n{}", seen.join("\n")),
        }
    }
}

/// Registers and joins a channel, asserting the server agrees at each step.
///
/// This is deliberately hand-written rather than driven through
/// `packages/protocol`: the point is to exercise the transport, and a Rust test
/// cannot reach the TypeScript parser anyway.
async fn register_and_join(
    connection: &marmotter_transport::Connection,
    events: &mut UnboundedReceiver<Event>,
    nick: &str,
) {
    let mut seen = Vec::new();

    connection.send("CAP LS 302").expect("send CAP LS");
    connection.send(&format!("NICK {nick}")).expect("send NICK");
    connection
        .send(&format!("USER {nick} 0 * :Marmotter integration test"))
        .expect("send USER");
    connection.send("CAP END").expect("send CAP END");

    // 001 is the server confirming registration completed.
    let welcome = wait_for(events, &mut seen, |line| line.contains(" 001 ")).await;
    assert!(
        welcome.contains(nick),
        "the welcome should name us: {welcome}"
    );

    // 005 proves ISUPPORT arrived, which is what the client adapts to.
    wait_for(events, &mut seen, |line| line.contains(" 005 ")).await;

    connection.send("JOIN #marmotter").expect("send JOIN");

    // 366 ends the NAMES burst, so the channel is fully joined.
    let end_of_names = wait_for(events, &mut seen, |line| line.contains(" 366 ")).await;
    assert!(
        end_of_names.contains("#marmotter"),
        "the names list should be for the channel we joined: {end_of_names}"
    );

    connection
        .send("PRIVMSG #marmotter :hello from the transport")
        .expect("send PRIVMSG");
}

#[tokio::test]
async fn connects_over_plaintext_and_joins_a_channel() {
    if !ergo_available() {
        eprintln!("skipping: ergo is not on PATH");
        return;
    }

    let ergo = start_ergo();
    let (connection, mut events) = connect(ConnectOptions {
        host: "127.0.0.1".into(),
        port: ergo.plaintext_port,
        security: Security::Plaintext,
        client_certificate: None,
        timeout: Duration::from_secs(10),
    })
    .await
    .expect("connect over plaintext");

    register_and_join(&connection, &mut events, "plainbot").await;
}

#[tokio::test]
async fn connects_over_tls_with_a_pinned_self_signed_certificate() {
    if !ergo_available() {
        eprintln!("skipping: ergo is not on PATH");
        return;
    }

    let ergo = start_ergo();
    let (connection, mut events) = connect(ConnectOptions {
        host: "127.0.0.1".into(),
        port: ergo.tls_port,
        security: Security::Tls(Verification::Pinned(ergo.certificate_fingerprint)),
        client_certificate: None,
        timeout: Duration::from_secs(10),
    })
    .await
    .unwrap_or_else(|error| {
        panic!(
            "connect over TLS pinned to {}: {error}",
            format_fingerprint(&ergo.certificate_fingerprint)
        )
    });

    register_and_join(&connection, &mut events, "tlsbot").await;
}

#[tokio::test]
async fn refuses_a_certificate_whose_fingerprint_does_not_match() {
    if !ergo_available() {
        eprintln!("skipping: ergo is not on PATH");
        return;
    }

    let ergo = start_ergo();
    // The pin is the whole point: a different certificate must not be accepted
    // just because it is presented by the expected host and port.
    let result = connect(ConnectOptions {
        host: "127.0.0.1".into(),
        port: ergo.tls_port,
        security: Security::Tls(Verification::Pinned([0u8; 32])),
        client_certificate: None,
        timeout: Duration::from_secs(10),
    })
    .await;

    let error = result.expect_err("a wrong pin must be rejected");
    assert_eq!(error.kind(), "tls");
    assert!(
        error.to_string().contains("fingerprint"),
        "the error should say what failed: {error}"
    );
}

#[tokio::test]
async fn refuses_a_self_signed_certificate_under_full_verification() {
    if !ergo_available() {
        eprintln!("skipping: ergo is not on PATH");
        return;
    }

    let ergo = start_ergo();
    // The default must not quietly accept a certificate no CA vouches for.
    let result = connect(ConnectOptions {
        host: "127.0.0.1".into(),
        port: ergo.tls_port,
        security: Security::Tls(Verification::Full),
        client_certificate: None,
        timeout: Duration::from_secs(10),
    })
    .await;

    assert_eq!(
        result.expect_err("full verification must reject it").kind(),
        "tls"
    );
}

#[tokio::test]
async fn accepts_the_same_certificate_when_verification_is_turned_off() {
    if !ergo_available() {
        eprintln!("skipping: ergo is not on PATH");
        return;
    }

    let ergo = start_ergo();
    let (connection, mut events) = connect(ConnectOptions {
        host: "127.0.0.1".into(),
        port: ergo.tls_port,
        security: Security::Tls(Verification::None),
        client_certificate: None,
        timeout: Duration::from_secs(10),
    })
    .await
    .expect("connect with verification off");

    register_and_join(&connection, &mut events, "insecurebot").await;
}

#[tokio::test]
async fn reports_the_connection_ending_when_the_server_goes_away() {
    if !ergo_available() {
        eprintln!("skipping: ergo is not on PATH");
        return;
    }

    let mut ergo = start_ergo();
    let (connection, mut events) = connect(ConnectOptions {
        host: "127.0.0.1".into(),
        port: ergo.plaintext_port,
        security: Security::Plaintext,
        client_certificate: None,
        timeout: Duration::from_secs(10),
    })
    .await
    .expect("connect over plaintext");

    register_and_join(&connection, &mut events, "doomedbot").await;

    // Killing the server mid-session must surface as a close, not a hang. This
    // is what the reconnection logic upstream keys off.
    let _ = ergo.child.kill();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let event = tokio::time::timeout_at(deadline, events.recv())
            .await
            .expect("the close should arrive promptly");

        match event {
            Some(Event::Closed(close)) => {
                // Either is correct: a clean FIN or a reset, depending on how
                // the operating system tears the socket down.
                assert!(
                    matches!(close, Close::Server | Close::Error(_)),
                    "unexpected close: {close:?}"
                );
                return;
            }
            Some(Event::Line(_)) => continue,
            None => panic!("the stream ended without a close event"),
        }
    }
}
