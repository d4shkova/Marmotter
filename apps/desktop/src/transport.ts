/**
 * The desktop app's Tauri bridge.
 *
 * `packages/client` takes its platform as an argument rather than importing it,
 * so this is the one file that knows `@tauri-apps/api` exists. The web build
 * never reaches it.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createTauriTransport, type TauriBridge } from '@marmotter/client';
import type { Transport } from '@marmotter/shared';

const bridge: TauriBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
    invoke<T>(command, args),
  listen: async <T>(event: string, handler: (event: { payload: T }) => void) => {
    const unlisten = await listen<T>(event, (received) => handler({ payload: received.payload }));
    return () => unlisten();
  },
};

/** A transport backed by the Rust socket. */
export function createDesktopTransport(): Transport {
  return createTauriTransport(bridge);
}
