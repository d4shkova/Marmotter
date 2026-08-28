//! Passwords, on Android.
//!
//! CLAUDE.md puts secrets in the platform's keychain and nowhere else, and on
//! Android that means a key held by the hardware-backed Android Keystore. This
//! shell does not have one yet, so it says so: `secret_available` answers
//! false, and the shell degrades to the in-memory session store it already uses
//! wherever a platform has no keychain — a bare Linux window manager, a
//! container, a browser tab.
//!
//! **That degradation is surfaced, not silent.** `SecretStore.available()` is
//! asked once and the interface tells the user their password will not be
//! remembered, which is the whole reason that method exists. A password typed
//! here lives for the session and is asked for again on the next launch.
//!
//! The alternative — a file in the app's private storage — is deliberately not
//! taken. Android's per-app sandbox and file-based encryption make it a
//! defensible place to put one, and it would still be a settings file with a
//! password in it, which is the one thing CLAUDE.md says never to write.
//! Reaching the Keystore instead means an Android plugin with a Kotlin side to
//! it; until that exists, asking again is the honest answer.

/// Whether this device has somewhere to keep a password. Not yet.
#[tauri::command]
pub const fn secret_available() -> bool {
    false
}

/// Refused, with a reason the front end can show.
///
/// The command exists so the front end has one shape on every platform. It
/// never succeeds here, and the shell does not call it once `secret_available`
/// has answered false.
#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    // Named so the signature matches the desktop command exactly; a mismatch
    // would be a runtime error on the one platform nobody tests by hand.
    let _ = (key, value);
    Err("This device has nowhere to keep a password.".to_owned())
}

/// Always nothing: there is no store to have kept anything in.
#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    let _ = key;
    Ok(None)
}

/// Nothing to forget, so forgetting it succeeds.
#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    let _ = key;
    Ok(())
}
