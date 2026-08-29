//! Staying connected while the app is not in front.
//!
//! Android will freeze a backgrounded process and then reclaim it, and a frozen
//! process is one whose sockets stop being read — so an IRC connection outlives
//! the app going away only if the app is running a foreground service. That is
//! the platform's rule, not a workaround for it: the service exists so the user
//! can see, in their notification shade, that something is holding a connection
//! open on their behalf, and stop it.
//!
//! The front end says how many networks are connected; this passes that to the
//! Kotlin side, which starts the service on the first one and stops it on the
//! last. Nothing here decides policy — see `apps/android/src/connection.ts`.
//!
//! **What this does not do.** It does not promise delivery. Android may still
//! stop the service under memory pressure or a battery saver, and a doze window
//! will suspend the network long before it stops the process. Somebody who
//! needs messages to arrive reliably wants a bouncer — their own ZNC or soju,
//! added as an ordinary network profile — and the app says so rather than
//! implying a phone can be relied on for it. See `docs/BUILDING.md`.

#[cfg(target_os = "android")]
use serde::Serialize;

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// The Kotlin package the plugin class lives in. Matches `AndroidManifest.xml`.
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "uk.co.dashkova.marmotter";

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldPayload {
    connected: u32,
}

#[cfg(target_os = "android")]
struct Connection<R: Runtime>(PluginHandle<R>);

/// Registers the Kotlin side that owns the service.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("marmotter-connection")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "ConnectionPlugin")?;
                _app.manage(Connection(handle));
            }
            Ok(())
        })
        .build()
}

/// Says how many networks are connected, so the service can start or stop.
///
/// Zero stops it. The command never fails the caller: a phone that refuses to
/// run the service is a phone that drops the connection sooner, which is a
/// worse experience and not an error the user can do anything about mid-session
/// — the notification's absence is what tells them.
#[tauri::command]
pub fn connection_hold<R: Runtime>(app: tauri::AppHandle<R>, connected: u32) {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<Connection<R>>();
        if let Err(error) = state
            .0
            .run_mobile_plugin::<()>("hold", HoldPayload { connected })
        {
            log::warn!("could not update the connection service: {error}");
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, connected);
    }
}
