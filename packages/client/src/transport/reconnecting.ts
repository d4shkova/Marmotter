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
import { connectErrorReason } from './connect-error.js';
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

/**
 * How many times a dropped connection is retried. Not a small number.
 *
 * This used to be three, on the reasoning that a client which retries quietly
 * forever is one that looks busy while it is dead. The reasoning was right and
 * the number was wrong: with the backoff below, three attempts are spent one,
 * two and four seconds after the drop, so the client gives up seven seconds
 * into an outage. Almost nothing real is over in seven seconds — a wifi
 * handover, a laptop waking, a router rebooting, a phone moving between cells
 * are all tens of seconds at least — so in practice every drop became permanent
 * and reconnection never actually reconnected anything.
 *
 * So it retries for as long as the profile asks it to, and the backoff is what
 * keeps that polite: the delay doubles to a five-minute ceiling, so an outage
 * lasting all afternoon costs a handful of connection attempts an hour, not a
 * flood. What the old number was protecting — that somebody is told rather than
 * left watching a window — is `ATTEMPTS_BEFORE_NOTICE` below, which is a notice
 * rather than a surrender.
 */
export const DEFAULT_MAX_ATTEMPTS = Number.POSITIVE_INFINITY;

/**
 * How many attempts pass before the interface says something.
 *
 * The first few failures are the ordinary ones and are not worth a word: a
 * connection that comes back within a few seconds should look like nothing
 * happened. Past that it is an outage the person can see the effects of, and
 * saying so — while continuing to retry — is the difference between a client
 * that is working on it and a client that appears to have stopped caring.
 */
export const ATTEMPTS_BEFORE_NOTICE = 3;

/**
 * How long a connection must last to count as having worked.
 *
 * Unbounded retrying needs this. A server that accepts a socket and drops it
 * immediately — a full network, a ban, a load balancer in front of nothing —
 * would otherwise reset the backoff on every attempt, and the client would
 * reconnect once a second forever, which is a denial of service written by
 * accident. A connection shorter than this is treated as a failed attempt in
 * the same round, so the delay keeps growing.
 */
export const STABLE_CONNECTION_MS = 30_000;

/**
 * How long an attempt may take before it is abandoned.
 *
 * A default rather than nothing, because "nothing" is not "the platform's
 * sensible default": a `WebSocket` opening towards a network that is
 * black-holing packets never fails and never opens, so the web build sat in
 * `connecting` indefinitely and no retry was ever scheduled. The Rust transport
 * has its own timeout; this makes the browser behave the same way.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

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
  /**
   * Attempts before giving up and reporting a close. Unbounded by default.
   *
   * A finite number turns a long outage into a permanent disconnection, which
   * is what this defaults away from; it is here for tests and for a caller that
   * genuinely wants one shot.
   */
  readonly maxAttempts?: number;
  readonly backoff?: BackoffPolicy;
  readonly timeoutMs?: number;
  readonly clientCertPath?: string;
  /** Injected for tests. */
  readonly setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  readonly clearTimeoutFn?: (handle: unknown) => void;
  readonly random?: () => number;
  readonly now?: () => number;
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
  /**
   * Reports that the connection is dead although the socket has not said so.
   *
   * The half-open case: the network went away without anything being closed, so
   * no close event will ever arrive and the keepalive noticed the silence. This
   * puts the same machinery in motion that a real close would.
   */
  dropped(reason: CloseReason): void;
  /**
   * Tries again now, abandoning the rest of the backoff wait.
   *
   * For the "Try again" the interface offers, and for the moment the operating
   * system says the network is back: waiting out four more minutes of a delay
   * calculated before the cable was plugged back in is the client looking
   * broken for no reason. Ignored unless a retry is actually pending.
   */
  retryNow(): void;
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
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const schedule = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
  const unschedule = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as never));
  const random = options.random ?? Math.random;
  const now = options.now ?? ((): number => Date.now());
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  let state: ConnectionState = { kind: 'idle' };
  let active: Transport | undefined;
  let unsubscribe: Unsubscribe[] = [];
  let timer: unknown;
  let attempt = 0;
  let endpointIndex = 0;
  let stopped = false;
  /** When the current connection was established, for the stability check. */
  let connectedAt: number | undefined;

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
    // Out of attempts. Reported as a close, which is what the session and the
    // interface already know how to react to — and what puts a "try again" in
    // front of somebody rather than leaving them watching a dead window.
    if (attempt > maxAttempts) {
      stop(reason);
      return;
    }
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
    // A connection that stood up for a while earns a fresh round of backoff.
    // One that fell over immediately does not: see `STABLE_CONNECTION_MS`.
    if (connectedAt !== undefined && now() - connectedAt >= STABLE_CONNECTION_MS) {
      attempt = 0;
      endpointIndex = 0;
    }
    connectedAt = undefined;
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
      timeoutMs,
      ...(options.clientCertPath === undefined ? {} : { clientCertPath: options.clientCertPath }),
    };

    try {
      await transport.connect(connectOptions);
      if (stopped) {
        // Disconnected while the handshake was in flight.
        transport.disconnect();
        return;
      }
      connectedAt = now();
      setState({ kind: 'connected', endpoint });
    } catch (error) {
      detach();
      if (stopped) {
        return;
      }
      // The classification the transport made, kept. A rejected certificate
      // arrives as a `TransportConnectError` carrying `tls-error`, and
      // flattening that into a generic network failure is precisely what stops
      // the interface offering to trust it — the certificate failure ends up
      // looking identical to the server being down. It also makes the failure
      // look retryable when it is not: `isPermanent` reads this kind, and a
      // certificate does not change between attempts.
      const reason: CloseReason = connectErrorReason(error) ?? {
        kind: 'network-error',
        message: error instanceof Error ? error.message : String(error),
      };
      if (!options.autoReconnect || isPermanent(reason)) {
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
      connectedAt = undefined;
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

    retryNow(): void {
      if (stopped || state.kind !== 'waiting') {
        return;
      }
      cancelTimer();
      // The attempt count is kept: this is the same round arriving early, not a
      // fresh start, and resetting it would restart the backoff from a second
      // on every click.
      void attemptConnect();
    },

    dropped(reason: CloseReason): void {
      if (stopped || state.kind !== 'connected') {
        return;
      }
      // Tear the socket down before retrying. It is not going to close on its
      // own — that is the whole problem — and leaving it open would leak a
      // handle per drop, which on a flaky link is a handle every few minutes.
      const current = active;
      detach();
      current?.disconnect();
      handleClose(reason);
    },

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
