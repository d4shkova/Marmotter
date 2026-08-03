import type { ServerEndpoint } from './profile.js';

/**
 * The transport boundary, as specified in CLAUDE.md.
 *
 * `packages/client` depends on this interface and never on a concrete
 * implementation. A transport moves bytes: it knows nothing about IRC.
 */

export interface ConnectOptions {
  endpoint: ServerEndpoint;
  /** Client certificate for CertFP / SASL EXTERNAL, where the platform supports it. */
  clientCertPath?: string;
  /** Milliseconds before an unestablished connection is abandoned. */
  timeoutMs?: number;
}

export type CloseReason =
  | { kind: 'user' }
  | { kind: 'server' }
  | { kind: 'timeout' }
  | { kind: 'tls-error'; message: string }
  | { kind: 'network-error'; message: string };

/** Unsubscribes a listener registered with `onLine` or `onClose`. */
export type Unsubscribe = () => void;

export interface Transport {
  connect(opts: ConnectOptions): Promise<void>;
  /** Sends a single IRC line. The transport appends CRLF. */
  send(line: string): void;
  onLine(cb: (line: string) => void): Unsubscribe;
  onClose(cb: (reason: CloseReason) => void): Unsubscribe;
  disconnect(): void;
}
