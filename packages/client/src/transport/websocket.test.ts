import type { CloseReason, ServerEndpoint } from '@marmotter/shared';
import { describe, expect, it } from 'vitest';
import { IRC_SUBPROTOCOLS, type WebSocketLike, createWebSocketTransport } from './websocket.js';

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  closed: { code?: number; reason?: string } | undefined;

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: readonly string[],
  ) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    };
  }

  open(): void {
    this.onopen?.({});
  }

  message(data: unknown): void {
    this.onmessage?.({ data });
  }

  serverClose(code = 1000, reason = '', wasClean = true): void {
    this.onclose?.({ code, reason, wasClean });
  }
}

const wsEndpoint = (url = 'wss://irc.example.org/webirc'): ServerEndpoint => ({
  host: 'irc.example.org',
  port: 443,
  tls: { mode: 'websocket', url },
});

const setup = () => {
  const sockets: FakeSocket[] = [];
  const transport = createWebSocketTransport((url, protocols) => {
    const socket = new FakeSocket(url, protocols);
    sockets.push(socket);
    return socket;
  });
  return { transport, sockets, latest: () => sockets[sockets.length - 1] };
};

describe('createWebSocketTransport', () => {
  it('connects to the endpoint URL and asks for the IRC subprotocol', async () => {
    const { transport, latest } = setup();
    const pending = transport.connect({ endpoint: wsEndpoint() });

    expect(latest()?.url).toBe('wss://irc.example.org/webirc');
    expect(latest()?.protocols).toEqual(IRC_SUBPROTOCOLS);

    latest()?.open();
    await expect(pending).resolves.toBeUndefined();
  });

  it('refuses an endpoint that is not a WebSocket', async () => {
    const { transport } = setup();
    await expect(
      transport.connect({
        endpoint: { host: 'irc.example.org', port: 6697, tls: { mode: 'tls', verifyCert: true } },
      }),
    ).rejects.toThrow(/wss/);
  });

  it('reports each message as a line', async () => {
    const { transport, latest } = setup();
    const received: string[] = [];
    transport.onLine((line) => received.push(line));

    const pending = transport.connect({ endpoint: wsEndpoint() });
    latest()?.open();
    await pending;

    latest()?.message(':srv 001 me :Welcome');
    expect(received).toEqual([':srv 001 me :Welcome']);
  });

  it('splits a frame carrying several messages', async () => {
    const { transport, latest } = setup();
    const received: string[] = [];
    transport.onLine((line) => received.push(line));

    const pending = transport.connect({ endpoint: wsEndpoint() });
    latest()?.open();
    await pending;

    // A server is free to batch, subprotocol or not.
    latest()?.message('ONE\r\nTWO\r\n');
    expect(received).toEqual(['ONE', 'TWO']);
  });

  it('ignores a binary frame rather than guessing at its contents', async () => {
    const { transport, latest } = setup();
    const received: string[] = [];
    transport.onLine((line) => received.push(line));

    const pending = transport.connect({ endpoint: wsEndpoint() });
    latest()?.open();
    await pending;

    latest()?.message(new Uint8Array([1, 2, 3]));
    expect(received).toEqual([]);
  });

  it('appends the terminator when sending', async () => {
    const { transport, latest } = setup();
    const pending = transport.connect({ endpoint: wsEndpoint() });
    latest()?.open();
    await pending;

    transport.send('PING :token');
    expect(latest()?.sent).toEqual(['PING :token\r\n']);
  });

  it('refuses to send before connecting', () => {
    const { transport } = setup();
    expect(() => transport.send('PING')).toThrow(/not open/);
  });

  it('reports a clean server close as a server close', async () => {
    const { transport, latest } = setup();
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    const pending = transport.connect({ endpoint: wsEndpoint() });
    latest()?.open();
    await pending;

    latest()?.serverClose(1000, '', true);
    expect(closes).toEqual([{ kind: 'server' }]);
  });

  it('reports an abrupt close as a network error', async () => {
    const { transport, latest } = setup();
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    const pending = transport.connect({ endpoint: wsEndpoint() });
    latest()?.open();
    await pending;

    latest()?.serverClose(1006, 'abnormal', false);
    expect(closes).toEqual([{ kind: 'network-error', message: 'abnormal' }]);
  });

  it('rejects when the socket closes before it opened', async () => {
    const { transport, latest } = setup();
    const pending = transport.connect({ endpoint: wsEndpoint() });

    latest()?.serverClose(1006, 'refused', false);
    await expect(pending).rejects.toThrow(/refused/);
  });

  it('rejects when the socket errors before it opened', async () => {
    const { transport, latest } = setup();
    const pending = transport.connect({ endpoint: wsEndpoint() });

    latest()?.onerror?.({});
    await expect(pending).rejects.toThrow(/could not be opened/);
  });

  it('times out rather than hanging', async () => {
    const { transport, latest } = setup();
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    const pending = transport.connect({ endpoint: wsEndpoint(), timeoutMs: 10 });
    await expect(pending).rejects.toThrow(/in time/);

    expect(closes).toEqual([{ kind: 'timeout' }]);
    expect(latest()?.closed).toBeDefined();
  });

  it('closes cleanly on disconnect and reports a user close', async () => {
    const { transport, latest } = setup();
    const closes: CloseReason[] = [];
    transport.onClose((reason) => closes.push(reason));

    const pending = transport.connect({ endpoint: wsEndpoint() });
    latest()?.open();
    await pending;

    transport.disconnect();
    transport.disconnect();

    expect(latest()?.closed).toEqual({ code: 1000, reason: 'client disconnect' });
    expect(closes).toEqual([{ kind: 'user' }]);
  });

  it('refuses a second connect on the same transport', async () => {
    const { transport, latest } = setup();
    const pending = transport.connect({ endpoint: wsEndpoint() });
    latest()?.open();
    await pending;

    await expect(transport.connect({ endpoint: wsEndpoint() })).rejects.toThrow(
      /already connected/,
    );
  });
});
