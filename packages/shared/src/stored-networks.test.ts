import { describe, expect, it } from 'vitest';
import type { NetworkProfile } from './profile.js';
import { readStoredNetwork, readStoredNetworks, writeStoredNetwork } from './stored-networks.js';

const profile = (overrides: Partial<NetworkProfile> = {}): NetworkProfile => ({
  id: 'n1',
  name: 'Libera.Chat',
  servers: [{ host: 'irc.libera.chat', port: 6697, tls: { mode: 'tls', verifyCert: true } }],
  identity: {
    nick: 'tamsin',
    altNicks: ['tamsin_', 'tamsin__'],
    username: 'tamsin',
    realname: 'Tamsin',
  },
  autojoin: [{ target: '#marmotter' }],
  connectCommands: [],
  encoding: 'utf-8',
  autoReconnect: true,
  ...overrides,
});

/** Through the file and back, which is what actually has to hold. */
const roundTrip = (input: NetworkProfile): NetworkProfile | undefined =>
  readStoredNetwork(JSON.parse(JSON.stringify(writeStoredNetwork(input))));

describe('a profile through the file and back', () => {
  it('comes back as it went in', () => {
    const input = profile();
    expect(roundTrip(input)).toEqual(input);
  });

  it('keeps the security choice for each endpoint', () => {
    const pinned = profile({
      servers: [
        {
          host: 'irc.dashkova.co.uk',
          port: 6697,
          tls: { mode: 'tls', verifyCert: false, pinnedFingerprint: 'AA:BB' },
        },
        { host: 'irc.example.net', port: 6667, tls: { mode: 'off' } },
      ],
    });
    expect(roundTrip(pinned)?.servers).toEqual(pinned.servers);
  });

  it('keeps a WebSocket endpoint, which is the only kind a browser can use', () => {
    const ws = profile({
      servers: [
        {
          host: 'irc.example.net',
          port: 443,
          tls: { mode: 'websocket', url: 'wss://irc.example.net/webirc' },
        },
      ],
    });
    expect(roundTrip(ws)?.servers[0]?.tls).toEqual({
      mode: 'websocket',
      url: 'wss://irc.example.net/webirc',
    });
  });

  it('keeps the operator flag and the autojoin list', () => {
    const input = profile({
      operatorCommands: true,
      autojoin: [{ target: '#marmotter' }, { target: '#staff' }],
      connectCommands: ['MODE tamsin +i'],
    });
    const restored = roundTrip(input);
    expect(restored?.operatorCommands).toBe(true);
    expect(restored?.autojoin).toEqual(input.autojoin);
    expect(restored?.connectCommands).toEqual(['MODE tamsin +i']);
  });

  it("keeps a network's own logging policy, and the absence of one", () => {
    const withPolicy = profile({
      logging: {
        enabled: true,
        scope: { channels: true, privateMessages: false, serverNotices: false },
        format: 'plaintext',
        retentionDays: 30,
      },
    });
    expect(roundTrip(withPolicy)?.logging).toEqual(withPolicy.logging);
    // Absent means "follow the global policy", which has to survive as absence
    // rather than becoming a policy of its own.
    expect(roundTrip(profile())?.logging).toBeUndefined();
  });
});

describe('what never reaches the file', () => {
  it('writes the key to a password, never the password', () => {
    // The whole point of SecretRef. A file of IRC passwords in somebody's app
    // data folder is what this type exists to prevent.
    const written = writeStoredNetwork(
      profile({
        auth: {
          type: 'sasl-plain',
          account: 'tamsin',
          password: { kind: 'secret-ref', id: 'secret:1:abc' },
        },
      }),
    );
    const text = JSON.stringify(written);

    expect(text).toContain('secret:1:abc');
    expect(text).toContain('sasl-plain');
    expect(text).not.toContain('hunter2');
  });

  it('writes only the fields it names, so a new one is never persisted by accident', () => {
    // Spreading the profile would silently carry a field added later — which is
    // how a secret ends up in a settings file.
    const written = writeStoredNetwork({
      ...profile(),
      // A field a future version might add, standing in for the accident.
      somethingSensitive: 'hunter2',
    } as NetworkProfile & { somethingSensitive: string });

    expect(JSON.stringify(written)).not.toContain('hunter2');
  });
});

describe('reading a file somebody has edited', () => {
  it('keeps the sign-in method when its password has gone', () => {
    // The keychain having been cleared loses the password, which is
    // recoverable. Losing the knowledge that this network uses SASL is not, so
    // the method survives and the client asks for the password when connecting.
    const stored = writeStoredNetwork(
      profile({
        auth: {
          type: 'sasl-plain',
          account: 'tamsin',
          password: { kind: 'secret-ref', id: 'secret:1:abc' },
        },
      }),
    ) as Record<string, unknown>;
    const auth = stored['auth'] as Record<string, unknown>;

    const restored = readStoredNetwork({ ...stored, auth: { ...auth, password: undefined } });
    // Without a reference there is nothing to resolve, so the method is dropped
    // rather than restored pointing at nothing.
    expect(restored?.auth).toBeUndefined();
    expect(restored?.name).toBe('Libera.Chat');
  });

  it('never downgrades a mangled security setting to something weaker', () => {
    // The safe direction. A malformed record must not quietly turn certificate
    // checking off, or drop TLS altogether.
    const restored = readStoredNetwork({
      ...(writeStoredNetwork(profile()) as Record<string, unknown>),
      servers: [{ host: 'irc.libera.chat', port: 6697, tls: { mode: 'nonsense' } }],
    });

    expect(restored?.servers[0]?.tls).toEqual({ mode: 'tls', verifyCert: true });
  });

  it('drops a network with nowhere to connect', () => {
    expect(
      readStoredNetwork({ ...(writeStoredNetwork(profile()) as object), servers: [] }),
    ).toBeUndefined();
  });

  it('drops a network with no name to connect under', () => {
    const stored = writeStoredNetwork(profile()) as Record<string, unknown>;
    expect(readStoredNetwork({ ...stored, identity: { nick: '' } })).toBeUndefined();
  });

  it('drops a port that is not a port', () => {
    const stored = writeStoredNetwork(profile()) as Record<string, unknown>;
    for (const port of [0, 70000, -1, 6697.5, '6697', null]) {
      const restored = readStoredNetwork({
        ...stored,
        servers: [{ host: 'irc.libera.chat', port, tls: { mode: 'tls', verifyCert: true } }],
      });
      expect(restored, String(port)).toBeUndefined();
    }
  });

  it('skips what will not load and keeps the rest', () => {
    // One bad record must not cost somebody every network they configured.
    const good = writeStoredNetwork(profile());
    const second = writeStoredNetwork(profile({ id: 'n2', name: 'OFTC' }));

    expect(readStoredNetworks([good, 'not a profile', null, { id: 'x' }, second])).toHaveLength(2);
  });

  it('reads nothing out of anything that is not a list', () => {
    expect(readStoredNetworks(undefined)).toEqual([]);
    expect(readStoredNetworks('networks')).toEqual([]);
    expect(readStoredNetworks({ networks: [] })).toEqual([]);
  });

  it('fills in what it can rather than dropping a profile over a small gap', () => {
    const restored = readStoredNetwork({
      id: 'n1',
      name: 'Libera.Chat',
      identity: { nick: 'tamsin' },
      servers: [{ host: 'irc.libera.chat', port: 6697 }],
    });

    expect(restored?.identity).toEqual({
      nick: 'tamsin',
      altNicks: [],
      username: 'tamsin',
      realname: 'tamsin',
    });
    expect(restored?.encoding).toBe('utf-8');
    expect(restored?.autoReconnect).toBe(true);
    expect(restored?.autojoin).toEqual([]);
  });
});
