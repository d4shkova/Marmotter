import type { CloseReason, ServerEndpoint } from '@marmotter/shared';
import { describe, expect, it, vi } from 'vitest';
import { CLOSE_EVENT, LINE_EVENT, type TauriBridge, createTauriTransport } from './tauri.js';

/** A bridge that records calls and lets a test push events back. */
const fakeBridge = (options: { connectId?: string; failConnect?: string } = {}) => {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const handlers = new Map<string, ((event: { payload: unknown }) => void)[]>();
  let unlistenCount = 0;

  const bridge: TauriBridge = {
    invoke: <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push(args === undefined ? { command } : { command, args });
      if (command === 'transport_connect') {
        return options.failConnect === undefined
          ? (Promise.resolve(options.connectId ?? 'conn-1') as Promise<T>)
          : Promise.reject(new Error(options.failConnect));
      }
      return Promise.resolve(undefined as T);
    },
    listen: <T>(event: string, handler: (event: { payload: T }) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler as (event: { payload: unknown }) => void);
      handlers.set(event, list);
      return Promise.resolve(() => {
        unlistenCount += 1;
      });
    },
    readTextFile: (path: string) => Promise.resolve(`PEM CONTENTS OF ${path}`),
  };

  return {
    bridge,
    calls,
    unlistenCount: () => unlistenCount,
    emit(event: string, payload: unknown) {
      for (const handler of handlers.get(event) ?? []) {
        handler({ payload });
      }
    },
  };
};

const endpoint = (tls: ServerEndpoint['tls']): ServerEndpoint => ({
  host: 'irc.example.org',
  port: 6697,
  tls,
});

describe('createTauriTransport', () => {
  it('opens a connection and reports lines', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);
    const received: string[] = [];
    transport.onLine((line) => received.push(line));

    await transport.connect({ endpoint: endpoint({ mode: 'tls', verifyCert: true }) });
    fake.emit(LINE_EVENT, { id: 'conn-1', line: ':srv 001 me :Welcome' });

    expect(received).toEqual([':srv 001 me :Welcome']);
  });

  it('sends the endpoint and verification mode the profile describes', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);

    await transport.connect({
      endpoint: endpoint({ mode: 'tls', verifyCert: true }),
      timeoutMs: 5000,
    });

    const request = fake.calls[0]?.args?.['request'] as Record<string, unknown>;
    expect(request['host']).toBe('irc.example.org');
    expect(request['port']).toBe(6697);
    expect(request['tls']).toEqual({ mode: 'tls', verifyCert: true, pinnedFingerprint: null });
    expect(request['timeoutMs']).toBe(5000);
  });

  it('passes a pinned fingerprint through', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);

    await transport.connect({
      endpoint: endpoint({ mode: 'tls', verifyCert: false, pinnedFingerprint: 'AA:BB' }),
    });

    const request = fake.calls[0]?.args?.['request'] as Record<string, unknown>;
    expect(request['tls']).toEqual({
      mode: 'tls',
      verifyCert: false,
      pinnedFingerprint: 'AA:BB',
    });
  });

  it('describes a plaintext endpoint as such', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);
    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });

    const request = fake.calls[0]?.args?.['request'] as Record<string, unknown>;
    expect(request['tls']).toEqual({ mode: 'off' });
  });

  it('refuses a WebSocket endpoint rather than treating it as plaintext', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);

    await expect(
      transport.connect({
        endpoint: endpoint({ mode: 'websocket', url: 'wss://irc.example.org' }),
      }),
    ).rejects.toThrow(/WebSocket/);
  });

  it('reads a client certificate through the bridge', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);

    await transport.connect({
      endpoint: endpoint({ mode: 'tls', verifyCert: true }),
      clientCertPath: '/home/me/cert.pem',
    });

    const request = fake.calls[0]?.args?.['request'] as Record<string, unknown>;
    expect(request['clientCertificate']).toEqual({
      certificatePem: 'PEM CONTENTS OF /home/me/cert.pem',
      keyPem: 'PEM CONTENTS OF /home/me/cert.pem',
    });
  });

  it('ignores events belonging to another connection', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);
    const received: string[] = [];
    transport.onLine((line) => received.push(line));

    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });
    fake.emit(LINE_EVENT, { id: 'conn-999', line: 'not ours' });

    expect(received).toEqual([]);
  });

  it.each([
    ['user', { kind: 'user' }],
    ['server', { kind: 'server' }],
    ['timeout', { kind: 'timeout' }],
    ['tls-error', { kind: 'tls-error', message: 'bad certificate' }],
    ['network-error', { kind: 'network-error', message: 'bad certificate' }],
  ])('maps the %s close back to the shared union', async (kind, expected) => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });
    fake.emit(CLOSE_EVENT, { id: 'conn-1', kind, message: 'bad certificate' });

    expect(closes).toEqual([expected]);
  });

  it('reports a close only once', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });
    fake.emit(CLOSE_EVENT, { id: 'conn-1', kind: 'server', message: '' });
    fake.emit(CLOSE_EVENT, { id: 'conn-1', kind: 'server', message: '' });

    expect(closes).toHaveLength(1);
  });

  it('unsubscribes from Tauri events when the connection ends', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);

    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });
    expect(fake.unlistenCount()).toBe(0);

    fake.emit(CLOSE_EVENT, { id: 'conn-1', kind: 'server', message: '' });
    expect(fake.unlistenCount()).toBe(2);
  });

  it('sends a line through the command', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);

    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });
    transport.send('PING :token');

    expect(fake.calls.at(-1)).toEqual({
      command: 'transport_send',
      args: { id: 'conn-1', line: 'PING :token' },
    });
  });

  it('refuses to send before connecting', () => {
    const transport = createTauriTransport(fakeBridge().bridge);
    expect(() => transport.send('PING')).toThrow(/not open/);
  });

  it('refuses a second connect on the same transport', async () => {
    const transport = createTauriTransport(fakeBridge().bridge);
    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });
    await expect(transport.connect({ endpoint: endpoint({ mode: 'off' }) })).rejects.toThrow(
      /already connected/,
    );
  });

  it('announces a user close on disconnect and stops there', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });
    transport.disconnect();
    transport.disconnect();

    expect(closes).toEqual([{ kind: 'user' }]);
    expect(fake.calls.map((call) => call.command)).toContain('transport_disconnect');
  });

  it('propagates a failure to open', async () => {
    const fake = fakeBridge({ failConnect: 'connection refused' });
    const transport = createTauriTransport(fake.bridge);

    await expect(transport.connect({ endpoint: endpoint({ mode: 'off' }) })).rejects.toThrow(
      /connection refused/,
    );
  });

  it('stops listeners that unsubscribe', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);
    const received: string[] = [];
    const stop = transport.onLine((line) => received.push(line));

    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });
    stop();
    fake.emit(LINE_EVENT, { id: 'conn-1', line: 'ignored' });

    expect(received).toEqual([]);
  });

  it('keeps other listeners working when one throws', async () => {
    const fake = fakeBridge();
    const transport = createTauriTransport(fake.bridge);
    const received: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    transport.onLine(() => {
      throw new Error('bad listener');
    });
    transport.onLine((line) => received.push(line));

    await transport.connect({ endpoint: endpoint({ mode: 'off' }) });
    fake.emit(LINE_EVENT, { id: 'conn-1', line: 'still delivered' });

    expect(received).toEqual(['still delivered']);
    spy.mockRestore();
  });
});
