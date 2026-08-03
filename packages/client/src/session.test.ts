import { decodeBase64, utf8Decode } from '@marmotter/protocol';
import type {
  CloseReason,
  ConnectOptions,
  NetworkProfile,
  SecretRef,
  Transport,
} from '@marmotter/shared';
import { defaultLoggingPolicy } from '@marmotter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SessionEvent, createSession } from './session.js';

/** A transport that records what was sent and lets a test push lines back. */
class FakeTransport implements Transport {
  readonly sent: string[] = [];
  connected: ConnectOptions | undefined;
  disconnected = false;
  private lineCallbacks: ((line: string) => void)[] = [];
  private closeCallbacks: ((reason: CloseReason) => void)[] = [];

  async connect(options: ConnectOptions): Promise<void> {
    this.connected = options;
  }

  send(line: string): void {
    this.sent.push(line);
  }

  onLine(callback: (line: string) => void): () => void {
    this.lineCallbacks.push(callback);
    return () => {
      this.lineCallbacks = this.lineCallbacks.filter((entry) => entry !== callback);
    };
  }

  onClose(callback: (reason: CloseReason) => void): () => void {
    this.closeCallbacks.push(callback);
    return () => {
      this.closeCallbacks = this.closeCallbacks.filter((entry) => entry !== callback);
    };
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** Delivers lines as the server would. */
  receive(...lines: string[]): void {
    for (const line of lines) {
      for (const callback of [...this.lineCallbacks]) {
        callback(line);
      }
    }
  }

  close(reason: CloseReason = { kind: 'server' }): void {
    for (const callback of [...this.closeCallbacks]) {
      callback(reason);
    }
  }
}

const secret = (id: string): SecretRef => ({ kind: 'secret-ref', id });

const profile = (overrides: Partial<NetworkProfile> = {}): NetworkProfile => ({
  id: 'test-network',
  name: 'TestNet',
  servers: [{ host: 'irc.test', port: 6697, tls: { mode: 'tls', verifyCert: true } }],
  identity: {
    nick: 'marmot',
    altNicks: ['marmot_'],
    username: 'marmot',
    realname: 'Marmot',
  },
  autojoin: [],
  connectCommands: [],
  encoding: 'utf-8',
  autoReconnect: true,
  logging: defaultLoggingPolicy,
  ...overrides,
});

const now = () => new Date('2026-08-02T12:00:00.000Z');

const build = (overrides: Partial<NetworkProfile> = {}) => {
  const transport = new FakeTransport();
  const session = createSession({ profile: profile(overrides), transport, now });
  return { transport, session };
};

/** Runs the queued microtasks a SASL step resolves through. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('registration', () => {
  it('opens with capability negotiation, then identifies', async () => {
    const { transport, session } = build();
    await session.connect();

    expect(transport.sent).toEqual(['CAP LS 302', 'NICK marmot', 'USER marmot 0 * :Marmot']);
  });

  it('connects to the profile’s first endpoint', async () => {
    const { transport, session } = build();
    await session.connect();
    expect(transport.connected?.endpoint.host).toBe('irc.test');
  });

  it('reports the connecting phase before the socket resolves', async () => {
    const transport = new FakeTransport();
    let phaseWhileConnecting: string | undefined;
    // A transport whose connect never resolves, so the phase can be read while
    // the handshake is still in flight.
    transport.connect = () =>
      new Promise<void>(() => {
        phaseWhileConnecting = session.state.phase;
      });
    const session = createSession({ profile: profile(), transport, now });

    void session.connect();
    await settle();
    expect(phaseWhileConnecting).toBe('connecting');
    expect(session.state.phase).toBe('connecting');
  });

  it('records why a connection that never opened failed', async () => {
    const transport = new FakeTransport();
    transport.connect = () => Promise.reject(new Error('connection refused'));
    const session = createSession({ profile: profile(), transport, now });

    await expect(session.connect()).rejects.toThrow('connection refused');
    // The phase returns to disconnected with the reason attached, rather than
    // sitting on `connecting` forever.
    expect(session.state.phase).toBe('disconnected');
    expect(session.state.lastClose).toEqual({
      kind: 'network-error',
      message: 'connection refused',
    });
  });

  it('sends a server password before anything else', async () => {
    const transport = new FakeTransport();
    const session = createSession({
      profile: profile({ auth: { type: 'server-password', password: secret('p') } }),
      transport,
      resolveSecret: async () => 'hunter2',
      now,
    });
    await session.connect();

    expect(transport.sent[0]).toBe('PASS hunter2');
    expect(transport.sent[1]).toBe('CAP LS 302');
  });

  it('answers PING without anything above having to remember', async () => {
    const { transport, session } = build();
    await session.connect();
    transport.receive('PING :abc');
    expect(transport.sent).toContain('PONG :abc');
  });

  it('joins the autojoin list once registered', async () => {
    const { transport, session } = build({
      autojoin: [{ target: '#test' }, { target: '#other' }],
      connectCommands: ['MODE marmot +i'],
    });
    await session.connect();
    transport.receive(':irc.test 001 marmot :Welcome', ':irc.test 376 marmot :End of MOTD');

    expect(transport.sent).toContain('JOIN #test');
    expect(transport.sent).toContain('JOIN #other');
    expect(transport.sent).toContain('MODE marmot +i');
  });

  it('resolves a channel key before joining a keyed channel', async () => {
    const transport = new FakeTransport();
    const session = createSession({
      profile: profile({ autojoin: [{ target: '#secret', key: secret('k') }] }),
      transport,
      resolveSecret: async () => 'letmein',
      now,
    });
    await session.connect();
    transport.receive(':irc.test 001 marmot :Welcome', ':irc.test 376 marmot :End of MOTD');
    await settle();

    expect(transport.sent).toContain('JOIN #secret letmein');
  });

  it('joins without a key when the saved one has gone', async () => {
    const transport = new FakeTransport();
    const session = createSession({
      profile: profile({ autojoin: [{ target: '#secret', key: secret('k') }] }),
      transport,
      resolveSecret: async () => undefined,
      now,
    });
    await session.connect();
    transport.receive(':irc.test 001 marmot :Welcome', ':irc.test 376 marmot :End of MOTD');
    await settle();

    expect(transport.sent).toContain('JOIN #secret');
  });
});

describe('SASL', () => {
  const authenticating = (auth: NetworkProfile['auth']) => {
    const transport = new FakeTransport();
    const session = createSession({
      profile: profile(auth === undefined ? {} : { auth }),
      transport,
      resolveSecret: async () => 'hunter2',
      now,
    });
    return { transport, session };
  };

  const negotiate = (transport: FakeTransport, mechanisms = 'PLAIN,EXTERNAL') => {
    transport.receive(`:irc.test CAP * LS :sasl=${mechanisms} server-time`);
    transport.receive(':irc.test CAP * ACK :sasl server-time');
  };

  it('names the mechanism and waits, rather than sending the payload early', async () => {
    const { transport, session } = authenticating({
      type: 'sasl-plain',
      account: 'marmot',
      password: secret('p'),
    });
    await session.connect();
    negotiate(transport);
    await settle();

    // The initial response belongs after the server's empty challenge. Sending
    // it before the server has set the mechanism up gets it rejected.
    expect(transport.sent.filter((line) => line.startsWith('AUTHENTICATE '))).toEqual([
      'AUTHENTICATE PLAIN',
    ]);
  });

  it('sends the credentials the profile names, once the server asks', async () => {
    const { transport, session } = authenticating({
      type: 'sasl-plain',
      account: 'marmot',
      password: secret('p'),
    });
    await session.connect();
    negotiate(transport);
    await settle();

    transport.receive('AUTHENTICATE +');
    await settle();

    const payload = transport.sent.find(
      (line) => line.startsWith('AUTHENTICATE ') && line !== 'AUTHENTICATE PLAIN',
    );
    expect(payload).toBeDefined();

    const bytes = decodeBase64(payload?.slice('AUTHENTICATE '.length) ?? '');
    expect(bytes).toBeDefined();
    // `authzid NUL authcid NUL password`, with the authzid left empty.
    expect(utf8Decode(bytes ?? new Uint8Array())).toBe('\u0000marmot\u0000hunter2');
  });

  it('records the account the server logged us in as', async () => {
    const { transport, session } = authenticating({
      type: 'sasl-plain',
      account: 'marmot',
      password: secret('p'),
    });
    await session.connect();
    negotiate(transport);
    await settle();

    transport.receive('AUTHENTICATE +');
    await settle();
    transport.receive(':irc.test 900 marmot marmot!~m@host marmot :You are now logged in');
    transport.receive(':irc.test 903 marmot :SASL authentication successful');

    expect(session.state.account).toBe('marmot');
  });

  it('sends an empty initial response for EXTERNAL, which carries no payload', async () => {
    const { transport, session } = authenticating({
      type: 'sasl-external',
      certPath: '/certs/marmot.pem',
    });
    await session.connect();
    negotiate(transport);
    await settle();

    transport.receive('AUTHENTICATE +');
    await settle();

    expect(transport.sent).toContain('AUTHENTICATE EXTERNAL');
    // The certificate is the credential; the payload is deliberately empty.
    expect(transport.sent.filter((line) => line === 'AUTHENTICATE +')).toHaveLength(1);
  });

  it('ignores a challenge when no exchange is running', async () => {
    const { transport, session } = build();
    await session.connect();
    const before = transport.sent.length;

    transport.receive('AUTHENTICATE +');
    await settle();

    expect(transport.sent).toHaveLength(before);
  });

  it('does not authenticate on a network that does not offer the mechanism', async () => {
    const events: SessionEvent[] = [];
    const { transport, session } = authenticating({
      type: 'sasl-scram',
      account: 'marmot',
      password: secret('p'),
    });
    session.on((event) => events.push(event));

    await session.connect();
    negotiate(transport, 'PLAIN');
    await settle();

    expect(events.some((event) => event.kind === 'auth-failed')).toBe(true);
    // Registration continues rather than stalling on a mechanism we cannot use.
    expect(transport.sent).toContain('CAP END');
  });

  it('does not send an empty password when the saved one cannot be read', async () => {
    const transport = new FakeTransport();
    const events: SessionEvent[] = [];
    const session = createSession({
      profile: profile({
        auth: { type: 'sasl-plain', account: 'marmot', password: secret('p') },
      }),
      transport,
      resolveSecret: async () => undefined,
      now,
    });
    session.on((event) => events.push(event));

    await session.connect();
    negotiate(transport);
    await settle();

    // Only the abort goes out; no mechanism is chosen and no payload is sent.
    expect(
      transport.sent.filter(
        (line) => line.startsWith('AUTHENTICATE ') && line !== 'AUTHENTICATE *',
      ),
    ).toEqual([]);
    expect(events.some((event) => event.kind === 'auth-failed')).toBe(true);
  });

  it('aborts the exchange rather than leaving it half-open', async () => {
    const transport = new FakeTransport();
    const session = createSession({
      profile: profile({
        auth: { type: 'sasl-plain', account: 'marmot', password: secret('p') },
      }),
      transport,
      resolveSecret: async () => undefined,
      now,
    });
    await session.connect();
    negotiate(transport);
    await settle();

    expect(transport.sent).toContain('AUTHENTICATE *');
  });
});

describe('the raw log', () => {
  it('records both directions, in order', async () => {
    const { transport, session } = build();
    await session.connect();
    transport.receive(':irc.test 001 marmot :Welcome');

    const log = session.state.rawLog;
    expect(log[0]).toEqual({
      at: now(),
      direction: 'out',
      line: 'CAP LS 302',
    });
    expect(log.some((entry) => entry.direction === 'in' && entry.line.includes('001'))).toBe(true);
  });

  it('keeps a line that does not parse, because it is still evidence', async () => {
    const { transport, session } = build();
    await session.connect();
    transport.receive('   ');

    expect(session.state.rawLog.some((entry) => entry.line === '   ')).toBe(true);
  });
});

describe('being away, and being invited', () => {
  const connected = async () => {
    const built = build();
    await built.session.connect();
    built.transport.receive(':irc.test 001 marmot :Welcome');
    built.transport.sent.length = 0;
    return built;
  };

  it('asks to be marked away with a message, and back with nothing', async () => {
    const { transport, session } = await connected();

    session.setAway('Back later');
    expect(transport.sent).toContain('AWAY :Back later');

    session.setAway();
    expect(transport.sent).toContain('AWAY');
  });

  // The server's own reply moves the state. Setting it here would show somebody
  // as away on a network that refused the request.
  it('does not mark itself away before the server says so', async () => {
    const { session } = await connected();
    session.setAway('Back later');
    expect(session.state.away).toBe(false);
  });

  it('invites somebody into a channel', async () => {
    const { transport, session } = await connected();
    session.invite('tamsin', '#marmotter');
    expect(transport.sent).toContain('INVITE tamsin #marmotter');
  });

  // IRC has no way to decline an invitation. A button that claimed to tell
  // somebody "no" while sending nothing would be a lie about what happened.
  it('dismisses an invitation without telling the network anything', async () => {
    const { transport, session } = await connected();
    transport.receive(':tamsin!~t@host.example INVITE marmot :#ircv3');
    expect(session.state.invites).toHaveLength(1);

    transport.sent.length = 0;
    session.dismissInvite('#ircv3');
    expect(session.state.invites).toEqual([]);
    expect(transport.sent).toEqual([]);
  });
});

describe('sending', () => {
  const inChannel = async () => {
    const built = build();
    await built.session.connect();
    built.transport.receive(
      ':irc.test 001 marmot :Welcome',
      ':irc.test 376 marmot :End of MOTD',
      ':marmot!~m@host JOIN #test',
    );
    return built;
  };

  it('shows a message before the server confirms it', async () => {
    const { transport, session } = await inChannel();
    session.sendMessage('#test', 'hello');

    const channel = session.state.channels.get('#test');
    expect(channel?.messages.at(-1)?.text).toBe('hello');
    expect(channel?.messages.at(-1)?.pending).toBe(true);
    expect(transport.sent).toContain('PRIVMSG #test :hello');
  });

  it('reconciles the echo against what was already shown', async () => {
    const { transport, session } = await inChannel();
    session.sendMessage('#test', 'hello');
    transport.receive(':marmot!~m@host PRIVMSG #test :hello');

    const shown = session.state.channels
      .get('#test')
      ?.messages.filter((message) => message.text === 'hello');
    expect(shown).toHaveLength(1);
    expect(shown?.[0]?.pending).toBe(false);
  });

  it('sends each line of a multi-line message separately', async () => {
    const { transport, session } = await inChannel();
    session.sendMessage('#test', 'one\ntwo');

    expect(transport.sent).toContain('PRIVMSG #test :one');
    expect(transport.sent).toContain('PRIVMSG #test :two');
  });

  it('wraps an action in CTCP', async () => {
    const { transport, session } = await inChannel();
    session.sendAction('#test', 'waves');

    expect(transport.sent.some((line) => line.includes('ACTION waves'))).toBe(true);
    expect(session.state.channels.get('#test')?.messages.at(-1)?.kind).toBe('action');
  });

  it('passes a raw line straight through, as /quote does', async () => {
    const { transport, session } = await inChannel();
    session.send('STATS m');
    expect(transport.sent).toContain('STATS m');
  });

  it('names a reason when quitting', async () => {
    const { transport, session } = await inChannel();
    session.disconnect('back later');
    expect(transport.sent).toContain('QUIT :back later');
    expect(transport.disconnected).toBe(true);
  });
});

describe('the mute list', () => {
  const inChannel = async () => {
    const built = build();
    await built.session.connect();
    built.transport.receive(
      ':irc.test 001 marmot :Welcome',
      ':irc.test 376 marmot :End of MOTD',
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :marmot tamsin',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    );
    return built;
  };

  it('drops a muted person’s messages before they reach the buffer', async () => {
    const { transport, session } = await inChannel();
    session.addIgnore('tamsin');
    transport.receive(':tamsin!~t@host PRIVMSG #test :spam');

    const texts = session.state.channels.get('#test')?.messages.map((message) => message.text);
    expect(texts).not.toContain('spam');
  });

  it('sends nothing, so the muted person cannot tell', async () => {
    const { transport, session } = await inChannel();
    const before = transport.sent.length;
    session.addIgnore('tamsin');
    transport.receive(':tamsin!~t@host PRIVMSG #test :spam');

    expect(transport.sent).toHaveLength(before);
  });

  it('still lets other people through', async () => {
    const { transport, session } = await inChannel();
    session.addIgnore('tamsin');
    transport.receive(':jonquil!~j@host PRIVMSG #test :hello');

    const texts = session.state.channels.get('#test')?.messages.map((message) => message.text);
    expect(texts).toContain('hello');
  });

  it('keeps the member list right when events are muted too', async () => {
    const { transport, session } = await inChannel();
    session.addIgnore('tamsin', { scope: { events: true } });
    transport.receive(':tamsin!~t@host PART #test :leaving');

    const channel = session.state.channels.get('#test');
    // The part is not shown...
    expect(channel?.messages.some((message) => message.kind === 'part')).toBe(false);
    // ...but it really happened.
    expect(channel?.members.has('tamsin')).toBe(false);
  });

  it('stops muting once the rule lapses', async () => {
    const clock = vi.fn(() => new Date('2026-08-02T12:00:00.000Z'));
    const transport = new FakeTransport();
    const session = createSession({ profile: profile(), transport, now: clock });
    await session.connect();
    transport.receive(
      ':irc.test 001 marmot :Welcome',
      ':irc.test 376 marmot :End of MOTD',
      ':marmot!~m@host JOIN #test',
    );

    session.addIgnore('tamsin', { durationMs: 60_000 });
    clock.mockReturnValue(new Date('2026-08-02T12:02:00.000Z'));
    transport.receive(':tamsin!~t@host PRIVMSG #test :later');

    const texts = session.state.channels.get('#test')?.messages.map((message) => message.text);
    expect(texts).toContain('later');
    expect(session.state.ignores).toHaveLength(0);
  });

  it('removes a rule by the shorthand the user typed', async () => {
    const { session } = await inChannel();
    session.addIgnore('tamsin');
    session.removeIgnore('tamsin');
    expect(session.state.ignores).toHaveLength(0);
  });
});

describe('the notify list', () => {
  const registered = async (isupport: string) => {
    const built = build();
    await built.session.connect();
    built.transport.receive(
      ':irc.test 001 marmot :Welcome',
      `:irc.test 005 marmot ${isupport} :are supported by this server`,
      ':irc.test 376 marmot :End of MOTD',
    );
    return built;
  };

  it('registers nicks with whatever mechanism the network has', async () => {
    const { transport, session } = await registered('MONITOR=100');
    session.addNotify(['tamsin']);
    expect(transport.sent).toContain('MONITOR + tamsin');
  });

  it('uses WATCH where that is what the network offers', async () => {
    const { transport, session } = await registered('WATCH=128');
    session.addNotify(['tamsin']);
    expect(transport.sent).toContain('WATCH +tamsin');
  });

  it('reports what the network would not accept', async () => {
    const { session } = await registered('MONITOR=1');
    expect(session.addNotify(['tamsin', 'jonquil'])).toEqual(['jonquil']);
  });

  it('removes a nick', async () => {
    const { transport, session } = await registered('MONITOR=100');
    session.addNotify(['tamsin']);
    session.removeNotify(['tamsin']);
    expect(transport.sent).toContain('MONITOR - tamsin');
  });
});

describe('history', () => {
  const withHistory = async () => {
    const built = build();
    await built.session.connect();
    built.transport.receive(
      ':irc.test 001 marmot :Welcome',
      ':irc.test 005 marmot CHATHISTORY=50 CHANTYPES=# :are supported by this server',
      ':irc.test 376 marmot :End of MOTD',
      ':marmot!~m@host JOIN #test',
      '@msgid=m5;time=2026-08-02T09:05:00.000Z :jonquil!~j@host PRIVMSG #test :fifth',
    );
    return built;
  };

  it('loads the page before what is shown', async () => {
    const { transport, session } = await withHistory();
    session.loadOlder('#test');
    expect(transport.sent).toContain('CHATHISTORY BEFORE #test msgid=m5 50');
  });

  it('asks for nothing on a network with no history', async () => {
    const built = build();
    await built.session.connect();
    built.transport.receive(
      ':irc.test 001 marmot :Welcome',
      ':irc.test 376 marmot :End of MOTD',
      ':marmot!~m@host JOIN #test',
    );
    const before = built.transport.sent.length;
    built.session.loadOlder('#test');
    expect(built.transport.sent).toHaveLength(before);
  });
});

describe('losing the connection', () => {
  let built: ReturnType<typeof build>;

  beforeEach(async () => {
    built = build();
    await built.session.connect();
    built.transport.receive(':irc.test 001 marmot :Welcome', ':irc.test 376 marmot :End of MOTD');
  });

  it('records why', () => {
    built.transport.close({ kind: 'network-error', message: 'reset' });
    expect(built.session.state.phase).toBe('disconnected');
    expect(built.session.state.lastClose).toEqual({ kind: 'network-error', message: 'reset' });
  });

  it('drops half-open batches, so the next connection does not inherit them', () => {
    built.transport.receive(':irc.test BATCH +h1 chathistory #test');
    expect(built.session.state.batches.size).toBe(1);

    built.transport.close();
    expect(built.session.state.batches.size).toBe(0);
  });

  it('clears in-flight history requests', () => {
    built.transport.receive(
      ':irc.test 005 marmot CHATHISTORY=50 CHANTYPES=# :are supported',
      ':marmot!~m@host JOIN #test',
    );
    built.session.loadOlder('#test');
    built.transport.close();

    expect(built.session.state.channels.get('#test')?.historyPending).toBeUndefined();
  });

  it('tells whoever is listening', () => {
    const events: SessionEvent[] = [];
    built.session.on((event) => events.push(event));
    built.transport.close();
    expect(events.some((event) => event.kind === 'closed')).toBe(true);
  });
});

describe('signing in to the account service', () => {
  // The legacy path, for networks without SASL. It was in the profile schema
  // from the start and never acted on, so a profile configured this way
  // connected and quietly stayed signed out.
  const build = (resolved: string | undefined) => {
    const transport = new FakeTransport();
    const session = createSession({
      profile: profile({
        auth: { type: 'nickserv', account: 'marmot', password: secret('nickserv') },
      }),
      transport,
      now,
      resolveSecret: async () => resolved,
    });
    return { transport, session };
  };

  it('identifies once the connection is up, not during registration', async () => {
    const { transport, session } = build('hunter2');
    await session.connect();
    // The MOTD's end is what says registration finished; 001 only says hello.
    transport.receive(':irc.test 001 marmot :Welcome', ':irc.test 376 marmot :End of /MOTD');
    await settle();

    expect(transport.sent).toContain('PRIVMSG NickServ :IDENTIFY marmot hunter2');
    // Nothing about it belongs in registration, where there is no service yet.
    const welcome = transport.sent.indexOf('NICK marmot');
    expect(transport.sent.indexOf('PRIVMSG NickServ :IDENTIFY marmot hunter2')).toBeGreaterThan(
      welcome,
    );
  });

  it('says so rather than sending a blank password', async () => {
    const { transport, session } = build(undefined);
    const events: SessionEvent[] = [];
    session.on((event) => events.push(event));

    await session.connect();
    transport.receive(':irc.test 001 marmot :Welcome', ':irc.test 376 marmot :End of /MOTD');
    await settle();

    expect(transport.sent.some((line) => line.startsWith('PRIVMSG NickServ'))).toBe(false);
    expect(events.some((event) => event.kind === 'auth-failed')).toBe(true);
  });

  it('leaves a profile with no login alone', async () => {
    const transport = new FakeTransport();
    const session = createSession({ profile: profile(), transport, now });
    await session.connect();
    transport.receive(':irc.test 001 marmot :Welcome', ':irc.test 376 marmot :End of /MOTD');
    await settle();

    expect(transport.sent.some((line) => line.startsWith('PRIVMSG NickServ'))).toBe(false);
  });
});

describe('a flood of replies', () => {
  // A bare LIST on a large network is tens of thousands of numerics in a few
  // seconds. One announcement each is one render of the whole interface each,
  // which is what made the channel browser stop responding.
  it('is announced in batches rather than one row at a time', async () => {
    const { transport, session } = build();
    await session.connect();
    transport.receive(':irc.test 001 marmot :Welcome');

    session.listChannels();

    let announcements = 0;
    session.subscribe(() => (announcements += 1));
    for (let index = 0; index < 500; index += 1) {
      transport.receive(`:irc.test 322 marmot #channel${index} 12 :a topic`);
    }

    // Five hundred rows, no announcement yet — but the state is already right
    // for anybody who asks.
    expect(announcements).toBe(0);
    expect(session.state.directory.entries).toHaveLength(500);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(announcements).toBe(1);
  });

  it('announces the end of the list at once', async () => {
    const { transport, session } = build();
    await session.connect();
    transport.receive(':irc.test 001 marmot :Welcome');
    session.listChannels();
    transport.receive(':irc.test 322 marmot #one 3 :a topic');

    let announcements = 0;
    session.subscribe(() => (announcements += 1));
    transport.receive(':irc.test 323 marmot :End of /LIST');

    expect(announcements).toBe(1);
    expect(session.state.directory.complete).toBe(true);
  });
});

describe('teardown', () => {
  it('stops listening and disconnects', async () => {
    const { transport, session } = build();
    await session.connect();

    const seen: number[] = [];
    session.subscribe(() => seen.push(1));
    session.destroy();

    transport.receive(':irc.test 001 marmot :Welcome');
    expect(seen).toHaveLength(0);
    expect(transport.disconnected).toBe(true);
  });
});
