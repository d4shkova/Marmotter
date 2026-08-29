//! The Tauri commands the desktop and Android shells share.
//!
//! Both apps are a Tauri shell over the same interface, and most of what the
//! front end asks the shell for is the same request on both: open a socket,
//! append to a log file, read the settings file, decide whether a link may be
//! opened. That code lives here so it has one implementation, which is the same
//! reasoning that puts the TypeScript side of it in `@marmotter/platform-tauri`.
//!
//! What is genuinely per-platform stays in each app's own `src-tauri`: the
//! keychain, because a Windows credential store and an Android keystore share
//! nothing but the command name, and the thing that actually opens a link.
//!
//! No module here parses IRC. All protocol logic is TypeScript, in
//! `packages/protocol`.

pub mod dcc;
pub mod links;
pub mod logstore;
pub mod prefs;
pub mod textfile;
pub mod transport;
