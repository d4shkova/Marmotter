import type { CloseReason, ConnectOptions, NetworkProfile, Transport } from '@marmotter/shared';
import { defaultLoggingPolicy } from '@marmotter/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createSession } from './session.js';
import { registerNetwork, selectActiveNetwork, selectNetworks, useNetworks } from './store.js';

class FakeTransport implements Transport {
  readonly sent: string[] = [];
  disconnected = false;
  private lineCallbacks: ((line: string) => void)[] = [];
  private closeCallbacks: ((reason: CloseReason) => void)[] = [];

  async connect(_options: ConnectOptions): Promise<void> {}
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
  receive(...lines: string[]): void {
    for (const line of lines) {
      for (const callback of [...this.lineCallbacks]) {
        callback(line);
      }
    }
  }
}

const profile = (id: string, name: string): NetworkProfile => ({
  id,
  name,
  servers: [{ host: `irc.${id}`, port: 6697, tls: { mode: 'tls', verifyCert: true } }],
  identity: { nick: 'marmot', altNicks: [], username: 'marmot', realname: 'Marmot' },
  autojoin: [],
  connectCommands: [],
  encoding: 'utf-8',
  autoReconnect: true,
  logging: defaultLoggingPolicy,
});

const register = (id: string, name = id) => {
  const transport = new FakeTransport();
  const session = registerNetwork({ profile: profile(id, name), transport });
  return { transport, session };
};

afterEach(() => {
  useNetworks.getState().reset();
});

describe('the registry', () => {
  it('holds a network under its own ID', () => {
    register('libera', 'Libera.Chat');
    expect(useNetworks.getState().networks.get('libera')?.name).toBe('Libera.Chat');
  });

  it('holds several networks at once, with no current one', () => {
    register('libera');
    register('oftc');
    register('dashkova');

    const state = useNetworks.getState();
    expect(state.networks.size).toBe(3);
    // Nothing is selected by registering; selection is the interface's business.
    expect(state.selection.networkId).toBeUndefined();
  });

  it('keeps each network’s state separate', () => {
    const libera = register('libera');
    const oftc = register('oftc');

    libera.transport.receive(':irc.libera 001 marmot :Welcome');
    libera.transport.receive(':marmot!~m@host JOIN #libera-channel');

    const state = useNetworks.getState();
    expect(state.networks.get('libera')?.channels.size).toBe(1);
    expect(state.networks.get('oftc')?.channels.size).toBe(0);
    expect(oftc.transport.sent).toEqual([]);
  });

  it('updates the stored state as a session reduces', () => {
    const { transport } = register('libera');
    expect(useNetworks.getState().networks.get('libera')?.phase).toBe('disconnected');

    transport.receive(':irc.libera 001 marmot :Welcome');
    expect(useNetworks.getState().networks.get('libera')?.nick).toBe('marmot');
  });

  it('does not connect a network just because it was added', () => {
    const { transport } = register('libera');
    expect(transport.sent).toEqual([]);
  });

  it('hands back the session for a network', () => {
    const { session } = register('libera');
    expect(useNetworks.getState().sessionOf('libera')).toBe(session);
    expect(useNetworks.getState().sessionOf('nothing')).toBeUndefined();
  });

  it('replaces a profile without disturbing its live state', () => {
    const { transport } = register('libera', 'Libera.Chat');
    transport.receive(':irc.libera 001 marmot :Welcome');

    useNetworks.getState().updateProfile('libera', { autoReconnect: false });

    expect(useNetworks.getState().profiles.get('libera')?.autoReconnect).toBe(false);
    expect(useNetworks.getState().networks.get('libera')?.nick).toBe('marmot');
  });

  it('ignores an update for a network that is not there', () => {
    useNetworks.getState().updateProfile('nothing', { name: 'x' });
    expect(useNetworks.getState().profiles.size).toBe(0);
  });

  it('tears the session down when a network is forgotten', () => {
    const { transport } = register('libera');
    useNetworks.getState().removeProfile('libera');

    expect(useNetworks.getState().networks.has('libera')).toBe(false);
    expect(transport.disconnected).toBe(true);

    // The session is released, so nothing it hears reaches the store.
    transport.receive(':irc.libera 001 marmot :Welcome');
    expect(useNetworks.getState().networks.has('libera')).toBe(false);
  });

  it('clears the selection when the selected network is forgotten', () => {
    register('libera');
    useNetworks.getState().select('libera', '#test');
    useNetworks.getState().removeProfile('libera');

    expect(useNetworks.getState().selection).toEqual({
      networkId: undefined,
      target: undefined,
    });
  });

  it('leaves the selection alone when a different network is forgotten', () => {
    register('libera');
    register('oftc');
    useNetworks.getState().select('libera', '#test');
    useNetworks.getState().removeProfile('oftc');

    expect(useNetworks.getState().selection.networkId).toBe('libera');
  });

  it('replaces a session when the same ID is registered twice', () => {
    const first = register('libera');
    const second = register('libera');

    expect(first.transport.disconnected).toBe(true);
    expect(useNetworks.getState().sessionOf('libera')).toBe(second.session);

    // The old session no longer reaches the store.
    first.transport.receive(':irc.libera 001 marmot :Welcome');
    expect(useNetworks.getState().networks.get('libera')?.phase).toBe('disconnected');
  });

  it('releases everything on reset', () => {
    const libera = register('libera');
    const oftc = register('oftc');
    useNetworks.getState().reset();

    expect(useNetworks.getState().networks.size).toBe(0);
    expect(useNetworks.getState().profiles.size).toBe(0);
    expect(libera.transport.disconnected).toBe(true);
    expect(oftc.transport.disconnected).toBe(true);
  });
});

describe('selection', () => {
  it('is interface state, and changes no connection', () => {
    const { transport } = register('libera');
    useNetworks.getState().select('libera', '#test');

    expect(useNetworks.getState().selection).toEqual({
      networkId: 'libera',
      target: '#test',
    });
    expect(transport.sent).toEqual([]);
  });

  it('reads back the selected network', () => {
    register('libera', 'Libera.Chat');
    useNetworks.getState().select('libera');
    expect(selectActiveNetwork(useNetworks.getState())?.name).toBe('Libera.Chat');
  });

  it('reads back nothing when nothing is selected', () => {
    register('libera');
    expect(selectActiveNetwork(useNetworks.getState())).toBeUndefined();
  });

  it('can be cleared', () => {
    register('libera');
    useNetworks.getState().select('libera', '#test');
    useNetworks.getState().select(undefined);
    expect(useNetworks.getState().selection.networkId).toBeUndefined();
  });
});

describe('listing networks', () => {
  it('lists them in the order they were added', () => {
    register('libera', 'Libera.Chat');
    register('oftc', 'OFTC');
    register('dashkova', 'dashkova.co.uk');

    expect(selectNetworks(useNetworks.getState()).map((network) => network.name)).toEqual([
      'Libera.Chat',
      'OFTC',
      'dashkova.co.uk',
    ]);
  });

  it('lists nothing when nothing is registered', () => {
    expect(selectNetworks(useNetworks.getState())).toEqual([]);
  });
});

describe('registering a session built elsewhere', () => {
  it('accepts one, so a caller can wire its own transport', () => {
    const transport = new FakeTransport();
    const session = createSession({ profile: profile('custom', 'Custom'), transport });
    useNetworks.getState().addProfile(profile('custom', 'Custom'), session);

    expect(useNetworks.getState().sessionOf('custom')).toBe(session);
  });
});
