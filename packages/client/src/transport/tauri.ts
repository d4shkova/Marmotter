/**
 * The desktop transport: a Tauri command opens a real socket in Rust.
 *
 * The Tauri API is injected rather than imported, for two reasons. The web
 * build must not pull `@tauri-apps/api` into its bundle, and a transport that
 * takes its platform as an argument can be tested with a fake bridge instead of
 * a running webview.
 */

import type { CloseReason, ConnectOptions, Transport, Unsubscribe } from '@marmotter/shared';
import { Listeners } from './listeners.js';

/** The slice of Tauri this transport needs. */
export interface TauriBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<Unsubscribe>;
  /** Reads a client certificate from disk, for CertFP. */
  readTextFile?(path: string): Promise<string>;
}

export const LINE_EVENT = 'marmotter://line';
export const CLOSE_EVENT = 'marmotter://close';

interface LinePayload {
  readonly id: string;
  readonly line: string;
}

interface ClosePayload {
  readonly id: string;
  readonly kind: string;
  readonly message: string;
}

/** Turns the Rust close payload back into the shared union. */
const toCloseReason = (payload: ClosePayload): CloseReason => {
  switch (payload.kind) {
    case 'user':
      return { kind: 'user' };
    case 'server':
      return { kind: 'server' };
    case 'timeout':
      return { kind: 'timeout' };
    case 'tls-error':
      return { kind: 'tls-error', message: payload.message };
    default:
      return { kind: 'network-error', message: payload.message };
  }
};

/**
 * Builds the argument the `transport_connect` command expects.
 *
 * The endpoint's `websocket` mode has no meaning here — the desktop app always
 * opens a real socket — so it is rejected rather than silently treated as
 * plaintext.
 */
const toRequest = async (
  options: ConnectOptions,
  bridge: TauriBridge,
): Promise<Record<string, unknown>> => {
  const { endpoint } = options;

  if (endpoint.tls.mode === 'websocket') {
    throw new Error('The desktop transport cannot use a WebSocket endpoint.');
  }

  const tls =
    endpoint.tls.mode === 'off'
      ? { mode: 'off' }
      : {
          mode: 'tls',
          verifyCert: endpoint.tls.verifyCert,
          pinnedFingerprint:
            endpoint.tls.verifyCert === false ? (endpoint.tls.pinnedFingerprint ?? null) : null,
        };

  let clientCertificate: { certificatePem: string; keyPem: string } | null = null;
  if (options.clientCertPath !== undefined && options.clientCertPath !== '') {
    if (bridge.readTextFile === undefined) {
      throw new Error('This platform cannot read a client certificate.');
    }
    // Both halves commonly live in one PEM file; the Rust side reads whichever
    // parts it finds in each.
    const contents = await bridge.readTextFile(options.clientCertPath);
    clientCertificate = { certificatePem: contents, keyPem: contents };
  }

  return {
    host: endpoint.host,
    port: endpoint.port,
    tls,
    clientCertificate,
    timeoutMs: options.timeoutMs ?? null,
  };
};

/** A transport backed by the Rust socket in `crates/marmotter-transport`. */
export function createTauriTransport(bridge: TauriBridge): Transport {
  const lines = new Listeners<string>();
  const closes = new Listeners<CloseReason>();

  let connectionId: string | undefined;
  let unlisten: Unsubscribe[] = [];
  let closed = false;

  const teardown = (): void => {
    for (const stop of unlisten) {
      stop();
    }
    unlisten = [];
    connectionId = undefined;
  };

  return {
    async connect(options: ConnectOptions): Promise<void> {
      if (connectionId !== undefined) {
        throw new Error('This transport is already connected.');
      }
      closed = false;

      const request = await toRequest(options, bridge);

      // Subscribing before connecting would mean filtering on an id we do not
      // have yet; subscribing after means the first lines could be missed.
      // Tauri buffers nothing, so the id has to come first — and Rust does not
      // start reading until the command returns.
      const id = await bridge.invoke<string>('transport_connect', { request });
      connectionId = id;

      unlisten = await Promise.all([
        bridge.listen<LinePayload>(LINE_EVENT, ({ payload }) => {
          if (payload.id === id) {
            lines.emit(payload.line);
          }
        }),
        bridge.listen<ClosePayload>(CLOSE_EVENT, ({ payload }) => {
          if (payload.id !== id || closed) {
            return;
          }
          closed = true;
          const reason = toCloseReason(payload);
          teardown();
          closes.emit(reason);
        }),
      ]);
    },

    send(line: string): void {
      if (connectionId === undefined) {
        throw new Error('The connection is not open.');
      }
      // Fire and forget: the Rust side queues, and a failure surfaces as a
      // close event rather than as a rejected promise nobody is awaiting.
      void bridge
        .invoke('transport_send', { id: connectionId, line })
        .catch((error: unknown) => console.error('sending failed', error));
    },

    onLine: (callback) => lines.add(callback),
    onClose: (callback) => closes.add(callback),

    disconnect(): void {
      const id = connectionId;
      if (id === undefined || closed) {
        return;
      }
      closed = true;
      teardown();
      void bridge
        .invoke('transport_disconnect', { id })
        .catch((error: unknown) => console.error('disconnecting failed', error));
      closes.emit({ kind: 'user' });
    },
  };
}
