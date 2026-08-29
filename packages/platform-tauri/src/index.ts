/**
 * @marmotter/platform-tauri — the platform capabilities a Tauri shell provides.
 *
 * The desktop app and the Android app are two Tauri shells over one interface.
 * Almost everything they hand the shell in `@marmotter/ui` is the same code
 * calling the same commands: a socket through Rust, the platform's notification
 * service, its keychain, a settings file, and somewhere to keep logs. That code
 * lives here so it has one implementation rather than two that drift.
 *
 * What is genuinely per-platform stays in the app. The desktop shell keeps its
 * window chrome and the DCC file monitor, neither of which Android has; the
 * Rust side of each command is implemented separately in each `src-tauri`,
 * because a keychain on Windows and a keystore on Android share nothing but the
 * command name.
 *
 * The web build imports none of this and must keep importing none of it: that
 * absence is what guarantees a browser tab cannot persist message content.
 * See CLAUDE.md.
 */

export * from './transport.js';
export * from './notifier.js';
export * from './opener.js';
export * from './preferences.js';
export * from './secrets.js';
export * from './logging/index.js';
