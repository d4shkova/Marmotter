/**
 * Reconnection, endpoint failover, and backoff.
 *
 * A network profile lists its servers in order. When a connection drops, the
 * client works down that list, waiting longer between rounds so a network that
 * is genuinely down does not get hammered by every Marmotter instance at once.
 *
 * The jitter matters more than it looks. Without it, everyone disconnected by
 * the same netsplit reconnects in lockstep, and the thundering herd is
 * indistinguishable from an attack.
 *
 * This wraps a `Transport` and is itself a `Transport`, so nothing above it
 * needs to know reconnection exists.
 */

import type {
  CloseReason,
  ConnectOptions,
  ServerEndpoint,
  Transport,
  Unsubscribe,
} from '@marmotter/shared';
import { Listeners } from './listeners.js';

export interface BackoffPolicy {
  /** Delay before the first retry. */
  readonly initialMs: number;
  /** Ceiling for the delay, before jitter. */
  readonly maxMs: number;
  /** Multiplier applied after each failed round. */
  readonly factor: number;
  /**
   * Fraction of the delay to randomise, 0 to 1.
   *
   * At 0.5 the actual wait is uniform across half the computed delay either
   * side of it, which is enough to break up a synchronised herd.
   */
  readonly jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  initialMs: 1_000,
  maxMs: 5 * 60_000,
  factor: 2,
  jitter: 0.5,
};

/** Computes the wait before a given attempt, jitter included. */
export function backoffDelay(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const exponential = policy.initialMs * policy.factor ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, policy.maxMs);
  const spread = capped * policy.jitter;
  // Centre the jitter on the computed delay, and never return a negative wait.
  return Math.max(0, Math.round(capped - spread / 2 + random() * spread));
}

export type ConnectionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'connecting'; readonly endpoint: ServerEndpoint; readonly attempt: number }
  | { readonly kind: 'connected'; readonly endpoint: ServerEndpoint }
  /** Waiting out the backoff before the next attempt. */
  | {
      readonly kind: 'waiting';
      readonly attempt: number;
      readonly delayMs: number;
      readonly reason: CloseReason;
    }
  /** Stopped for good: the user asked, or reconnection is off. */
  | { readonly kind: 'stopped'; readonly reason: CloseReason };

export interface ReconnectingOptions {
  /** Tried in order, then from the top again on the next round. */
  readonly endpoints: readonly ServerEndpoint[];
  /** Builds a fresh transport per attempt. A used one is never reconnected. */
  readonly createTransport: (endpoint: ServerEndpoint) => Transport;
  readonly autoReconnect: boolean;
  readonly backoff?: BackoffPolicy;
  readonly timeoutMs?: number;
  readonly clientCertPath?: string;
  /** Injected for tests. */
  readonly setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  readonly clearTimeoutFn?: (handle: unknown) => void;
  readonly random?: () => number;
}

/**
 * A `Transport` that owns its own endpoints.
 *
 * `connect` takes no argument: the endpoint list, timeout, and client
 * certificate come from the options this was built with, because the wrapper
 * chooses which endpoint each attempt uses. Accepting one anyway would suggest
 * a caller could steer that, which it cannot. The optional parameter keeps it
 * assignable to `Transport`, so nothing above needs to know.
 */
export interface ReconnectingTransport extends Omit<Transport, 'connect'> {
  connect(options?: ConnectOptions): Promise<void>;
  /** Current state, for the connection indicator in the sidebar. */
  readonly state: ConnectionState;
  onStateChange(callback: (state: ConnectionState) => void): Unsubscribe;
}

/**
 * A close the client should not retry.
 *
 * Retrying a TLS failure just fails identically every second: the certificate
 * will not have changed. Surface it and let the user fix the profile.
 */
const isPermanent = (reason: CloseReason): boolean =>
  reason.kind === 'user' || reason.kind === 'tls-error';

export function createReconnectingTransport(options: ReconnectingOptions): ReconnectingTransport {
  const lines = new Listeners<string>();
  const closes = new Listeners<CloseReason>();
  const states = new Listeners<ConnectionState>();

  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const schedule = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
  const unschedule = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as never));
  const random = options.random ?? Math.random;

  let state: ConnectionState = { kind: 'idle' };
  let active: Transport | undefined;
  let unsubscribe: Unsubscribe[] = [];
  let timer: unknown;
  let attempt = 0;
  let endpointIndex = 0;
  let stopped = false;

  const setState = (next: ConnectionState): void => {
    state = next;
    states.emit(next);
  };

  const detach = (): void => {
    for (const stop of unsubscribe) {
      stop();
    }
    unsubscribe = [];
    active = undefined;
  };

  const cancelTimer = (): void => {
    if (timer !== undefined) {
      unschedule(timer);
      timer = undefined;
    }
  };

  const stop = (reason: CloseReason): void => {
    stopped = true;
    cancelTimer();
    detach();
    setState({ kind: 'stopped', reason });
    closes.emit(reason);
  };

  const scheduleRetry = (reason: CloseReason): void => {
    attempt += 1;
    // Move to the next endpoint every attempt, wrapping around. A profile with
    // one endpoint simply retries it.
    endpointIndex = (endpointIndex + 1) % Math.max(1, options.endpoints.length);

    const delayMs = backoffDelay(attempt, backoff, random);
    setState({ kind: 'waiting', attempt, delayMs, reason });

    timer = schedule(() => {
      timer = undefined;
      void attemptConnect();
    }, delayMs);
  };

  const handleClose = (reason: CloseReason): void => {
    detach();
    if (stopped) {
      return;
    }
    if (!options.autoReconnect || isPermanent(reason)) {
      stop(reason);
      return;
    }
    scheduleRetry(reason);
  };

  const attemptConnect = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    const endpoint = options.endpoints[endpointIndex];
    if (endpoint === undefined) {
      stop({ kind: 'network-error', message: 'This network has no servers configured.' });
      return;
    }

    setState({ kind: 'connecting', endpoint, attempt });

    const transport = options.createTransport(endpoint);
    active = transport;
    unsubscribe = [transport.onLine((line) => lines.emit(line)), transport.onClose(handleClose)];

    const connectOptions: ConnectOptions = {
      endpoint,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.clientCertPath === undefined ? {} : { clientCertPath: options.clientCertPath }),
    };

    try {
      await transport.connect(connectOptions);
      if (stopped) {
        // Disconnected while the handshake was in flight.
        transport.disconnect();
        return;
      }
      attempt = 0;
      setState({ kind: 'connected', endpoint });
    } catch (error) {
      detach();
      if (stopped) {
        return;
      }
      const reason: CloseReason = {
        kind: 'network-error',
        message: error instanceof Error ? error.message : String(error),
      };
      if (!options.autoReconnect) {
        stop(reason);
        return;
      }
      scheduleRetry(reason);
    }
  };

  return {
    get state(): ConnectionState {
      return state;
    },

    async connect(): Promise<void> {
      stopped = false;
      attempt = 0;
      endpointIndex = 0;
      await attemptConnect();
    },

    send(line: string): void {
      if (active === undefined || state.kind !== 'connected') {
        throw new Error('The connection is not open.');
      }
      active.send(line);
    },

    onLine: (callback) => lines.add(callback),
    onClose: (callback) => closes.add(callback),
    onStateChange: (callback) => states.add(callback),

    disconnect(): void {
      if (stopped) {
        return;
      }
      const current = active;
      stopped = true;
      cancelTimer();
      detach();
      // Tell the underlying transport before announcing, so a close event it
      // emits in response is ignored rather than starting a retry.
      current?.disconnect();
      setState({ kind: 'stopped', reason: { kind: 'user' } });
      closes.emit({ kind: 'user' });
    },
  };
}
