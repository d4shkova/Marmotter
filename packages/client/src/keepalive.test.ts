import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_IDLE_MS, DEFAULT_TIMEOUT_MS, createKeepalive } from './keepalive.js';

/**
 * A clock the test drives.
 *
 * Real timers would mean waiting a real minute to find out whether a minute of
 * silence is noticed, so the whole point of injecting them is here.
 */
function fakeClock() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();

  return {
    setTimeoutFn: (run: () => void, ms: number): unknown => {
      const handle = next++;
      pending.set(handle, { at: now + ms, run });
      return handle;
    },
    clearTimeoutFn: (handle: unknown): void => {
      pending.delete(handle as number);
    },
    /** Moves time forward, firing whatever comes due. */
    advance(ms: number): void {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, entry]) => entry.at <= until)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (due === undefined) {
          break;
        }
        pending.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
  };
}

function build(options: { idleMs?: number; timeoutMs?: number } = {}) {
  const clock = fakeClock();
  const sent: string[] = [];
  const onDead = vi.fn();
  const keepalive = createKeepalive({
    send: (line) => sent.push(line),
    onDead,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    ...options,
  });
  return { clock, sent, onDead, keepalive };
}

describe('noticing a connection that has died without closing', () => {
  it('asks after a stretch of silence', () => {
    const { clock, sent, keepalive } = build();
    keepalive.start();

    clock.advance(DEFAULT_IDLE_MS - 1);
    expect(sent).toEqual([]);

    clock.advance(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^PING :marmotter-\d+$/);
  });

  it('calls it dead when nothing answers', () => {
    // The half-open socket. Nothing sends a FIN when a network goes away, so
    // without this the client waits forever for messages that cannot arrive.
    const { clock, onDead, keepalive } = build();
    keepalive.start();

    clock.advance(DEFAULT_IDLE_MS);
    expect(onDead).not.toHaveBeenCalled();

    clock.advance(DEFAULT_TIMEOUT_MS);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('takes any inbound line as proof of life, not only a PONG', () => {
    // A busy channel means the connection is obviously fine. Insisting on our
    // own PONG would be stricter without being more correct, and would add
    // traffic to a connection already carrying plenty.
    const { clock, onDead, keepalive } = build();
    keepalive.start();

    clock.advance(DEFAULT_IDLE_MS);
    clock.advance(DEFAULT_TIMEOUT_MS - 1);
    keepalive.noteActivity();
    clock.advance(DEFAULT_TIMEOUT_MS);

    expect(onDead).not.toHaveBeenCalled();
  });

  it('goes quiet again once an answer arrives', () => {
    const { clock, sent, keepalive } = build();
    keepalive.start();

    clock.advance(DEFAULT_IDLE_MS);
    expect(keepalive.waiting).toBe(true);

    keepalive.noteActivity();
    expect(keepalive.waiting).toBe(false);

    // And starts counting the silence over rather than asking again at once.
    clock.advance(DEFAULT_IDLE_MS - 1);
    expect(sent).toHaveLength(1);
    clock.advance(1);
    expect(sent).toHaveLength(2);
  });

  it('never asks on a connection that keeps talking', () => {
    const { clock, sent, keepalive } = build();
    keepalive.start();

    for (let minute = 0; minute < 10; minute += 1) {
      clock.advance(DEFAULT_IDLE_MS - 1);
      keepalive.noteActivity();
    }

    expect(sent).toEqual([]);
  });

  it('reports a death once, however long the clock runs on', () => {
    const { clock, onDead, keepalive } = build();
    keepalive.start();

    clock.advance(DEFAULT_IDLE_MS + DEFAULT_TIMEOUT_MS);
    clock.advance(DEFAULT_IDLE_MS * 10);

    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('stops watching when it is stopped', () => {
    const { clock, sent, onDead, keepalive } = build();
    keepalive.start();
    keepalive.stop();

    clock.advance(DEFAULT_IDLE_MS * 5);

    expect(sent).toEqual([]);
    expect(onDead).not.toHaveBeenCalled();
  });

  it('starting twice does not double the traffic', () => {
    // The session starts it from every inbound line, since a reconnecting
    // transport re-establishes without anyone calling connect.
    const { clock, sent, keepalive } = build();
    keepalive.start();
    keepalive.start();
    keepalive.start();

    clock.advance(DEFAULT_IDLE_MS);
    expect(sent).toHaveLength(1);
  });

  it('watches a second connection after the first one died', () => {
    // A session outlives its connections: the same keepalive covers whatever
    // the reconnecting transport establishes next.
    const { clock, onDead, keepalive } = build();
    keepalive.start();
    clock.advance(DEFAULT_IDLE_MS + DEFAULT_TIMEOUT_MS);
    expect(onDead).toHaveBeenCalledTimes(1);

    keepalive.stop();
    keepalive.start();
    clock.advance(DEFAULT_IDLE_MS + DEFAULT_TIMEOUT_MS);

    expect(onDead).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all before it is started', () => {
    const { clock, sent, onDead, keepalive } = build();
    keepalive.noteActivity();
    clock.advance(DEFAULT_IDLE_MS * 5);

    expect(sent).toEqual([]);
    expect(onDead).not.toHaveBeenCalled();
  });

  it('honours the intervals it was given', () => {
    const { clock, sent, onDead, keepalive } = build({ idleMs: 100, timeoutMs: 50 });
    keepalive.start();

    clock.advance(100);
    expect(sent).toHaveLength(1);
    clock.advance(50);
    expect(onDead).toHaveBeenCalledTimes(1);
  });
});
