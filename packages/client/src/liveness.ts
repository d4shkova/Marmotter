/**
 * The signals that say a connection deserves questioning now.
 *
 * The keepalive in `keepalive.ts` asks after a stretch of silence, which is the
 * right default and the wrong instrument for the case people actually hit. A
 * laptop closed on a train does not run timers while it sleeps: the sixty
 * seconds of silence that should have raised a question were never counted, and
 * when the lid opens the idle timer starts a fresh minute of a connection that
 * died an hour ago. The same is true of a phone with the app in the background
 * and, less severely, of a browser tab that has been throttled behind twenty
 * others.
 *
 * So rather than tune the timer, watch for the events that mean the ground has
 * moved, and ask immediately when one arrives:
 *
 * - **The clock jumped.** A short repeating tick that finds far more wall-clock
 *   time has passed than it scheduled was not running, which means the machine
 *   was asleep. This is the only one of the three that needs no platform
 *   support, so it is the one that carries the desktop shells and Android.
 * - **The network came back.** `online` fires when the operating system thinks
 *   it has connectivity again. It is not proof — a captive portal reports
 *   online — but it is a good reason to ask, and `offline` is worth asking on
 *   too: a connection the OS says is gone will not answer, and finding that out
 *   in a few seconds beats finding it out in ninety.
 * - **The tab came back to the front.** Timers are throttled in a hidden tab,
 *   so the first thing to do when one is shown again is check it is still real.
 *
 * None of these decides anything on its own. Each one only asks the keepalive
 * to send its `PING` early; the answer, or the absence of one, is still what
 * settles it. That matters because every signal here lies sometimes, and a
 * client that disconnected itself on `offline` would drop connections that were
 * working perfectly.
 *
 * Everything platform-shaped is injected, so this is testable without a DOM and
 * degrades to the clock check alone where there is no `window`.
 *
 * The browser types are declared here rather than pulled in from `lib.dom`.
 * `packages/client` compiles without the DOM — it is the same package the Tauri
 * shells use, and `websocket.ts` already describes the socket it needs as
 * `WebSocketLike` for the same reason — so the globals are reached through
 * `globalThis` and described by the two small shapes below.
 */

/** Why the connection is being questioned. Carried for the raw log. */
export type SuspicionCause = 'woke' | 'network-changed' | 'foreground';

/**
 * How often the clock is checked.
 *
 * Short enough that a wake is noticed promptly, long enough to be free: this is
 * a comparison of two numbers, not a wake-up in its own right.
 */
export const CLOCK_TICK_MS = 10_000;

/**
 * How far the clock may drift before the gap is read as a sleep.
 *
 * Well above the tick, because an ordinary busy moment — a large paste
 * rendering, a garbage collection, a throttled background tab — delays a timer
 * by a second or two and is not a suspend. Below that, this would fire
 * constantly and the probe would stop meaning anything.
 */
export const CLOCK_JUMP_MS = 30_000;

/** The slice of the event API this needs. See the note above on the DOM. */
export interface LivenessTarget {
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
}

export interface LivenessOptions {
  /** Called when something suggests the connection may no longer be real. */
  readonly onSuspicion: (cause: SuspicionCause) => void;
  /** Injected for tests, and absent outside a browser. */
  readonly target?: LivenessTarget | undefined;
  /** Injected for tests. Reads `document.visibilityState` in a browser. */
  readonly isVisible?: (() => boolean) | undefined;
  readonly now?: () => number;
  readonly setIntervalFn?: (handler: () => void, ms: number) => unknown;
  readonly clearIntervalFn?: (handle: unknown) => void;
  readonly tickMs?: number;
  readonly jumpMs?: number;
}

/** Stops watching. */
export type StopWatching = () => void;

/** What a browser puts on the global object, where there is one. */
interface BrowserGlobals {
  readonly window?: LivenessTarget;
  readonly document?: { readonly visibilityState?: string };
}

const browserGlobals = (): BrowserGlobals => globalThis as BrowserGlobals;

const browserTarget = (): LivenessTarget | undefined => browserGlobals().window;

const browserVisibility = (): (() => boolean) | undefined => {
  const page = browserGlobals().document;
  return page === undefined ? undefined : () => page.visibilityState === 'visible';
};

export function watchLiveness(options: LivenessOptions): StopWatching {
  const now = options.now ?? (() => Date.now());
  const tickMs = options.tickMs ?? CLOCK_TICK_MS;
  const jumpMs = options.jumpMs ?? CLOCK_JUMP_MS;
  const startInterval =
    options.setIntervalFn ?? ((handler, ms): unknown => setInterval(handler, ms));
  const stopInterval =
    options.clearIntervalFn ?? ((handle): void => clearInterval(handle as never));
  const target = options.target === undefined ? browserTarget() : options.target;
  const isVisible = options.isVisible === undefined ? browserVisibility() : options.isVisible;

  let last = now();
  let stopped = false;

  const raise = (cause: SuspicionCause): void => {
    if (!stopped) {
      options.onSuspicion(cause);
    }
  };

  const tick = (): void => {
    const at = now();
    const elapsed = at - last;
    last = at;
    if (elapsed >= jumpMs) {
      raise('woke');
    }
  };

  const handle = startInterval(tick, tickMs);

  const onNetworkChange = (): void => {
    // The clock baseline moves too: a machine that was asleep usually comes
    // back with an `online` as well, and both signals asking is one probe more
    // than needed.
    last = now();
    raise('network-changed');
  };

  const onVisibility = (): void => {
    if (isVisible?.() !== false) {
      last = now();
      raise('foreground');
    }
  };

  target?.addEventListener('online', onNetworkChange);
  target?.addEventListener('offline', onNetworkChange);
  target?.addEventListener('visibilitychange', onVisibility);
  // Tauri's webview and mobile browsers report a return to the foreground here
  // where `visibilitychange` is unreliable. Both firing costs one extra `PING`.
  target?.addEventListener('focus', onVisibility);

  return () => {
    stopped = true;
    stopInterval(handle);
    target?.removeEventListener('online', onNetworkChange);
    target?.removeEventListener('offline', onNetworkChange);
    target?.removeEventListener('visibilitychange', onVisibility);
    target?.removeEventListener('focus', onVisibility);
  };
}
