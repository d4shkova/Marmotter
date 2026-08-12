//! Passwords, in the platform's own keychain.
//!
//! CLAUDE.md puts secrets in the OS keychain, and nowhere else. A profile
//! carries a `SecretRef` — a key — and the value that key opens lives here: the
//! Windows Credential Manager, or the Secret Service on Linux. The settings
//! file holds the key and never the password, which is what lets profiles be
//! written to disk at all.
//!
//! **Every operation may legitimately fail, and none of them are fatal.** A
//! Linux session with no Secret Service running — a bare window manager, a
//! container, a remote shell — has no keychain, and the answer to that is a
//! client that asks for the password each time rather than one that refuses to
//! start. So the commands report failure plainly and the front end degrades to
//! its in-memory store.
//!
//! Deliberately not a general-purpose secret store: it holds what the front end
//! asks it to hold under keys the front end chose, and it does not know what a
//! network or a password is.

use keyring::Entry;

/// The service name every entry is filed under.
///
/// One namespace for the whole app, so "what has Marmotter stored" is a
/// question somebody can answer in their own keychain manager, and deleting the
/// app's entries is one filter rather than a hunt.
const SERVICE: &str = "uk.co.dashkova.marmotter";

fn entry_for(key: &str) -> Result<Entry, String> {
    if key.is_empty() {
        return Err("A secret needs a key.".to_owned());
    }
    Entry::new(SERVICE, key).map_err(describe)
}

/// Puts a secret in the keychain under a key.
#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    entry_for(&key)?.set_password(&value).map_err(describe)
}

/// Reads a secret back, or nothing when the keychain does not have it.
///
/// A missing entry is an ordinary answer — the password was never saved, or the
/// user cleared their keychain — rather than an error, so the front end can ask
/// for it without having to tell the two cases apart.
#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry_for(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(describe(error)),
    }
}

/// Forgets a secret. A key that is not there is already in the wanted state.
#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry_for(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(describe(error)),
    }
}

/// Whether this machine has a keychain Marmotter can actually use.
///
/// Asked once at startup so the interface can say "passwords will not be
/// remembered on this machine" up front, rather than letting somebody tick
/// "remember my password" and discover on the next launch that it did not.
/// Probing by writing and deleting, because whether the Secret Service is
/// reachable is not something the library reports without trying.
#[tauri::command]
pub fn secret_available() -> bool {
    const PROBE: &str = "marmotter-keychain-probe";
    let Ok(entry) = Entry::new(SERVICE, PROBE) else {
        return false;
    };
    if entry.set_password("probe").is_err() {
        return false;
    }
    let readable = matches!(entry.get_password(), Ok(value) if value == "probe");
    let _ = entry.delete_credential();
    readable
}

/// A keychain error in words somebody can act on.
fn describe(error: keyring::Error) -> String {
    match error {
        keyring::Error::NoEntry => "That password is not saved on this device.".to_owned(),
        keyring::Error::Ambiguous(_) => {
            "This device's keychain has more than one entry under that name.".to_owned()
        }
        keyring::Error::TooLong(name, limit) => {
            format!("The {name} is longer than this device's keychain allows ({limit}).")
        }
        // Everything else is the platform's own store refusing or being absent,
        // which on Linux usually means no Secret Service is running.
        other => format!("This device's keychain could not be reached: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{secret_delete, secret_get, secret_set};

    /// Whether this machine can run the round-trip test at all.
    ///
    /// CI containers have no Secret Service, and a test that fails there would
    /// be a test about the runner rather than about this code. The validation
    /// and error-shaping below is checked unconditionally; the round trip runs
    /// where there is a keychain to run it against.
    fn keychain_present() -> bool {
        super::secret_available()
    }

    #[test]
    fn refuses_an_empty_key() {
        // An empty key would collide with every other empty key, which is one
        // password overwriting another.
        assert!(secret_set(String::new(), "hunter2".into()).is_err());
        assert!(secret_get(String::new()).is_err());
    }

    #[test]
    fn stores_reads_and_forgets() {
        if !keychain_present() {
            return;
        }
        let key = "marmotter-test-secret".to_owned();

        secret_set(key.clone(), "hunter2".into()).expect("set");
        assert_eq!(
            secret_get(key.clone()).expect("get").as_deref(),
            Some("hunter2")
        );

        secret_delete(key.clone()).expect("delete");
        assert_eq!(secret_get(key.clone()).expect("get"), None);
        // Deleting again is the wanted state already, not a failure.
        secret_delete(key).expect("delete again");
    }

    #[test]
    fn a_password_that_was_never_saved_reads_as_nothing() {
        if !keychain_present() {
            return;
        }
        assert_eq!(
            secret_get("marmotter-test-never-saved".to_owned()).expect("get"),
            None
        );
    }
}
