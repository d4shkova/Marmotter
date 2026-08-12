/**
 * Noticing that a connection has died without being closed.
 *
 * This is the half-open socket problem, and it is the reason a client can sit
 * showing "connected" for hours after the wifi dropped. When a network goes
 * away — a cable pulled, a laptop suspended, a router rebooted — nothing sends
 * a FIN or an RST. The socket stays open as far as the operating system is
 * concerned, no close event ever fires, and the client waits forever for
 * messages that cannot arrive. TCP's own keepalive is measured in hours by
 * default and is not a substitute.
 *
 * So the client asks. After a stretch of silence it sends `PING`; if nothing at
 * all comes back within the timeout, the connection is dead and is treated as
 * closed, which is what puts reconnection in motion.
 *
 * Any inbound line counts as proof of life, not just a matching `PONG`. A busy
 * channel means the connection is obviously fine and there is no reason to add
 * traffic to it, and servers send their own `PING` too — treating only our own
 * `PONG` as an answer would be stricter without being more correct.
 *
 * The timers are injected, so the whole thing is testable without waiting a
 * real minute.
 */

/** How long the connection may be silent before we ask whether it is there. */
export const DEFAULT_IDLE_MS = 60_000;

/**
 * How long we wait for any answer before calling it dead.
 *
 * Generous on purpose. A server under load, a satellite link, a laptop that has
 * just woken up — all of these can take many seconds, and declaring death too
 * early means dropping a connection that was about to answer, which the user
 * experiences as a client that disconnects at random.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface KeepaliveOptions {
  /** Sends a raw line. Only ever used to send `PING`. */
  readonly send: (line: string) => void;
  /** Called once when the connection is judged dead. */
  readonly onDead: () => void;
  readonly idleMs?: number;
  readonly timeoutMs?: number;
  /** Injected for tests. */
  readonly setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  readonly clearTimeoutFn?: (handle: unknown) => void;
}

export interface Keepalive {
  /** Begins watching. Safe to call when already started. */
  start(): void;
  /** Records that something arrived, which is what proof of life is. */
  noteActivity(): void;
  /** Stops watching and forgets any pending question. */
  stop(): void;
  /** Whether a `PING` is outstanding, for tests and the raw log. */
  readonly waiting: boolean;
}

export function createKeepalive(options: KeepaliveOptions): Keepalive {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const schedule = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
  const unschedule = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as never));

  let timer: unknown;
  let running = false;
  let waiting = false;
  /** Guards `onDead` against firing twice for one connection. */
  let dead = false;

  const cancel = (): void => {
    if (timer !== undefined) {
      unschedule(timer);
      timer = undefined;
    }
  };

  const declareDead = (): void => {
    if (dead || !running) {
      return;
    }
    dead = true;
    running = false;
    waiting = false;
    cancel();
    options.onDead();
  };

  const ask = (): void => {
    if (!running) {
      return;
    }
    waiting = true;
    // The payload is a timestamp so a `PONG` is legible in the raw log, which
    // is where somebody debugging a flaky connection will be looking. Nothing
    // reads it back: any inbound line is the answer.
    options.send(`PING :marmotter-${Date.now()}`);
    timer = schedule(declareDead, timeoutMs);
  };

  const waitForSilence = (): void => {
    cancel();
    if (!running) {
      return;
    }
    waiting = false;
    timer = schedule(ask, idleMs);
  };

  return {
    get waiting(): boolean {
      return waiting;
    },

    start(): void {
      if (running) {
        return;
      }
      running = true;
      dead = false;
      waitForSilence();
    },

    noteActivity(): void {
      if (!running) {
        return;
      }
      // Whatever arrived answers whatever was outstanding. Back to waiting for
      // the next stretch of silence.
      waitForSilence();
    },

    stop(): void {
      running = false;
      waiting = false;
      // Not `dead`: stopping is deliberate, and a keepalive that is started
      // again is watching a new connection.
      dead = false;
      cancel();
    },
  };
}
