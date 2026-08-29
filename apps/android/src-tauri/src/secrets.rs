//! Passwords, in the Android Keystore.
//!
//! CLAUDE.md puts secrets in the platform's keychain and nowhere else. On
//! Android that is the Keystore: a key the app never sees, held by the
//! platform and where the device has one by hardware, used to encrypt the
//! values before they touch storage. The Kotlin side is
//! `SecretsPlugin.kt`, which wraps `EncryptedSharedPreferences`; this is the
//! Rust half that the front end's `secret_*` commands land in.
//!
//! The split is the same one the rest of the shell follows. Kotlin owns the
//! keystore and knows nothing about what it is holding; the front end decides
//! what is filed under which key. Neither side knows what a network or a
//! password is.
//!
//! **Every operation may legitimately fail, and none of them are fatal.** A
//! device with no secure lock screen has no key to derive, and a keystore can
//! be invalidated wholesale when the user changes their lock screen — Android
//! documents that, and it means a value that was readable yesterday may not be
//! today. The answer to all of it is the same as on a Linux box with no Secret
//! Service: `secret_available` answers false, the interface says passwords will
//! not be remembered, and the client asks again. Never a silent failure that
//! looks like a forgotten password.

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

// Everything from here to `init` crosses to Kotlin and exists only where there
// is a Kotlin side to cross to. A host build compiles none of it and behaves
// exactly as a device whose keystore will not open.

/// The Kotlin package the plugin class lives in. Matches `AndroidManifest.xml`.
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "uk.co.dashkova.marmotter";

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyPayload<'a> {
    key: &'a str,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetPayload<'a> {
    key: &'a str,
    value: &'a str,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct ValueResponse {
    /// Absent where nothing is filed under the key.
    value: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct AvailableResponse {
    available: bool,
}

/// The handle on the Kotlin plugin, or nothing on a platform that has none.
///
/// A development build of this crate runs on the host, where there is no
/// activity to register a plugin against. It behaves there exactly as an
/// Android device with no usable keystore does, which is a state the client
/// already handles.
#[cfg(target_os = "android")]
struct Secrets<R: Runtime>(PluginHandle<R>);

/// Registers the Kotlin side and makes it reachable from the commands.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("marmotter-secrets")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "SecretsPlugin")?;
                _app.manage(Secrets(handle));
            }
            Ok(())
        })
        .build()
}

/// Calls one of the Kotlin plugin's commands.
///
/// Off Android there is no plugin, and every caller treats that the same way it
/// treats a device whose keystore will not open.
#[cfg(target_os = "android")]
fn call<R: Runtime, T: serde::de::DeserializeOwned>(
    app: &tauri::AppHandle<R>,
    command: &str,
    payload: impl Serialize,
) -> Result<T, String> {
    app.state::<Secrets<R>>()
        .0
        .run_mobile_plugin::<T>(command, payload)
        .map_err(|error| format!("The device would not unlock its keystore: {error}"))
}

/// Whether this device has somewhere to keep a password.
///
/// False where there is no secure lock screen to derive a key from, or where
/// the keystore refuses for any other reason. Asked once, so the interface can
/// say up front that a password will not be remembered rather than letting
/// somebody find out on the next launch.
#[tauri::command]
pub fn secret_available<R: Runtime>(app: tauri::AppHandle<R>) -> bool {
    #[cfg(target_os = "android")]
    {
        call::<R, AvailableResponse>(&app, "available", ())
            .map(|response| response.available)
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        false
    }
}

/// Puts a secret in the keystore under a key.
#[tauri::command]
pub fn secret_set<R: Runtime>(
    app: tauri::AppHandle<R>,
    key: String,
    value: String,
) -> Result<(), String> {
    if key.is_empty() {
        return Err("A secret needs a key.".to_owned());
    }
    #[cfg(target_os = "android")]
    {
        call::<R, ()>(
            &app,
            "set",
            SetPayload {
                key: &key,
                value: &value,
            },
        )
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, value);
        Err("This device has nowhere to keep a password.".to_owned())
    }
}

/// The secret a key opens, or nothing if the keystore is not holding one.
#[tauri::command]
pub fn secret_get<R: Runtime>(
    app: tauri::AppHandle<R>,
    key: String,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        call::<R, ValueResponse>(&app, "get", KeyPayload { key: &key }).map(|it| it.value)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, key);
        Ok(None)
    }
}

/// Forgets what a key opens. Forgetting something absent is not a failure.
#[tauri::command]
pub fn secret_delete<R: Runtime>(app: tauri::AppHandle<R>, key: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        call::<R, ()>(&app, "delete", KeyPayload { key: &key })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, key);
        Ok(())
    }
}
