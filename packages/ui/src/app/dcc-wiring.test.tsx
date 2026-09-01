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
