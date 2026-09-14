/**
 * The download path, end to end: a bot's offer arriving on a real session and
 * reaching the shell that opens the socket.
 *
 * Every part of this was covered on its own — the parser, the store, the
 * matching rules, the Rust transfer — and the wiring between them was not. That
 * is the seam a file that never downloads hides in: the offer is parsed, the
 * row is right, the transfer works when called, and nothing calls it. So this
 * drives the whole client with a fake socket on one end and a fake shell on the
 * other, and asserts the one thing all of it exists to do.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CloseReason, NetworkProfile, Transport } from '@marmotter/shared';
import { useNetworks } from '@marmotter/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Marmotter } from './Marmotter.js';
import type { DccDownloadRequest, DccPassiveRequest, DccTransfer } from './dcc.js';
import { DEFAULT_USER_OPTIONS, useView } from './view-store.js';

const DELIM = '\x01';

// This file drives React from outside a component, which needs saying: without
// it every `act` warns that the environment does not support it, and the noise
// buries anything the run has to say.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A socket that goes nowhere, and a handle to push lines in from the server. */
class FakeTransport implements Transport {
  private lines: ((line: string) => void)[] = [];
  private closes: ((reason: CloseReason) => void)[] = [];
  readonly sent: string[] = [];

  static latest: FakeTransport | undefined;

  constructor() {
    FakeTransport.latest = this;
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }
  send(line: string): void {
    this.sent.push(line);
  }
  onLine(cb: (line: string) => void): () => void {
    this.lines.push(cb);
    return () => {
      this.lines = this.lines.filter((entry) => entry !== cb);
    };
  }
  onClose(cb: (reason: CloseReason) => void): () => void {
    this.closes.push(cb);
    return () => {
      this.closes = this.closes.filter((entry) => entry !== cb);
    };
  }
  disconnect(): void {}

  /** Delivers a line as though the server had sent it. */
  deliver(line: string): void {
    for (const cb of [...this.lines]) {
      cb(line);
    }
  }
}

const profile = (): NetworkProfile => ({
  id: 'testnet',
  name: 'TestNet',
  servers: [{ host: 'irc.example.net', port: 6697, tls: { mode: 'tls', verifyCert: true } }],
  identity: { nick: 'marmot', altNicks: [], username: 'marmot', realname: 'Marmot' },
  autojoin: [],
  connectCommands: [],
  encoding: 'utf-8',
  autoReconnect: false,
  logging: {
    enabled: false,
    scope: { channels: true, privateMessages: true, serverNotices: false },
    format: 'plaintext',
    retentionDays: 'forever',
  },
});

/** A shell that records what it was asked to fetch, and never settles it. */
function fakeShell() {
  const resumable = { bytes: 0 };
  const download = vi.fn<(request: DccDownloadRequest) => DccTransfer>(() => ({
    done: new Promise<string>(() => {}),
    cancel: () => {},
  }));
  const receivePassive = vi.fn<(request: DccPassiveRequest) => DccTransfer>(() => ({
    done: new Promise<string>(() => {}),
    cancel: () => {},
  }));
  return {
    download,
    receivePassive,
    /** How much an earlier attempt left behind; set per test. */
    resumable,
    capability: {
      download: (request: DccDownloadRequest) => download(request),
      receivePassive: (request: DccPassiveRequest) => receivePassive(request),
      async resumableBytes(): Promise<number> {
        return resumable.bytes;
      },
      defaultDownloadFolder: async (): Promise<string> => '/tmp/dl',
    },
  };
}

/** Brings a network up and registers it, the way the launch screen does. */
async function connected(shell: ReturnType<typeof fakeShell>) {
  const preferences = {
    load: async () => ({
      identity: {
        nick: 'marmot',
        altNick: 'marmot_',
        thirdNick: 'marmot__',
        realname: 'Marmot',
        email: '',
      },
      networks: [profile()],
      // Applied over the store on mount, so the monitor has to be switched on
      // here rather than in the store: the restore path is what a real launch
      // does, and it would otherwise put the defaults back.
      settings: { userOptions: { dccMonitorEnabled: true, downloadFolder: '/tmp/dl' } },
    }),
    save: async () => {},
  };

  render(
    <Marmotter
      createTransport={() => new FakeTransport()}
      dcc={shell.capability}
      preferences={preferences}
      persists
    />,
  );

  // The launch screen lists the restored network; connecting it is what builds
  // the session whose events this whole test is about.
  const connect = await screen.findByRole('button', { name: /^Connect/ });
  await act(async () => {
    connect.click();
  });

  const transport = FakeTransport.latest;
  if (transport === undefined) {
    throw new Error('no transport was built');
  }

  // Registration, so the session knows its own nick and a private message is
  // filed under the sender rather than under us.
  await act(async () => {
    transport.deliver(':irc.example.net 001 marmot :Welcome');
    transport.deliver(':irc.example.net 005 marmot CASEMAPPING=rfc1459 :are supported');
  });

  // The file list is a pane like any other; opening it is what puts the rows
  // and their Download buttons on screen.
  await act(async () => {
    useView.getState().setPane('dcc');
  });

  return transport;
}

/** Types into the composer and sends it, the way a person does. */
function typeCommand(text: string): void {
  const composer = screen.getAllByRole('textbox').find((box) => box.tagName === 'TEXTAREA');
  if (composer === undefined) {
    throw new Error('no composer on screen');
  }
  fireEvent.change(composer, { target: { value: text } });
  fireEvent.keyDown(composer, { key: 'Enter' });
}

beforeEach(() => {
  // The view store is a module singleton, so a test that left the file pane
  // open would hand the next one a client that never shows its launch screen.
  useView.setState({
    userOptions: { ...DEFAULT_USER_OPTIONS, dccMonitorEnabled: true, downloadFolder: '/tmp/dl' },
    dccActive: true,
    dccOffers: [],
    pane: 'chat',
    selection: undefined,
    networkOrder: [],
  });
  useNetworks.getState().reset();
  FakeTransport.latest = undefined;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a file offered directly', () => {
  it('reaches the shell when the user asks for it', async () => {
    const shell = fakeShell();
    const transport = await connected(shell);

    await act(async () => {
      transport.deliver(
        `:tamsin!~t@host PRIVMSG marmot :${DELIM}DCC SEND holiday.jpg 3232235777 5000 204800${DELIM}`,
      );
    });

    // Listed, and nothing fetched until somebody asks for it.
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    expect(shell.download).not.toHaveBeenCalled();

    const row = useView.getState().dccOffers[0];
    if (row === undefined) {
      throw new Error('the offer was not listed');
    }
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });

    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
    expect(shell.download.mock.calls[0]?.[0]).toMatchObject({
      host: '192.168.1.1',
      port: 5000,
      filename: 'holiday.jpg',
      folder: '/tmp/dl',
    });
  });
});

describe('a pack asked for from a serving bot', () => {
  /** Advertise a pack, ask for it, and hand back the bot's nick. */
  async function requested(transport: FakeTransport) {
    await act(async () => {
      transport.deliver(':[EWG]-[TB-DBi!bot@host PRIVMSG #packs :#26 0x [1.8G] test.tar');
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));

    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });
    await waitFor(() =>
      expect(transport.sent.some((line) => line.includes('XDCC SEND #26'))).toBe(true),
    );
  }

  it('dials the transfer the bot answers with', async () => {
    const shell = fakeShell();
    const transport = await connected(shell);
    await requested(transport);

    // Exactly the sequence a serving bot sends: a notice, then the offer.
    await act(async () => {
      transport.deliver(
        ':[EWG]-[TB-DBi!bot@host NOTICE marmot :** Sending you pack #26 ("test.tar"), which is 1.8GB. (resume supported)',
      );
      transport.deliver(
        `:[EWG]-[TB-DBi!bot@host PRIVMSG marmot :${DELIM}DCC SEND test.tar 3232235777 4000 1932735283${DELIM}`,
      );
    });

    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
    expect(shell.download.mock.calls[0]?.[0]).toMatchObject({
      host: '192.168.1.1',
      port: 4000,
      filename: 'test.tar',
    });
  });

  it('dials a secure transfer as an encrypted one', async () => {
    const shell = fakeShell();
    const transport = await connected(shell);
    await requested(transport);

    await act(async () => {
      transport.deliver(
        `:[EWG]-[TB-DBi!bot@host PRIVMSG marmot :${DELIM}DCC SSEND test.tar 3232235777 4000 1932735283${DELIM}`,
      );
    });

    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
    expect(shell.download.mock.calls[0]?.[0]?.secure).toBe(true);
  });

  it('listens for a reverse transfer, and tells the bot where', async () => {
    const shell = fakeShell();
    const transport = await connected(shell);
    await requested(transport);

    await act(async () => {
      transport.deliver(
        `:[EWG]-[TB-DBi!bot@host PRIVMSG marmot :${DELIM}DCC SEND test.tar 3232235777 0 1932735283 998877${DELIM}`,
      );
    });

    await waitFor(() => expect(shell.receivePassive).toHaveBeenCalledTimes(1));
    expect(shell.receivePassive.mock.calls[0]?.[0]).toMatchObject({
      host: '192.168.1.1',
      filename: 'test.tar',
    });
    expect(shell.download).not.toHaveBeenCalled();
  });
});

describe('an offer Marmotter cannot read', () => {
  it('is listed with the raw line, rather than passing in silence', async () => {
    const shell = fakeShell();
    const transport = await connected(shell);

    await act(async () => {
      transport.deliver(
        `:[EWG]-[TB-DBi!bot@host PRIVMSG marmot :${DELIM}DCC SEND test.tar not-an-address 4000 1${DELIM}`,
      );
    });

    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    const row = useView.getState().dccOffers[0];
    expect(row?.status).toBe('failed');
    // The line itself, where somebody waiting for a file is already looking.
    expect(row?.filename).toBe('SEND test.tar not-an-address 4000 1');
    expect(shell.download).not.toHaveBeenCalled();
  });
});

describe('continuing a file the last attempt left behind', () => {
  it('asks the bot to resume, and starts where the bot says', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const shell = fakeShell();
    shell.resumable.bytes = 500_000;
    const transport = await connected(shell);

    await act(async () => {
      transport.deliver(
        `:tamsin!~t@host PRIVMSG marmot :${DELIM}DCC SEND big.bin 3232235777 5000 1800000${DELIM}`,
      );
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });

    // Nothing is fetched until the sender agrees where to start from.
    await waitFor(() => expect(transport.sent.some((line) => line.includes('RESUME'))).toBe(true));
    expect(shell.download).not.toHaveBeenCalled();

    await act(async () => {
      transport.deliver(
        `:tamsin!~t@host PRIVMSG marmot :${DELIM}DCC ACCEPT big.bin 5000 400000${DELIM}`,
      );
    });

    // The sender's position, not the one that was asked for.
    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
    expect(shell.download.mock.calls[0]?.[0]?.resumeFrom).toBe(400_000);
    vi.useRealTimers();
  });

  it('starts the file again when the sender never answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const shell = fakeShell();
    shell.resumable.bytes = 500_000;
    const transport = await connected(shell);

    await act(async () => {
      transport.deliver(
        `:tamsin!~t@host PRIVMSG marmot :${DELIM}DCC SEND big.bin 3232235777 5000 1800000${DELIM}`,
      );
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });
    await waitFor(() => expect(transport.sent.some((line) => line.includes('RESUME'))).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });

    // A sender that says nothing has not refused; the file simply starts over.
    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
    expect(shell.download.mock.calls[0]?.[0]?.resumeFrom).toBeUndefined();
    vi.useRealTimers();
  });

  it('does not download a row that was taken off the list while it waited', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const shell = fakeShell();
    shell.resumable.bytes = 500_000;
    const transport = await connected(shell);

    await act(async () => {
      transport.deliver(
        `:tamsin!~t@host PRIVMSG marmot :${DELIM}DCC SEND big.bin 3232235777 5000 1800000${DELIM}`,
      );
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });
    await waitFor(() => expect(transport.sent.some((line) => line.includes('RESUME'))).toBe(true));

    await act(async () => {
      screen.getAllByRole('button', { name: /Remove .* from the list/ })[0]?.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });

    // Otherwise the file arrives with nothing on screen to show or stop it.
    expect(shell.download).not.toHaveBeenCalled();
    expect(useView.getState().dccOffers).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe('a pack asked for by typing the command', () => {
  /**
   * The way every XDCC index on the web tells somebody to do it, and the way
   * anybody who has used IRC before does it: type the message, do not go
   * looking for a button. The bot answers the same way either way, so the
   * client has to.
   */
  it('dials the transfer when the request was typed as a command', async () => {
    const shell = fakeShell();
    const transport = await connected(shell);

    // The pack is listed, because the monitor saw the bot advertise it.
    await act(async () => {
      transport.deliver(':[EWG]-[DELiSH!bot@host PRIVMSG #packs :#26 0x [1.8G] test.tar');
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));

    // Asked for from the composer rather than from the row's own button.
    await act(async () => {
      useView.getState().setPane('chat');
    });
    await act(async () => {
      typeCommand('/msg [EWG]-[DELiSH xdcc send #26');
    });
    await waitFor(() =>
      expect(transport.sent.some((line) => line.includes('xdcc send #26'))).toBe(true),
    );

    await act(async () => {
      transport.deliver(
        `:[EWG]-[DELiSH!bot@host PRIVMSG marmot :${DELIM}DCC SEND test.tar 3232235777 4000 1932735283${DELIM}`,
      );
    });

    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
    expect(shell.download.mock.calls[0]?.[0]).toMatchObject({
      host: '192.168.1.1',
      port: 4000,
      filename: 'test.tar',
    });
  });

  it("dials it when the request was typed into the bot's own conversation", async () => {
    const shell = fakeShell();
    const transport = await connected(shell);

    await act(async () => {
      transport.deliver(':[EWG]-[DELiSH!bot@host PRIVMSG #packs :#26 0x [1.8G] test.tar');
      // A private message from the bot opens its conversation to type into.
      transport.deliver(':[EWG]-[DELiSH!bot@host PRIVMSG marmot :Hello');
    });
    await act(async () => {
      useView.getState().setPane('chat');
      useView.getState().select({ networkId: 'testnet', target: '[EWG]-[DELiSH' });
    });
    await act(async () => {
      typeCommand('xdcc send #26');
    });

    await act(async () => {
      transport.deliver(
        `:[EWG]-[DELiSH!bot@host PRIVMSG marmot :${DELIM}DCC SEND test.tar 3232235777 4000 1932735283${DELIM}`,
      );
    });

    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
  });
});

describe('an offer nothing here asked for', () => {
  it("is announced rather than dropped, and never fetched on the sender's say-so", async () => {
    const shell = fakeShell();
    const transport = await connected(shell);

    // Listed from the channel, and never requested through this client.
    await act(async () => {
      transport.deliver(':[EWG]-[DELiSH!bot@host PRIVMSG #packs :#26 0x [1.8G] test.tar');
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));

    await act(async () => {
      transport.deliver(
        `:[EWG]-[DELiSH!bot@host PRIVMSG marmot :${DELIM}DCC SEND test.tar 3232235777 4000 1932735283${DELIM}`,
      );
    });

    // A stranger must not be able to put a file on the disk by naming one
    // already on the list — but the transfer waiting to be accepted is said out
    // loud rather than passing in silence.
    expect(shell.download).not.toHaveBeenCalled();
    expect(await screen.findByText(/ready to send test\.tar/)).toBeTruthy();
  });

  it('takes a request sent as a raw line too', async () => {
    const shell = fakeShell();
    const transport = await connected(shell);
    await act(async () => {
      transport.deliver(':[EWG]-[DELiSH!bot@host PRIVMSG #packs :#26 0x [1.8G] test.tar');
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));

    await act(async () => {
      useView.getState().setPane('chat');
    });
    await act(async () => {
      typeCommand('/quote PRIVMSG [EWG]-[DELiSH :XDCC SEND #26');
    });
    await act(async () => {
      transport.deliver(
        `:[EWG]-[DELiSH!bot@host PRIVMSG marmot :${DELIM}DCC SEND test.tar 3232235777 4000 1932735283${DELIM}`,
      );
    });

    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
  });
});

/**
 * The pasted request, after the field that used to take it was removed.
 *
 * CLAUDE.md is explicit that a pack is pasted at least as often as it is
 * browsed — every index hands out an `irc://` link and a literal
 * `/msg Bot xdcc send #N` — so taking the box out of the file monitor had to
 * move that path rather than end it. The command bar is where it went, because
 * it documents what it takes as the command is being typed, which is the one
 * thing the box could not do.
 */
describe('a pack request pasted into the command bar', () => {
  it('asks the bot named in it, and matches the answer back to the row', async () => {
    const shell = fakeShell();
    const transport = await connected(shell);

    await act(async () => {
      useView.getState().setPane('chat');
    });
    await act(async () => {
      typeCommand('/xdcc /msg [EWG]-[DELiSH xdcc send #26');
    });

    await waitFor(() =>
      expect(transport.sent.some((line) => /xdcc send #26/i.test(line))).toBe(true),
    );

    await act(async () => {
      transport.deliver(
        `:[EWG]-[DELiSH!bot@host PRIVMSG marmot :${DELIM}DCC SEND test.tar 3232235777 4000 1932735283${DELIM}`,
      );
    });

    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
    expect(shell.download.mock.calls[0]?.[0]).toMatchObject({ filename: 'test.tar', port: 4000 });
  });

  it('says so rather than sending anything when the line is not a request', async () => {
    const shell = fakeShell();
    const transport = await connected(shell);
    const before = transport.sent.length;

    await act(async () => {
      useView.getState().setPane('chat');
    });
    await act(async () => {
      typeCommand('/xdcc what goes in here');
    });

    expect(await screen.findByText(/doesn't look like a pack request/)).toBeTruthy();
    expect(transport.sent).toHaveLength(before);
  });
});

/**
 * The two faces, put on the window.
 *
 * The same shape as the theme: one property on the root element, which the
 * whole stylesheet resolves its type through.
 */
describe('the chosen type', () => {
  it('reaches the document, and follows a change', async () => {
    const shell = fakeShell();
    await connected(shell);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--font-ui-stack')).toContain('-apple-system');
    expect(root.style.getPropertyValue('--font-mono-stack')).toContain('SF Mono');

    await act(async () => {
      useView.getState().updateAppearance({ interfaceFont: 'serif', messageFont: 'courier' });
    });

    expect(root.style.getPropertyValue('--font-ui-stack')).toContain('Georgia');
    expect(root.style.getPropertyValue('--font-mono-stack')).toContain('Courier New');
    // Still a monospace stack, whichever face was picked: the nick column is
    // measured in characters and the raw log is read by lining fields up.
    expect(root.style.getPropertyValue('--font-mono-stack')).toMatch(/monospace$/);
  });
});

describe('a bot that advertises an address only it can reach', () => {
  it('says the sender is misconfigured rather than blaming the connection', async () => {
    const shell = fakeShell();
    // The transfer is attempted and refused, as it must be — the receiver may
    // be on that same network, and only trying tells us.
    shell.download.mockImplementation(() => ({
      done: Promise.reject(new Error('could not connect to 192.168.1.103:45859')),
      cancel: () => {},
    }));
    const transport = await connected(shell);

    await act(async () => {
      transport.deliver(
        `:[EWG]-[YOLOx0!~YOLx@host PRIVMSG marmot :${DELIM}DCC SEND test.mp4 3232235879 45859 2091954352${DELIM}`,
      );
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });

    await waitFor(() => expect(useView.getState().dccOffers[0]?.status).toBe('failed'));
    // No amount of retrying fixes somebody else's router, so the row says so.
    expect(useView.getState().dccOffers[0]?.error).toContain('192.168.1.103');
    expect(useView.getState().dccOffers[0]?.error).toContain('only works on its own network');
  });
});

/**
 * The common failure, and the one thing that can be done about it.
 *
 * A serving bot behind a router that has not been told its public address
 * advertises the address it knows about, and every receiver outside that
 * network is handed something like `192.168.1.103`. The offer is well-formed
 * and the port is real; only the address is wrong. The address that is right
 * is the one the offer itself arrived over — the bot's own host on IRC — so
 * that is what gets tried, at the same port, once the advertised one fails.
 *
 * 3232235879 is 192.168.1.103; 3405803783 is 203.0.113.7.
 */
describe('a bot behind a router that has not been told its address', () => {
  /** A transfer that fails, and one that works, in call order. */
  const failThen = (outcomes: readonly ('fail' | 'ok')[]) => {
    let call = 0;
    return () => {
      const outcome = outcomes[call] ?? 'fail';
      call += 1;
      return outcome === 'ok'
        ? { done: Promise.resolve('/tmp/dl/test.mp4'), cancel: () => {} }
        : { done: Promise.reject(new Error('connection refused')), cancel: () => {} };
    };
  };

  const offer = (transport: FakeTransport, host = 'files.example.net'): void => {
    transport.deliver(
      `:[EWG]-[YOLOx0!~YOLx@${host} PRIVMSG marmot :${DELIM}DCC SEND test.mp4 3232235879 45859 2091954352${DELIM}`,
    );
  };

  it("falls back to the bot's own address, at the same port", async () => {
    const shell = fakeShell();
    shell.download.mockImplementation(failThen(['fail', 'ok']));
    const transport = await connected(shell);

    await act(async () => offer(transport));
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });

    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(2));
    // The advertised address first: a receiver on the bot's own network can
    // reach it, and that attempt should win where it can.
    expect(shell.download.mock.calls[0]?.[0]).toMatchObject({
      host: '192.168.1.103',
      port: 45859,
    });
    // Then the address the offer arrived over, at the same port — the port was
    // never the part that was wrong.
    expect(shell.download.mock.calls[1]?.[0]).toMatchObject({
      host: 'files.example.net',
      port: 45859,
      filename: 'test.mp4',
    });
    await waitFor(() => expect(useView.getState().dccOffers[0]?.status).toBe('downloaded'));
  });

  it('tries it once, not in a loop', async () => {
    const shell = fakeShell();
    shell.download.mockImplementation(failThen(['fail', 'fail']));
    const transport = await connected(shell);

    await act(async () => offer(transport));
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });

    await waitFor(() => expect(useView.getState().dccOffers[0]?.status).toBe('failed'));
    expect(shell.download).toHaveBeenCalledTimes(2);

    // Both addresses named, and the remaining option said out loud rather than
    // leaving somebody to check a firewall that is not the problem.
    const error = useView.getState().dccOffers[0]?.error ?? '';
    expect(error).toContain('files.example.net');
    expect(error).toContain('another bot');
  });

  // The important half: an address that is publicly routable has nothing wrong
  // with it that a different address would fix, and a transfer that failed for
  // some other reason must not be retried elsewhere and blamed on the address.
  it('does not retry an offer whose address was fine', async () => {
    const shell = fakeShell();
    shell.download.mockImplementation(failThen(['fail', 'ok']));
    const transport = await connected(shell);

    await act(async () => {
      transport.deliver(
        `:[EWG]-[YOLOx0!~YOLx@files.example.net PRIVMSG marmot :${DELIM}DCC SEND test.mp4 3405803783 45859 2091954352${DELIM}`,
      );
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });

    await waitFor(() => expect(useView.getState().dccOffers[0]?.status).toBe('failed'));
    expect(shell.download).toHaveBeenCalledTimes(1);
  });

  // A cloak resolves to nothing, so there is no second address to try and the
  // row says what it said before: the sender is misconfigured.
  it('has nothing to fall back to behind a cloak', async () => {
    const shell = fakeShell();
    shell.download.mockImplementation(failThen(['fail', 'ok']));
    const transport = await connected(shell);

    await act(async () => offer(transport, 'Rizon/user/YOLOx0'));
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });

    await waitFor(() => expect(useView.getState().dccOffers[0]?.status).toBe('failed'));
    expect(shell.download).toHaveBeenCalledTimes(1);
    expect(useView.getState().dccOffers[0]?.error).toContain('only works on its own network');
  });

  // Pressing Retry is a fresh pair of attempts, not one: the row remembers that
  // its fallback was spent, and a person who asks again is asking for both.
  it('gives Retry a fresh pair of attempts', async () => {
    const shell = fakeShell();
    shell.download.mockImplementation(failThen(['fail', 'fail', 'fail', 'ok']));
    const transport = await connected(shell);

    await act(async () => offer(transport));
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });
    await waitFor(() => expect(useView.getState().dccOffers[0]?.status).toBe('failed'));
    expect(shell.download).toHaveBeenCalledTimes(2);

    await act(async () => {
      screen.getAllByRole('button', { name: 'Retry' })[0]?.click();
    });
    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(4));
    expect(shell.download.mock.calls[2]?.[0]).toMatchObject({ host: '192.168.1.103' });
    expect(shell.download.mock.calls[3]?.[0]).toMatchObject({ host: 'files.example.net' });
    await waitFor(() => expect(useView.getState().dccOffers[0]?.status).toBe('downloaded'));
  });
});

/**
 * A bot that re-offers while we are still asking to resume.
 *
 * Reconstructed from a real failed download, and the reason it is here rather
 * than in a unit test: every part worked on its own. The pack parsed, the row
 * was right, the offer carried a public address, the shell dialled when it was
 * called. What went wrong was between them, over time.
 *
 * A serving bot re-offers a pack every few seconds until somebody connects. If
 * there is a part-file from an earlier attempt, the client first asks the
 * sender to continue it, and gives the answer a deadline. Each re-offer used to
 * start that negotiation again and replace the deadline — so a bot re-offering
 * every five seconds against an eight-second deadline meant the deadline could
 * never arrive. The client asked to resume, over and over; the bot held a
 * socket nobody dialled; three minutes later it gave up:
 *
 *   ** You have a DCC pending, Set your client to receive the transfer.
 *   ** Closing Connection: DCC Timeout (180 Sec Timeout)
 *
 * The file never arrived and nothing in the interface was wrong, which is the
 * worst shape a bug can take.
 */
describe('a bot re-offering while a resume is being negotiated', () => {
  const BOT = '[EWG]-B-XTREM';
  const HOST = '~shh@863933A7.7304A9F.C6F98C0D.IP';
  const FILE = '9-1-1.S06E14.Performance.Anxiety.1080p.WEBRip.10bit.EAC3.5.1.x265-iVy.mkv';
  /** The bold the bot wraps its pack numbers in, as it really sends them. */
  const B = '\u0002';
  // Composed rather than written out: a hash followed by three digits reads as
  // a hex colour to the token-discipline check, which scans every source file.
  const PACK = 530;
  const ADVERT = `:${BOT}!${HOST} PRIVMSG #ELITEWAREZ :${B}#${PACK}${B}  1x [744M] ${FILE}`;
  /** 100542678 is 5.254.40.214 — a public address, so nothing else applies. */
  const SEND = `:${BOT}!${HOST} PRIVMSG marmot :${DELIM}DCC SEND ${FILE} 100542678 49267 780321177${DELIM}`;

  /** Advertises the pack and presses Download, as the user did. */
  async function requested(shell: ReturnType<typeof fakeShell>) {
    const transport = await connected(shell);
    await act(async () => {
      transport.deliver(ADVERT);
    });
    await waitFor(() => expect(useView.getState().dccOffers).toHaveLength(1));
    await act(async () => {
      screen.getAllByRole('button', { name: 'Download' })[0]?.click();
    });
    await waitFor(() =>
      expect(transport.sent.some((line) => line.includes(`XDCC SEND #${PACK}`))).toBe(true),
    );
    return transport;
  }

  /** Replays the bot re-offering every five seconds for the given span. */
  async function reoffering(transport: FakeTransport, ms: number, line = SEND): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += 5_000) {
      await act(async () => {
        transport.deliver(line);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    }
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dials rather than asking to resume for ever', async () => {
    const shell = fakeShell();
    // An earlier attempt left part of the file, which is what puts this
    // transfer down the resume path at all — and retrying a download that
    // failed is exactly how somebody gets there.
    shell.resumable.bytes = 50_000_000;
    const transport = await requested(shell);

    // The three minutes the bot holds the transfer open for.
    await reoffering(transport, 180_000);

    expect(shell.download).toHaveBeenCalledTimes(1);
    expect(useView.getState().dccOffers[0]?.status).toBe('downloading');
  });

  // The other half of the same bug, and the part a serving bot notices: one
  // request per attempt, not one per re-offer. Thirty-six DCC RESUMEs in three
  // minutes is a flood aimed at a bot that is already trying to send the file.
  it('asks the sender to continue exactly once', async () => {
    const shell = fakeShell();
    shell.resumable.bytes = 50_000_000;
    const transport = await requested(shell);

    await reoffering(transport, 180_000);

    expect(transport.sent.filter((line) => /DCC RESUME/.test(line))).toHaveLength(1);
  });

  // A re-offer is the same transfer being advertised again, so its address is
  // the newer one — a bot is free to listen somewhere else — but it is not a
  // reason to start the wait over.
  it('dials the newest address the bot offered', async () => {
    const shell = fakeShell();
    shell.resumable.bytes = 50_000_000;
    const transport = await requested(shell);

    await act(async () => {
      transport.deliver(SEND);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    // The same pack, now on a different port.
    await act(async () => {
      transport.deliver(
        `:${BOT}!${HOST} PRIVMSG marmot :${DELIM}DCC SEND ${FILE} 100542678 51000 780321177${DELIM}`,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(shell.download).toHaveBeenCalledTimes(1);
    expect(shell.download.mock.calls[0]?.[0]).toMatchObject({ port: 51000 });
  });

  // Every dial waits on the shell saying whether there is anything to continue.
  // A shell that never answers used to be a transfer that never started, with
  // nothing on screen to say so.
  it('dials anyway when the shell never says what is on disk', async () => {
    const shell = fakeShell();
    shell.capability.resumableBytes = () => new Promise<number>(() => {});
    const transport = await requested(shell);

    await act(async () => {
      transport.deliver(SEND);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(shell.download).toHaveBeenCalledTimes(1);
    // Started from the beginning, which is the right answer when what is on
    // disk is unknown: nothing is asked of the sender and no position is sent.
    expect(shell.download.mock.calls[0]?.[0]).not.toHaveProperty('resumeFrom');
    expect(transport.sent.filter((line) => /DCC RESUME/.test(line))).toHaveLength(0);
  });

  // The ordinary case has to keep working: nothing on disk means no handshake
  // at all, and the dial happens on the first offer.
  it('dials at once when there is nothing to continue', async () => {
    const shell = fakeShell();
    const transport = await requested(shell);

    await act(async () => {
      transport.deliver(SEND);
    });

    await waitFor(() => expect(shell.download).toHaveBeenCalledTimes(1));
    expect(transport.sent.filter((line) => /DCC RESUME/.test(line))).toHaveLength(0);
  });
});
