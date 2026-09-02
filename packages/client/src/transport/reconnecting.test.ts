import type { CloseReason, ServerEndpoint, Transport } from '@marmotter/shared';
import { describe, expect, it } from 'vitest';
import { Listeners } from './listeners.js';
import { TransportConnectError } from './connect-error.js';
import {
  DEFAULT_BACKOFF,
  STABLE_CONNECTION_MS,
  type ConnectionState,
  backoffDelay,
  createReconnectingTransport,
} from './reconnecting.js';

/** A transport a test drives by hand. */
class FakeTransport implements Transport {
  readonly lines = new Listeners<string>();
  readonly closes = new Listeners<CloseReason>();
  sent: string[] = [];
  connected = false;
  disconnected = false;

  constructor(private readonly failWith?: string) {}

  connect(): Promise<void> {
    if (this.failWith !== undefined) {
      return Promise.reject(new Error(this.failWith));
    }
    this.connected = true;
    return Promise.resolve();
  }

  send(line: string): void {
    this.sent.push(line);
  }

  onLine = (callback: (line: string) => void) => this.lines.add(callback);
  onClose = (callback: (reason: CloseReason) => void) => this.closes.add(callback);

  disconnect(): void {
    this.disconnected = true;
  }
}

const endpoint = (host: string): ServerEndpoint => ({
  host,
  port: 6697,
  tls: { mode: 'tls', verifyCert: true },
});

/** A controllable clock, so tests never wait in real time. */
const fakeClock = () => {
  let nextHandle = 1;
  const pending = new Map<number, { handler: () => void; delay: number }>();

  return {
    setTimeoutFn: (handler: () => void, delay: number) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, { handler, delay });
      return handle;
    },
    clearTimeoutFn: (handle: unknown) => {
      pending.delete(handle as number);
    },
    pendingDelays: () => [...pending.values()].map((entry) => entry.delay),
    /** Fires every timer currently scheduled. */
    async runPending(): Promise<void> {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, entry] of entries) {
        entry.handler();
      }
      // Let the async connect settle.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
};

describe('backoffDelay', () => {
  it('grows exponentially', () => {
    const noJitter = { ...DEFAULT_BACKOFF, jitter: 0 };
    expect(backoffDelay(1, noJitter, () => 0.5)).toBe(1000);
    expect(backoffDelay(2, noJitter, () => 0.5)).toBe(2000);
    expect(backoffDelay(3, noJitter, () => 0.5)).toBe(4000);
  });

  it('stops growing at the ceiling', () => {
    const noJitter = { ...DEFAULT_BACKOFF, jitter: 0 };
    expect(backoffDelay(50, noJitter, () => 0.5)).toBe(DEFAULT_BACKOFF.maxMs);
  });

  it('spreads the delay so a netsplit does not reconnect in lockstep', () => {
    // Same attempt, different random draws, different waits.
    const low = backoffDelay(3, DEFAULT_BACKOFF, () => 0);
    const high = backoffDelay(3, DEFAULT_BACKOFF, () => 1);
    expect(low).toBeLessThan(high);
    expect(low).toBe(3000);
    expect(high).toBe(5000);
  });

  it('never returns a negative wait', () => {
    const wild = { initialMs: 10, maxMs: 100, factor: 2, jitter: 4 };
    expect(backoffDelay(1, wild, () => 0)).toBeGreaterThanOrEqual(0);
  });

  it('treats attempt zero as the first delay', () => {
    const noJitter = { ...DEFAULT_BACKOFF, jitter: 0 };
    expect(backoffDelay(0, noJitter, () => 0.5)).toBe(1000);
  });
});

describe('createReconnectingTransport', () => {
  it('is still a Transport, so nothing above it needs to know', () => {
    const asTransport: Transport = createReconnectingTransport({
      endpoints: [endpoint('one.example')],
      autoReconnect: false,
      createTransport: () => new FakeTransport(),
    });
    expect(typeof asTransport.connect).toBe('function');
    expect(typeof asTransport.send).toBe('function');
    expect(typeof asTransport.disconnect).toBe('function');
  });

  const build = (
    options: {
      endpoints?: ServerEndpoint[];
      autoReconnect?: boolean;
      maxAttempts?: number;
      transports?: FakeTransport[];
      now?: () => number;
    } = {},
  ) => {
    const clock = fakeClock();
    const created: FakeTransport[] = [];
    const queue = options.transports ?? [];
    let index = 0;

    const transport = createReconnectingTransport({
      endpoints: options.endpoints ?? [endpoint('one.example')],
      autoReconnect: options.autoReconnect ?? true,
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      createTransport: () => {
        const next = queue[index] ?? new FakeTransport();
        index += 1;
        created.push(next);
        return next;
      },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      random: () => 0.5,
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    const states: ConnectionState[] = [];
    transport.onStateChange((state) => states.push(state));

    return { transport, clock, created, states };
  };

  it('connects and reports the state', async () => {
    const { transport, states } = build();
    await transport.connect();

    expect(transport.state.kind).toBe('connected');
    expect(states.map((state) => state.kind)).toEqual(['connecting', 'connected']);
  });

  it('forwards lines from whichever transport is live', async () => {
    const first = new FakeTransport();
    const { transport, created } = build({ transports: [first] });
    const received: string[] = [];
    transport.onLine((line) => received.push(line));

    await transport.connect();
    created[0]?.lines.emit(':srv 001 me :Welcome');

    expect(received).toEqual([':srv 001 me :Welcome']);
  });

  it('reconnects after the server drops the connection', async () => {
    const { transport, clock, created, states } = build();
    await transport.connect();

    created[0]?.closes.emit({ kind: 'server' });
    expect(transport.state.kind).toBe('waiting');

    await clock.runPending();
    expect(transport.state.kind).toBe('connected');
    expect(states.map((state) => state.kind)).toEqual([
      'connecting',
      'connected',
      'waiting',
      'connecting',
      'connected',
    ]);
  });

  it('works down the endpoint list on each attempt, then wraps', async () => {
    const endpoints = [endpoint('one.example'), endpoint('two.example'), endpoint('three.example')];
    const { transport, clock, created, states } = build({ endpoints });

    const connectingHosts = () =>
      states
        .filter((state): state is Extract<ConnectionState, { kind: 'connecting' }> => {
          return state.kind === 'connecting';
        })
        .map((state) => state.endpoint.host);

    await transport.connect();
    expect(connectingHosts()).toEqual(['one.example']);

    // Three drops walk the list and come back round to the first server.
    for (let round = 0; round < 3; round += 1) {
      expect(transport.state.kind).toBe('connected');
      created[created.length - 1]?.closes.emit({ kind: 'server' });
      await clock.runPending();
    }

    expect(connectingHosts()).toEqual([
      'one.example',
      'two.example',
      'three.example',
      'one.example',
    ]);
  });

  it('backs off further with each consecutive failure', async () => {
    // A connection that opens and falls straight over is a failed attempt, not
    // a success: a server accepting a socket and dropping it — a full network,
    // a load balancer in front of nothing — would otherwise reset the backoff
    // every time and turn this into a connection attempt a second, forever.
    const { transport, clock, created } = build();
    await transport.connect();

    created[0]?.closes.emit({ kind: 'server' });
    const first = clock.pendingDelays()[0];
    await clock.runPending();

    created[1]?.closes.emit({ kind: 'server' });
    expect(clock.pendingDelays()[0]).toBeGreaterThan(first ?? 0);
  });

  it('starts the backoff over after a connection that lasted', async () => {
    // The other half of the rule above. A connection that stood up for a while
    // and then dropped is a fresh outage, and somebody on a flaky link should
    // not be waiting five minutes because of something that happened this
    // morning.
    let at = 0;
    const { transport, clock, created } = build({ now: () => at });
    await transport.connect();

    created[0]?.closes.emit({ kind: 'server' });
    const first = clock.pendingDelays()[0];
    await clock.runPending();

    at += STABLE_CONNECTION_MS;
    created[1]?.closes.emit({ kind: 'server' });
    expect(clock.pendingDelays()[0]).toBe(first);
  });

  it('lengthens the delay when connecting keeps failing', async () => {
    const { transport, clock } = build({
      transports: [
        new FakeTransport('refused'),
        new FakeTransport('refused'),
        new FakeTransport('refused'),
      ],
    });

    await transport.connect();
    const first = clock.pendingDelays()[0] ?? 0;

    await clock.runPending();
    const second = clock.pendingDelays()[0] ?? 0;

    await clock.runPending();
    const third = clock.pendingDelays()[0] ?? 0;

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('stops rather than retrying when the certificate is wrong', async () => {
    const { transport, created } = build();
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    await transport.connect();
    // Retrying a TLS failure fails identically forever; the profile needs
    // fixing, so say so and stop.
    created[0]?.closes.emit({ kind: 'tls-error', message: 'bad certificate' });

    expect(transport.state.kind).toBe('stopped');
    expect(closes).toEqual([{ kind: 'tls-error', message: 'bad certificate' }]);
  });

  it('stops on a drop when reconnection is turned off', async () => {
    const { transport, created } = build({ autoReconnect: false });
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    await transport.connect();
    created[0]?.closes.emit({ kind: 'server' });

    expect(transport.state.kind).toBe('stopped');
    expect(closes).toEqual([{ kind: 'server' }]);
  });

  it('stops on a failed first connect when reconnection is off', async () => {
    const { transport } = build({
      autoReconnect: false,
      transports: [new FakeTransport('refused')],
    });
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    await transport.connect();

    expect(transport.state.kind).toBe('stopped');
    expect(closes[0]?.kind).toBe('network-error');
  });

  it('cancels a pending retry on disconnect', async () => {
    const { transport, clock, created } = build();
    await transport.connect();

    created[0]?.closes.emit({ kind: 'server' });
    expect(clock.pendingDelays()).toHaveLength(1);

    transport.disconnect();
    expect(clock.pendingDelays()).toHaveLength(0);
    expect(transport.state.kind).toBe('stopped');

    // Firing anything still queued must not revive the connection.
    await clock.runPending();
    expect(transport.state.kind).toBe('stopped');
  });

  it('disconnects the live transport underneath it', async () => {
    const { transport, created } = build();
    await transport.connect();

    transport.disconnect();
    expect(created[0]?.disconnected).toBe(true);
  });

  it('announces a user close once, however many times it is called', async () => {
    const { transport } = build();
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    await transport.connect();
    transport.disconnect();
    transport.disconnect();

    expect(closes).toEqual([{ kind: 'user' }]);
  });

  it('sends through the live transport', async () => {
    const { transport, created } = build();
    await transport.connect();

    transport.send('PING :token');
    expect(created[0]?.sent).toEqual(['PING :token']);
  });

  it('refuses to send while reconnecting', async () => {
    const { transport, created } = build();
    await transport.connect();
    created[0]?.closes.emit({ kind: 'server' });

    expect(() => transport.send('PING')).toThrow(/not open/);
  });

  it('reports a profile with no servers rather than looping', async () => {
    const { transport } = build({ endpoints: [] });
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    await transport.connect();

    expect(transport.state.kind).toBe('stopped');
    expect(closes[0]).toEqual({
      kind: 'network-error',
      message: 'This network has no servers configured.',
    });
  });
});

describe('giving up, and saying so', () => {
  const build = (
    options: { maxAttempts?: number; transports?: FakeTransport[]; now?: () => number } = {},
  ) => {
    const clock = fakeClock();
    const created: FakeTransport[] = [];
    const queue = options.transports ?? [];
    let index = 0;

    const transport = createReconnectingTransport({
      endpoints: [endpoint('one.example')],
      autoReconnect: true,
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      createTransport: () => {
        const next = queue[index] ?? new FakeTransport('refused');
        index += 1;
        created.push(next);
        return next;
      },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      random: () => 0.5,
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));
    return { transport, clock, created, closes };
  };

  it('keeps trying through an outage longer than a few seconds', async () => {
    // This is the bug the default was: three attempts are spent one, two and
    // four seconds after the drop, so the client gave up seven seconds into an
    // outage and every drop became permanent.
    const { transport, clock, created, closes } = build();

    await transport.connect();
    expect(created).toHaveLength(1);

    for (let round = 0; round < 12; round += 1) {
      await clock.runPending();
    }

    expect(created).toHaveLength(13);
    expect(closes).toHaveLength(0);
    expect(transport.state.kind).toBe('waiting');
  });

  it('always has the next attempt scheduled while it is retrying', async () => {
    const { transport, clock } = build();
    await transport.connect();
    for (let round = 0; round < 6; round += 1) {
      await clock.runPending();
    }

    expect(clock.pendingDelays()).toHaveLength(1);
  });

  it('holds the delay at the ceiling rather than growing without bound', async () => {
    const { transport, clock } = build();
    await transport.connect();
    for (let round = 0; round < 20; round += 1) {
      await clock.runPending();
    }

    // Jitter at 0.5 with a fixed random of 0.5 lands exactly on the ceiling.
    expect(clock.pendingDelays()[0]).toBe(DEFAULT_BACKOFF.maxMs);
  });

  it('brings the next attempt forward when asked', async () => {
    // For the "Try again" in a notice, and for the operating system reporting
    // the network back: sitting out a delay calculated before the cable went
    // back in is the client looking broken for no reason.
    const { transport, clock, created } = build();
    await transport.connect();
    await clock.runPending();

    const waiting = created.length;
    expect(transport.state.kind).toBe('waiting');
    transport.retryNow();
    await Promise.resolve();
    await Promise.resolve();

    expect(created.length).toBe(waiting + 1);
    // The wait it abandoned is not left behind to fire a second attempt.
    expect(clock.pendingDelays()).toHaveLength(1);
  });

  it('ignores a request to retry when nothing is pending', async () => {
    const first = new FakeTransport();
    const { transport, created } = build({ transports: [first] });
    await transport.connect();

    transport.retryNow();
    await Promise.resolve();

    expect(created).toHaveLength(1);
    expect(transport.state.kind).toBe('connected');
  });

  it('honours a limit of its own, for somebody pointing at their own bouncer', async () => {
    const { transport, clock, created } = build({ maxAttempts: 1 });
    await transport.connect();
    await clock.runPending();

    expect(created).toHaveLength(2);
    expect(transport.state.kind).toBe('stopped');
  });

  it('starts counting again after a connection that lasted', async () => {
    // An explicit limit is per outage, not for the life of the app. Somebody on
    // a flaky link would otherwise be cut off for good by lunchtime.
    let at = 0;
    const first = new FakeTransport();
    const { transport, clock, created, closes } = build({
      maxAttempts: 2,
      transports: [first],
      now: () => at,
    });
    await transport.connect();

    at += STABLE_CONNECTION_MS;
    first.closes.emit({ kind: 'server' });
    await clock.runPending();
    expect(created.length).toBeGreaterThan(1);

    expect(closes).toHaveLength(0);
  });
});

describe('a connection that died without closing', () => {
  it('retries when it is told the connection is dead', async () => {
    // The half-open socket: no close will ever arrive, so the keepalive says so
    // and the same machinery has to run.
    const clock = fakeClock();
    const created: FakeTransport[] = [];
    const live = new FakeTransport();
    let first = true;

    const transport = createReconnectingTransport({
      endpoints: [endpoint('one.example')],
      autoReconnect: true,
      createTransport: () => {
        const next = first ? live : new FakeTransport();
        first = false;
        created.push(next);
        return next;
      },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      random: () => 0.5,
    });

    await transport.connect();
    transport.dropped({ kind: 'network-error', message: 'The server stopped responding.' });

    // The socket that was never going to close is closed by us, or the handle
    // leaks once per drop — on a flaky link, one every few minutes.
    expect(live.disconnected).toBe(true);
    expect(transport.state.kind).toBe('waiting');

    await clock.runPending();
    expect(created).toHaveLength(2);
  });

  it('ignores being told twice, and ignores it when not connected', async () => {
    const clock = fakeClock();
    const transport = createReconnectingTransport({
      endpoints: [endpoint('one.example')],
      autoReconnect: true,
      createTransport: () => new FakeTransport(),
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      random: () => 0.5,
    });

    const dead: CloseReason = { kind: 'network-error', message: 'gone' };
    // Before connecting at all.
    transport.dropped(dead);
    expect(transport.state.kind).toBe('idle');

    await transport.connect();
    transport.dropped(dead);
    const after = transport.state;
    transport.dropped(dead);
    expect(transport.state).toBe(after);
  });
});

describe('a certificate that will not verify', () => {
  /** A transport whose connect rejects the way the real ones do. */
  class RejectingTransport extends FakeTransport {
    constructor(private readonly reason: CloseReason) {
      super();
    }
    override connect(): Promise<void> {
      return Promise.reject(new TransportConnectError(this.reason));
    }
  }

  const tls: CloseReason = {
    kind: 'tls-error',
    message: 'invalid peer certificate: certificate not valid for name "irc.dashkova.co.uk"',
  };

  const build = (reason: CloseReason) => {
    const clock = fakeClock();
    const created: FakeTransport[] = [];
    const transport = createReconnectingTransport({
      endpoints: [endpoint('irc.dashkova.co.uk')],
      autoReconnect: true,
      createTransport: () => {
        const next = new RejectingTransport(reason);
        created.push(next);
        return next;
      },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      random: () => 0.5,
    });
    const closes: CloseReason[] = [];
    transport.onClose((entry) => closes.push(entry));
    return { transport, clock, created, closes };
  };

  it('keeps the reason the transport classified, rather than flattening it', async () => {
    // Flattening this into a generic network failure is what stops the
    // interface offering to trust the certificate: the failure ends up looking
    // identical to the server being down, and the "Connect anyway" prompt never
    // appears.
    const { transport, closes } = build(tls);
    await transport.connect();

    expect(closes).toHaveLength(1);
    expect(closes[0]?.kind).toBe('tls-error');
    expect(closes[0]).toEqual(tls);
  });

  it('does not retry it, because a certificate does not change between attempts', async () => {
    const { transport, clock, created } = build(tls);
    await transport.connect();

    expect(created).toHaveLength(1);
    expect(clock.pendingDelays()).toEqual([]);
    expect(transport.state.kind).toBe('stopped');
  });

  it('still retries a connect that failed for an ordinary reason', async () => {
    // The classification has to narrow what is retried, not stop retrying.
    const { transport, clock, created } = build({ kind: 'network-error', message: 'refused' });
    await transport.connect();
    await clock.runPending();

    expect(created).toHaveLength(2);
  });

  it('falls back to a network error when the rejection carries no reason', async () => {
    // Not every transport throws a classified error — a bare `Error` from a
    // WebSocket, say — and that must still be retried rather than dropped.
    const clock = fakeClock();
    const created: FakeTransport[] = [];
    const transport = createReconnectingTransport({
      endpoints: [endpoint('one.example')],
      autoReconnect: true,
      createTransport: () => {
        const next = new FakeTransport('something went wrong');
        created.push(next);
        return next;
      },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      random: () => 0.5,
    });

    await transport.connect();
    expect(transport.state.kind).toBe('waiting');
    if (transport.state.kind === 'waiting') {
      expect(transport.state.reason.kind).toBe('network-error');
    }
  });
});
