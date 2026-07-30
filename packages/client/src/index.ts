/**
 * @marmotter/client — connection lifecycle and event-to-state reduction.
 *
 * Consumes `@marmotter/protocol` events plus a `Transport` and produces
 * observable per-network state. No React, no direct socket access.
 *
 * Phase 2 of BUILD_PLAN.md adds the transport implementations and reconnection;
 * Phase 3 adds the Zustand stores, keyed by network ID from the outset.
 */

export type { CloseReason, ConnectOptions, Transport, Unsubscribe } from '@marmotter/shared';
