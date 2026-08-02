/**
 * The web transport: a direct WebSocket to a network that exposes one.
 *
 * UnrealIRCd, ergo, and InspIRCd can all listen for WebSocket connections, so
 * for those networks the browser reaches the server with nothing in between.
 * Networks without a WebSocket listener need the relay, which arrives in
 * Phase 8.
 *
 * The `WebSocket` constructor is injected so the transport can be tested
 * without a browser.
 */

import type { CloseReason, ConnectOptions, Transport } from '@marmotter/shared';
import { Listeners } from './listeners.js';

/** The slice of the WebSocket API this transport uses. */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null;
}

export type WebSocketFactory = (url: string, protocols?: readonly string[]) => WebSocketLike;

/**
 * Subprotocols an IRC WebSocket listener may offer.
 *
 * `text.ircv3.net` frames each message as one text frame, which is what we
 * want; the binary variant exists for servers that pass bytes through. We ask
 * for text and split defensively anyway, because a server is free to ignore the
 * request and batch several messages into one frame.
 */
export const IRC_SUBPROTOCOLS = ['text.ircv3.net'] as const;

/** Normal closure, per RFC 6455. */
const NORMAL_CLOSURE = 1000;

export function createWebSocketTransport(factory: WebSocketFactory): Transport {
  const lines = new Listeners<string>();
  const closes = new Listeners<CloseReason>();

  let socket: WebSocketLike | undefined;
  let settled = false;

  const finish = (reason: CloseReason): void => {
    if (settled) {
      return;
    }
    settled = true;
    socket = undefined;
    closes.emit(reason);
  };

  return {
    connect(options: ConnectOptions): Promise<void> {
      if (socket !== undefined) {
        return Promise.reject(new Error('This transport is already connected.'));
      }

      const { tls } = options.endpoint;
      if (tls.mode !== 'websocket') {
        return Promise.reject(
          new Error('The WebSocket transport needs an endpoint with a wss:// URL.'),
        );
      }
      settled = false;

      return new Promise<void>((resolve, reject) => {
        let opened = false;
        const timeoutMs = options.timeoutMs;

        const created = factory(tls.url, IRC_SUBPROTOCOLS);
        socket = created;

        const timer =
          timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                if (!opened) {
                  created.close();
                  finish({ kind: 'timeout' });
                  reject(new Error('The server did not answer in time.'));
                }
              }, timeoutMs);

        const clearTimer = (): void => {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
        };

        created.onopen = () => {
          opened = true;
          clearTimer();
          resolve();
        };

        created.onmessage = ({ data }) => {
          if (typeof data !== 'string') {
            // A binary frame from a server that ignored the subprotocol. The
            // browser hands it back as a Blob or ArrayBuffer; rather than
            // guessing, ignore it and let the raw log show nothing arrived.
            return;
          }
          // A frame may hold several messages even under the text subprotocol.
          for (const line of data.split(/\r?\n/)) {
            if (line !== '') {
              lines.emit(line);
            }
          }
        };

        created.onerror = () => {
          clearTimer();
          if (!opened) {
            finish({ kind: 'network-error', message: 'The connection could not be opened.' });
            reject(new Error('The connection could not be opened.'));
          }
          // After opening, `onclose` follows and carries the detail.
        };

        created.onclose = ({ code, reason, wasClean }) => {
          clearTimer();
          if (!opened) {
            finish({ kind: 'network-error', message: reason || 'The connection was refused.' });
            reject(new Error(reason || 'The connection was refused.'));
            return;
          }
          finish(
            wasClean && code === NORMAL_CLOSURE
              ? { kind: 'server' }
              : { kind: 'network-error', message: reason || `The connection closed (${code}).` },
          );
        };
      });
    },

    send(line: string): void {
      if (socket === undefined) {
        throw new Error('The connection is not open.');
      }
      // The server splits on CRLF, so it is appended here for the same reason
      // the Rust transport appends it: no caller can forget it.
      socket.send(`${line}\r\n`);
    },

    onLine: (callback) => lines.add(callback),
    onClose: (callback) => closes.add(callback),

    disconnect(): void {
      const open = socket;
      if (open === undefined || settled) {
        return;
      }
      settled = true;
      socket = undefined;
      open.close(NORMAL_CLOSURE, 'client disconnect');
      closes.emit({ kind: 'user' });
    },
  };
}
