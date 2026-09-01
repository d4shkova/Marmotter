import { describe, expect, it, vi } from 'vitest';
import { CLOCK_JUMP_MS, CLOCK_TICK_MS, type SuspicionCause, watchLiveness } from './liveness.js';

/** An event target the test fires by hand. */
function fakeTarget() {
  const handlers = new Map<string, Set<EventListenerOrEventListenerObject>>();

  return {
    target: {
      addEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
        const set = handlers.get(type) ?? new Set();
        set.add(handler);
        handlers.set(type, set);
      },
      removeEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
        handlers.get(type)?.delete(handler);
      },
    },
    fire(type: string): void {
      for (const handler of handlers.get(type) ?? []) {
        (handler as EventListener)(new Event(type));
      }
    },
    count(type: string): number {
      return handlers.get(type)?.size ?? 0;
    },
  };
}

/** An interval the test steps, with a wall clock it moves separately. */
function build(options: { isVisible?: () => boolean } = {}) {
  const causes: SuspicionCause[] = [];
  const target = fakeTarget();
  let at = 0;
  let tick: (() => void) | undefined;
  const cleared = vi.fn();

  const stop = watchLiveness({
    onSuspicion: (cause) => causes.push(cause),
    target: target.target,
    ...(options.isVisible === undefined ? {} : { isVisible: options.isVisible }),
    now: () => at,
    setIntervalFn: (handler) => {
      tick = handler;
      return 1;
    },
    clearIntervalFn: cleared,
  });

  return {
    causes,
    target,
    stop,
    cleared,
    /** Moves the wall clock forward, then runs one tick of the interval. */
    passTime(ms: number): void {
      at += ms;
      tick?.();
    },
    /** Moves the wall clock forward without running a tick — a sleep. */
    slip(ms: number): void {
      at += ms;
    },
  };
}

describe('the signals that say a connection deserves questioning', () => {
  it('says nothing while the clock keeps up with the tick', () => {
    const { causes, passTime } = build();
    for (let round = 0; round < 5; round += 1) {
      passTime(CLOCK_TICK_MS);
    }

    expect(causes).toEqual([]);
  });

  it('reads a jump in the wall clock as a machine that was asleep', () => {
    // The case the idle timer cannot cover: a suspended machine does not run
    // timers, so the silence that should have raised a question was never
    // counted.
    const { causes, passTime } = build();
    passTime(CLOCK_JUMP_MS * 4);

    expect(causes).toEqual(['woke']);
  });

  it('does not read an ordinary busy moment as a sleep', () => {
    const { causes, passTime } = build();
    passTime(CLOCK_TICK_MS + 2_000);

    expect(causes).toEqual([]);
  });

  it('asks when the operating system says the network changed', () => {
    const { causes, target } = build();
    target.fire('online');
    target.fire('offline');

    expect(causes).toEqual(['network-changed', 'network-changed']);
  });

  it('does not also report a sleep for the wake that brought the network back', () => {
    // A machine coming back usually fires `online` as well, and both signals
    // asking is one probe more than is any use.
    const { causes, target, slip, passTime } = build();
    slip(CLOCK_JUMP_MS * 4);
    target.fire('online');
    passTime(CLOCK_TICK_MS);

    expect(causes).toEqual(['network-changed']);
  });

  it('asks when a tab comes back to the front', () => {
    let visible = false;
    const { causes, target } = build({ isVisible: () => visible });

    target.fire('visibilitychange');
    expect(causes).toEqual([]);

    visible = true;
    target.fire('visibilitychange');
    expect(causes).toEqual(['foreground']);
  });

  it('asks on focus too, where visibility is not reported', () => {
    const { causes, target } = build();
    target.fire('focus');

    expect(causes).toEqual(['foreground']);
  });

  it('lets go of everything when it stops', () => {
    const { causes, target, stop, cleared, passTime } = build();
    stop();

    expect(cleared).toHaveBeenCalledWith(1);
    expect(target.count('online')).toBe(0);
    expect(target.count('visibilitychange')).toBe(0);

    target.fire('focus');
    passTime(CLOCK_JUMP_MS * 4);
    expect(causes).toEqual([]);
  });

  it('runs on the clock alone where there is nothing to listen to', () => {
    // Not every platform has a `window`, and the clock check is the one signal
    // that needs no support at all.
    const causes: SuspicionCause[] = [];
    let at = 0;
    let tick: (() => void) | undefined;

    watchLiveness({
      onSuspicion: (cause) => causes.push(cause),
      target: undefined,
      isVisible: undefined,
      now: () => at,
      setIntervalFn: (handler) => {
        tick = handler;
        return 1;
      },
      clearIntervalFn: () => {},
    });

    at += CLOCK_JUMP_MS * 2;
    tick?.();

    expect(causes).toEqual(['woke']);
  });
});
