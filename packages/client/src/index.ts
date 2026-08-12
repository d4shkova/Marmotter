/**
 * @marmotter/client — connection lifecycle and event-to-state reduction.
 *
 * Consumes `@marmotter/protocol` events plus a `Transport` and produces
 * observable per-network state. No React, no direct socket access.
 *
 * Phase 2 added the transport implementations, reconnection, and endpoint
 * failover. Phase 3 adds the per-network state, its reducer, the session that
 * drives both, and the registry keyed by network ID.
 */

export type { CloseReason, ConnectOptions, Transport, Unsubscribe } from '@marmotter/shared';
export * from './transport/index.js';
export * from './state/index.js';
export * from './logging/index.js';
export * from './session.js';
export * from './store.js';
