import type { CloseReason, NetworkProfile, ServerEndpoint, Transport } from '@marmotter/shared';
import { defaultLoggingPolicy } from '@marmotter/shared';
import { describe, expect, it } from 'vitest';
import { type SessionEvent, createSession } from './session.js';
import { TransportConnectError } from './transport/connect-error.js';
import { Listeners } from './transport/listeners.js';
import { createReconnectingTransport } from './transport/reconnecting.js';

/**
 * The session and the reconnecting transport, together.
 *
 * Each is covered on its own elsewhere. What is here is the seam between them,
 * which is where both of the bugs this file exists for lived: a rejected
 * certificate losing its classification on the way up, and a reconnection that
 * reconnects and then goes quiet because nothing re-registers.
 */

const endpoint: ServerEndpoint = {
  host: 'irc.dashkova.co.uk',
  port: 6697,
  tls: { mode: 'tls', verifyCert: true },
};

const profile = (): NetworkProfile => ({
  id: 'n1',
  name: 'dashkova.co.uk',
  servers: [endpoint],
  identity: { nick: 'marmot', altNicks: [], username: 'marmot', realname: 'Marmot' },
  autojoin: [],
  connectCommands: [],
  encoding: 'utf-8',
  autoReconnect: true,
  logging: defaultLoggingPolicy,
});

class FakeTransport implements Transport {
  readonly sent: string[] = [];
  readonly lines = new Listeners<string>();
  readonly closes = new Listeners<CloseReason>();
  disconnected = false;

  constructor(private readonly rejectWith?: unknown) {}

  async connect(): Promise<void> {
    if (this.rejectWith !== undefined) {
      throw this.rejectWith;
    }
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

const fakeClock = () => {
  let handle = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimeoutFn: (run: () => void) => {
      const id = handle++;
      pending.set(id, run);
      return id;
    },
    clearTimeoutFn: (id: unknown) => pending.delete(id as number),
    async runPending(): Promise<void> {
      const entries = [...pending.values()];
      pending.clear();
      for (const run of entries) {
        run();
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
};

function build(queue: FakeTransport[]) {
  const clock = fakeClock();
  const created: FakeTransport[] = [];
  let index = 0;

  const transport = createReconnectingTransport({
    endpoints: [endpoint],
    autoReconnect: true,
    createTransport: () => {
      const next = queue[index] ?? new FakeTransport();
      index += 1;
      created.push(next);
      return next;
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    random: () => 0.5,
  });

  // The liveness watch would otherwise hold a real interval open per session,
  // and its signals are covered on their own in `liveness.test.ts`.
  const session = createSession({ profile: profile(), transport, keepaliveIdleMs: 0 });
  const events: SessionEvent[] = [];
  session.on((event) => events.push(event));
  return { session, transport, clock, created, events };
}

describe('a certificate the client will not accept', () => {
  const tls: CloseReason = {
    kind: 'tls-error',
    message:
      'invalid peer certificate: certificate not valid for name "irc.dashkova.co.uk"; certificate is only valid for DnsName("dashkova.co.uk")',
  };

  it('reaches the session as a TLS error, so the interface can offer to trust it', async () => {
    // Flattened to a network error, this is indistinguishable from the server
    // being down, and the "Connect anyway" prompt never appears — which is
    // exactly what happened once the reconnecting wrapper went into the path.
    const { session, events } = build([new FakeTransport(new TransportConnectError(tls))]);
    await session.connect();

    const closed = events.find((event) => event.kind === 'closed');
    expect(closed).toBeDefined();
    expect(closed?.kind === 'closed' && closed.reason.kind).toBe('tls-error');
  });

  it('is not retried, and leaves the session disconnected rather than registering', async () => {
    const { session, clock, created } = build([new FakeTransport(new TransportConnectError(tls))]);
    await session.connect();
    await clock.runPending();

    // One attempt: the certificate will not have changed by the second.
    expect(created).toHaveLength(1);
    expect(session.state.phase).toBe('disconnected');
    expect(session.state.lastClose?.kind).toBe('tls-error');
    // And nothing was written to a socket that was never open.
    expect(created[0]?.sent).toEqual([]);
  });
});

describe('reconnecting after a drop', () => {
  it('registers again on the connection it establishes', async () => {
    // Nobody calls `connect` for a socket the wrapper opens on its own. Without
    // registration driven by its state, a reconnect opens a socket, sends no
    // NICK, and sits there until the server gives up on it.
    const first = new FakeTransport();
    const second = new FakeTransport();
    const { session, clock, created } = build([first, second]);

    await session.connect();
    expect(first.sent).toEqual(['CAP LS 302', 'NICK marmot', 'USER marmot 0 * :Marmot']);

    first.closes.emit({ kind: 'server' });
    await clock.runPending();

    expect(created).toHaveLength(2);
    expect(second.sent).toEqual(['CAP LS 302', 'NICK marmot', 'USER marmot 0 * :Marmot']);
    expect(session.state.phase).toBe('registering');
  });

  it('registers once per connection, not twice on the first', async () => {
    // `connect` awaits the wrapper, whose state reaches `connected` during that
    // await. Registering in both places would send NICK twice.
    const first = new FakeTransport();
    const { session } = build([first]);

    await session.connect();

    expect(first.sent.filter((line) => line.startsWith('NICK '))).toHaveLength(1);
  });

  it('shows the network as connecting while it retries, not as connected', async () => {
    const first = new FakeTransport();
    const { session, clock } = build([first, new FakeTransport()]);
    await session.connect();

    first.closes.emit({ kind: 'server' });
    expect(session.state.phase).toBe('connecting');

    await clock.runPending();
    expect(session.state.phase).toBe('registering');
  });

  it('says it is retrying, on every attempt, rather than only when it stops', async () => {
    // Retrying is unbounded, so a close is no longer what tells somebody an
    // outage is happening — this is. Without it a long outage is silent, and
    // silence reads as a client that has given up.
    const first = new FakeTransport();
    const { session, clock, events } = build([
      first,
      new FakeTransport(new Error('refused')),
      new FakeTransport(new Error('refused')),
    ]);
    await session.connect();

    first.closes.emit({ kind: 'server' });
    await clock.runPending();
    await clock.runPending();

    const retries = events.filter((event) => event.kind === 'reconnecting');
    expect(retries.length).toBeGreaterThanOrEqual(2);
    expect(retries[0]).toMatchObject({ attempt: 1, reason: { kind: 'server' } });
    expect(retries[0]?.kind === 'reconnecting' && retries[0].delayMs).toBeGreaterThan(0);
    // And none of it is reported as the connection having stopped for good.
    expect(events.filter((event) => event.kind === 'closed')).toEqual([]);
  });

  it('does not report a close while it is still working on it', async () => {
    const first = new FakeTransport();
    const { session, clock, events, created } = build([first]);
    await session.connect();

    // Eight drops in a row: well past the three attempts this used to allow,
    // which is seven seconds into an outage.
    for (let round = 0; round < 8; round += 1) {
      created[created.length - 1]?.closes.emit({ kind: 'server' });
      await clock.runPending();
    }

    expect(created).toHaveLength(9);
    expect(events.filter((event) => event.kind === 'closed')).toEqual([]);
    expect(session.state.phase).toBe('registering');
  });
});
