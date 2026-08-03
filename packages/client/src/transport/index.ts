/**
 * Transport implementations.
 *
 * `packages/client` depends on the `Transport` interface from
 * `@marmotter/shared`; these are the concrete ones an app picks between. The
 * desktop app uses `createTauriTransport`, the web app uses
 * `createWebSocketTransport` for networks that expose a WebSocket listener, and
 * the relay transport arrives in Phase 8 for those that do not.
 *
 * Each takes its platform as an argument rather than importing it, so the web
 * bundle never pulls in Tauri and every one is testable without its platform.
 */

export * from './listeners.js';
export * from './tauri.js';
export * from './websocket.js';
export * from './reconnecting.js';
