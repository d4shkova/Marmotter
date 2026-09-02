import type { DccSend, XdccPack } from '@marmotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { shallow } from 'zustand/shallow';
import {
  DEFAULT_USER_OPTIONS,
  applyXdccResponse,
  classifyDccReoffer,
  matchPendingRequest,
  networkForHost,
  sameFilename,
  selectViewWithoutOffers,
  useView,
} from './view-store.js';

const send: DccSend = {
  filename: 'holiday.jpg',
  host: '192.168.1.1',
  port: 5000,
  size: 204800,
  passive: false,
  secure: false,
  turbo: false,
};

type OfferArg = Parameters<ReturnType<typeof useView.getState>['recordDccOffer']>[0];

const offer = (overrides: Partial<OfferArg> = {}): OfferArg => ({
  networkId: 'libera',
  networkName: 'Libera.Chat',
  from: 'tamsin',
  target: '#marmotter',
  send,
  at: 1_000,
  ...overrides,
});

describe('the DCC monitor store', () => {
  beforeEach(() => {
    useView.setState({
      userOptions: { ...DEFAULT_USER_OPTIONS, dccMonitorEnabled: true, downloadFolder: '/tmp/dl' },
      dccActive: true,
      dccOffers: [],
    });
  });

  it('does not watch until somebody starts it', () => {
    // The store's own initial value, not the one this file's setup writes.
    // Enabling the feature in settings used to start it collecting there and
    // then, and a restart brought it back collecting, so the only way to have
    // the panel without it watching was to press Stop on every launch.
    useView.setState({
      userOptions: { ...DEFAULT_USER_OPTIONS, dccMonitorEnabled: true, downloadFolder: '/tmp/dl' },
      dccActive: useView.getInitialState().dccActive,
      dccOffers: [],
    });

    expect(useView.getState().dccActive).toBe(false);
    useView.getState().recordDccOffer(offer());
    expect(useView.getState().dccOffers).toHaveLength(0);
  });

  it('collects once it is started, and stops again when told', () => {
    useView.setState({ dccActive: false });
    useView.getState().setDccActive(true);
    useView.getState().recordDccOffer(offer());
    expect(useView.getState().dccOffers).toHaveLength(1);

    useView.getState().setDccActive(false);
    useView.getState().recordDccOffer(offer({ send: { ...send, filename: 'other.zip' } }));
    expect(useView.getState().dccOffers).toHaveLength(1);
  });

  it('records an offer while switched on and collecting', () => {
    useView.getState().recordDccOffer(offer());
    expect(useView.getState().dccOffers).toHaveLength(1);
    expect(useView.getState().dccOffers[0]?.filename).toBe('holiday.jpg');
    expect(useView.getState().dccOffers[0]?.status).toBe('available');
  });

  it('ignores offers when the monitor is switched off', () => {
    useView.setState({
      userOptions: { ...DEFAULT_USER_OPTIONS, dccMonitorEnabled: false, downloadFolder: '/tmp/dl' },
    });
    useView.getState().recordDccOffer(offer());
    expect(useView.getState().dccOffers).toHaveLength(0);
  });

  it('ignores offers while paused', () => {
    useView.setState({ dccActive: false });
    useView.getState().recordDccOffer(offer());
    expect(useView.getState().dccOffers).toHaveLength(0);
  });

  it('folds a re-advertised file into the one row', () => {
    useView.getState().recordDccOffer(offer());
    useView.getState().recordDccOffer(offer({ at: 2_000 }));
    expect(useView.getState().dccOffers).toHaveLength(1);
  });

  it('keeps a genuinely different file as its own row', () => {
    useView.getState().recordDccOffer(offer());
    useView.getState().recordDccOffer(offer({ send: { ...send, filename: 'other.zip' } }));
    expect(useView.getState().dccOffers).toHaveLength(2);
  });

  it("updates a single offer's transfer state", () => {
    useView.getState().recordDccOffer(offer());
    const { id } = useView.getState().dccOffers[0]!;
    useView
      .getState()
      .setDccOfferStatus(id, { status: 'downloaded', savedPath: '/tmp/dl/holiday.jpg' });
    const updated = useView.getState().dccOffers[0];
    expect(updated?.status).toBe('downloaded');
    expect(updated?.savedPath).toBe('/tmp/dl/holiday.jpg');
  });

  it('records progress and moves the row to downloading', () => {
    useView.getState().recordDccOffer(offer());
    const { id } = useView.getState().dccOffers[0]!;
    useView.getState().setDccOfferProgress(id, 1000, 4000);
    const row = useView.getState().dccOffers[0];
    expect(row?.status).toBe('downloading');
    expect(row?.received).toBe(1000);
  });

  it('fills in a total the advertisement lacked, without overwriting a known size', () => {
    const { size: _size, ...sendNoSize } = send;
    useView.getState().recordDccOffer(offer({ send: sendNoSize }));
    const { id } = useView.getState().dccOffers[0]!;
    useView.getState().setDccOfferProgress(id, 10, 4000);
    expect(useView.getState().dccOffers[0]?.size).toBe(4000);
    // A second report with no total must not wipe the size just learned.
    useView.getState().setDccOfferProgress(id, 20, undefined);
    expect(useView.getState().dccOffers[0]?.size).toBe(4000);
  });

  it('clears the observed catalogue on request', () => {
    useView.getState().recordDccOffer(offer());
    useView.getState().clearDccOffers();
    expect(useView.getState().dccOffers).toHaveLength(0);
  });

  it('clears files already downloaded along with the catalogue', () => {
    useView.getState().recordDccOffer(offer());
    const { id } = useView.getState().dccOffers[0]!;
    useView.getState().setDccOfferStatus(id, { status: 'downloaded', savedPath: '/tmp/dl/x' });
    useView.getState().recordDccOffer(offer({ send: { ...send, filename: 'other.zip' } }));

    useView.getState().clearDccOffers();
    expect(useView.getState().dccOffers).toHaveLength(0);
  });

  it('keeps a transfer still running, which the row is the only way to stop', () => {
    useView.getState().recordDccOffer(offer());
    const running = useView.getState().dccOffers[0]!.id;
    useView.getState().setDccOfferProgress(running, 500, 4000);
    useView.getState().recordDccOffer(offer({ send: { ...send, filename: 'other.zip' } }));

    useView.getState().clearDccOffers();
    const remaining = useView.getState().dccOffers;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(running);
    expect(remaining[0]?.status).toBe('downloading');
  });

  it('clears a requested pack, which it used to keep waiting on its bot for ever', () => {
    // This deliberately reverses an earlier decision. A `requested` row is a
    // message sent to a bot, not a running transfer — there is no socket to
    // orphan — and keeping it made a request that went unanswered impossible to
    // shift: no control on the row, and Clear passed over it every time.
    useView.getState().recordDccOffer(offer());
    const { id } = useView.getState().dccOffers[0]!;
    useView.getState().setDccOfferStatus(id, { status: 'requested' });
    useView.getState().clearDccOffers();
    expect(useView.getState().dccOffers).toHaveLength(0);
  });

  it("drops a removed network's offers", () => {
    useView.getState().recordDccOffer(offer());
    useView
      .getState()
      .recordDccOffer(offer({ networkId: 'oftc', send: { ...send, filename: 'x' } }));
    useView.getState().forgetNetwork('libera');
    const remaining = useView.getState().dccOffers;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.networkId).toBe('oftc');
  });
});

const pack: XdccPack = {
  pack: 70,
  gets: 1,
  sizeText: '2.2G',
  sizeBytes: Math.round(2.2 * 1024 ** 3),
  filename: 'movie.mkv',
};

type XdccArg = Parameters<ReturnType<typeof useView.getState>['recordXdccOffer']>[0];

const xdcc = (overrides: Partial<XdccArg> = {}): XdccArg => ({
  networkId: 'rizon',
  networkName: 'Rizon',
  from: '[EWG]Totoro',
  target: '#packlist',
  pack,
  at: 2_000,
  ...overrides,
});

describe('the XDCC side of the monitor', () => {
  beforeEach(() => {
    useView.setState({
      userOptions: { ...DEFAULT_USER_OPTIONS, dccMonitorEnabled: true, downloadFolder: '/tmp/dl' },
      dccActive: true,
      dccOffers: [],
    });
  });

  it('records a pack as an xdcc offer with its number and gets', () => {
    useView.getState().recordXdccOffer(xdcc());
    const row = useView.getState().dccOffers[0];
    expect(row?.kind).toBe('xdcc');
    expect(row?.pack).toBe(70);
    expect(row?.gets).toBe(1);
    expect(row?.filename).toBe('movie.mkv');
    expect(row?.size).toBe(Math.round(2.2 * 1024 ** 3));
  });

  it('folds a re-listed pack into one row, refreshing its gets count', () => {
    useView.getState().recordXdccOffer(xdcc());
    useView.getState().recordXdccOffer(xdcc({ pack: { ...pack, gets: 9 } }));
    const rows = useView.getState().dccOffers;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gets).toBe(9);
  });

  it('does not disturb a pack already downloading when it is re-listed', () => {
    useView.getState().recordXdccOffer(xdcc());
    const { id } = useView.getState().dccOffers[0]!;
    useView.getState().setDccOfferStatus(id, { status: 'downloading' });
    useView.getState().recordXdccOffer(xdcc({ pack: { ...pack, gets: 50 } }));
    const row = useView.getState().dccOffers[0];
    expect(row?.status).toBe('downloading');
    expect(row?.gets).toBe(1);
  });

  it('keeps a direct DCC offer and an XDCC pack as separate rows', () => {
    useView.getState().recordXdccOffer(xdcc());
    useView.getState().recordDccOffer({
      networkId: 'rizon',
      networkName: 'Rizon',
      from: '[EWG]Totoro',
      target: '#packlist',
      send,
      at: 3_000,
    });
    expect(useView.getState().dccOffers).toHaveLength(2);
  });
});

describe('classifying a serving bot re-offer', () => {
  const active = { passive: false };

  it('records an offer that matches no existing row', () => {
    expect(classifyDccReoffer(undefined, active)).toBe('record');
  });

  it('retries a row whose last attempt failed, when the re-offer is fetchable', () => {
    expect(classifyDccReoffer({ status: 'failed' }, active)).toBe('retry');
  });

  it('connects for a row still waiting on the request this offer answers', () => {
    expect(classifyDccReoffer({ status: 'requested' }, active)).toBe('retry');
  });

  it('refuses, rather than ignores, a passive offer of a row that is waiting', () => {
    expect(classifyDccReoffer({ status: 'failed' }, { passive: true })).toBe('refuse');
    expect(classifyDccReoffer({ status: 'requested' }, { passive: true })).toBe('refuse');
  });

  it('ignores a re-offer of a row that is mid-transfer or already saved', () => {
    expect(classifyDccReoffer({ status: 'downloading' }, active)).toBe('ignore');
    expect(classifyDccReoffer({ status: 'downloaded' }, active)).toBe('ignore');
  });

  it('announces an offer of a listed row nothing here started', () => {
    // The bot is sending a file that is on the list and that no button here
    // asked for — a request typed at the bot rather than clicked, most often.
    // Not fetched, because a stranger must not be able to put a file on the
    // disk by naming one already listed; not dropped either, because a file
    // somebody is waiting for would then never arrive and never be mentioned.
    expect(classifyDccReoffer({ status: 'available' }, active)).toBe('announce');
  });
});

describe('matching an answer to the request it belongs to', () => {
  const row = (id: string, filename: string): { id: string; filename: string } => ({
    id,
    filename,
  });
  const rows = [
    row('a', 'American.Dad.S08E09.1080p.mkv'),
    row('b', 'American.Dad.S08E10.1080p.mkv'),
    row('c', 'American.Dad.S08E11.1080p.mkv'),
  ];

  it('answers the request the file names, not the one at the front', () => {
    expect(matchPendingRequest(['a', 'b', 'c'], rows, 'American.Dad.S08E11.1080p.mkv')).toBe('c');
  });

  it('matches through a name the bot rewrote', () => {
    expect(matchPendingRequest(['a', 'b'], rows, 'american_dad_s08e10_1080p.mkv')).toBe('b');
  });

  it('leaves a row outside the queue to the re-offer rule', () => {
    expect(matchPendingRequest(['a'], rows, 'American.Dad.S08E11.1080p.mkv')).toBeUndefined();
  });

  it('falls back to the front of the queue for a name it cannot place', () => {
    expect(matchPendingRequest(['b', 'c'], rows, 'something.else.entirely.mkv')).toBe('b');
  });

  it('answers nothing when there is no queue', () => {
    expect(matchPendingRequest([], rows, 'American.Dad.S08E09.1080p.mkv')).toBeUndefined();
  });
});

describe('comparing advertised names', () => {
  it('matches a name through case, spaces and separators', () => {
    expect(sameFilename('A File Name.mkv', 'a_file_name.mkv')).toBe(true);
  });

  it('keeps two different episodes apart', () => {
    expect(sameFilename('show.s01e01.mkv', 'show.s01e02.mkv')).toBe(false);
  });

  it('does not match two names with no letters or digits between them', () => {
    expect(sameFilename('...', '___')).toBe(false);
  });
});

describe('getting rid of a row', () => {
  it('removes one whatever state it is in', () => {
    for (const status of [
      'available',
      'requested',
      'downloading',
      'downloaded',
      'failed',
    ] as const) {
      useView.setState({ dccOffers: [] });
      useView.getState().recordDccOffer(offer());
      const id = useView.getState().dccOffers[0]?.id ?? '';
      useView.getState().setDccOfferStatus(id, { status });

      useView.getState().removeDccOffer(id);
      expect(useView.getState().dccOffers, status).toHaveLength(0);
    }
  });

  it('leaves the other rows alone', () => {
    useView.setState({ dccOffers: [] });
    useView.getState().recordDccOffer(offer({ send: { ...send, filename: 'one.zip' } }));
    useView.getState().recordDccOffer(offer({ send: { ...send, filename: 'two.zip' } }));
    const first = useView.getState().dccOffers[0]?.id ?? '';

    useView.getState().removeDccOffer(first);

    expect(useView.getState().dccOffers.map((entry) => entry.filename)).toEqual(['two.zip']);
  });

  it('does nothing for an id that is not there', () => {
    useView.setState({ dccOffers: [] });
    useView.getState().recordDccOffer(offer());
    useView.getState().removeDccOffer('not-a-row');
    expect(useView.getState().dccOffers).toHaveLength(1);
  });

  it('clears a pack the bot never answered, which it used to keep for ever', () => {
    // `requested` is a message sent to a bot, not a running transfer. Treating
    // it as in flight left the row pinned to the top with no control on it and
    // surviving every Clear.
    useView.setState({ dccOffers: [] });
    useView.getState().recordDccOffer(offer());
    const id = useView.getState().dccOffers[0]?.id ?? '';
    useView.getState().setDccOfferStatus(id, { status: 'requested' });

    useView.getState().clearDccOffers();

    expect(useView.getState().dccOffers).toHaveLength(0);
  });

  it('still keeps a download that is actually running', () => {
    // The reason Clear ever kept anything: dropping the row of a live transfer
    // leaves the socket running with nothing on screen to stop it.
    useView.setState({ dccOffers: [] });
    useView.getState().recordDccOffer(offer());
    const id = useView.getState().dccOffers[0]?.id ?? '';
    useView.getState().setDccOfferStatus(id, { status: 'downloading' });

    useView.getState().clearDccOffers();

    expect(useView.getState().dccOffers).toHaveLength(1);
  });
});

describe('what the shell subscribes to', () => {
  beforeEach(() => {
    useView.setState({
      userOptions: { ...DEFAULT_USER_OPTIONS, dccMonitorEnabled: true, downloadFolder: '/tmp/dl' },
      dccActive: true,
      dccOffers: [],
    });
  });

  it('leaves the offer list out', () => {
    // The shell renders the whole client. Reading the offer list there made
    // every catalogue line and every megabyte of every download a render of the
    // sidebar, the message list and the member list — which is what made moving
    // between screens crawl while anything was downloading.
    expect('dccOffers' in selectViewWithoutOffers(useView.getState())).toBe(false);
  });

  it('does not change when only the offers do', () => {
    const before = selectViewWithoutOffers(useView.getState());
    useView.getState().recordDccOffer(offer());
    useView.getState().setDccOfferProgress(useView.getState().dccOffers[0]!.id, 1024);
    const after = selectViewWithoutOffers(useView.getState());

    expect(useView.getState().dccOffers).toHaveLength(1);
    // Field for field the same, which is what keeps `useShallow` from
    // re-rendering the shell.
    expect(shallow(before, after)).toBe(true);
  });

  it('still changes when something the shell shows does', () => {
    const before = selectViewWithoutOffers(useView.getState());
    useView.getState().setPane('dcc');

    expect(shallow(before, selectViewWithoutOffers(useView.getState()))).toBe(false);
  });
});

describe('applyXdccResponse', () => {
  it('keeps a queued row waiting, and says where it stands', () => {
    expect(applyXdccResponse({ kind: 'queued', position: 4, waitText: '10m', text: '' })).toEqual({
      status: 'requested',
      note: 'Queued, position 4 · about 10m.',
      settled: false,
    });
  });

  it('keeps waiting when the bot says we already asked', () => {
    // The request is still in the queue; failing the row would throw it away.
    const outcome = applyXdccResponse({
      kind: 'denied',
      reason: 'already-queued',
      text: '',
    });
    expect(outcome.status).toBe('requested');
    expect(outcome.settled).toBe(false);
  });

  it('ends the wait on a refusal, in words that say what to do', () => {
    const outcome = applyXdccResponse({ kind: 'denied', reason: 'not-in-channel', text: '' });
    expect(outcome).toEqual({
      status: 'failed',
      error: "Join one of the bot's channels first — it only sends files to people there.",
      settled: true,
    });
  });

  it('ends the wait when the bot drops the request', () => {
    expect(applyXdccResponse({ kind: 'dequeued', text: '' }).settled).toBe(true);
  });
});

describe('networkForHost', () => {
  const profiles = new Map([
    ['libera', { servers: [{ host: 'irc.libera.chat' }] }],
    ['abc', { servers: [{ host: 'irc.abc.xyz' }, { host: 'eu.abc.xyz' }] }],
  ]);

  it('finds the network a link names', () => {
    expect(networkForHost(profiles, 'IRC.ABC.XYZ')).toBe('abc');
    expect(networkForHost(profiles, 'eu.abc.xyz')).toBe('abc');
  });

  it('matches the round-robin name a profile connects under', () => {
    expect(networkForHost(profiles, 'abc.xyz')).toBe('abc');
  });

  it('is undefined for a network we are not on', () => {
    expect(networkForHost(profiles, 'irc.example.net')).toBeUndefined();
    expect(networkForHost(profiles, '  ')).toBeUndefined();
  });
});

describe('a pack asked for by hand', () => {
  beforeEach(() => {
    useView.setState({
      userOptions: { ...DEFAULT_USER_OPTIONS, dccMonitorEnabled: true, downloadFolder: '/tmp/dl' },
      dccActive: true,
      dccOffers: [],
    });
  });

  const request = {
    networkId: 'libera',
    networkName: 'Libera.Chat',
    from: 'bot',
    pack: 42,
    at: 1_000,
  };

  it('lists a row standing in for the advertisement nobody saw', () => {
    const id = useView.getState().recordXdccRequest(request);
    const row = useView.getState().dccOffers.find((entry) => entry.id === id);
    expect(row).toMatchObject({
      kind: 'xdcc',
      pack: 42,
      filename: 'Pack #42',
      status: 'available',
    });
  });

  it('acts on the row already listing that pack rather than adding a second', () => {
    useView.getState().recordXdccOffer({
      networkId: 'libera',
      networkName: 'Libera.Chat',
      from: 'bot',
      target: '#packs',
      pack: { pack: 42, gets: 3, sizeText: '1M', sizeBytes: 1024 ** 2, filename: 'thing.bin' },
      at: 500,
    });
    const id = useView.getState().recordXdccRequest(request);
    expect(useView.getState().dccOffers).toHaveLength(1);
    expect(useView.getState().dccOffers[0]?.id).toBe(id);
    expect(useView.getState().dccOffers[0]?.filename).toBe('thing.bin');
  });

  it('does nothing while the monitor is switched off', () => {
    useView.setState({ userOptions: { ...DEFAULT_USER_OPTIONS, dccMonitorEnabled: false } });
    expect(useView.getState().recordXdccRequest(request)).toBeUndefined();
    expect(useView.getState().dccOffers).toHaveLength(0);
  });

  it('takes the real name from the bot once it answers', () => {
    const id = useView.getState().recordXdccRequest(request) ?? '';
    useView.getState().setDccOfferStatus(id, { status: 'downloading', filename: 'thing.bin' });
    expect(useView.getState().dccOffers[0]?.filename).toBe('thing.bin');
  });

  it('drops a stale note when the row moves on', () => {
    const id = useView.getState().recordXdccRequest(request) ?? '';
    useView.getState().setDccOfferStatus(id, { status: 'requested', note: 'Queued, position 4.' });
    expect(useView.getState().dccOffers[0]?.note).toBe('Queued, position 4.');
    useView.getState().setDccOfferStatus(id, { status: 'failed', error: 'Nope.' });
    expect(useView.getState().dccOffers[0]?.note).toBeUndefined();
  });
});

describe('what a bot is holding for a row', () => {
  it('marks a row the bot has opened a transfer for', () => {
    expect(applyXdccResponse({ kind: 'awaiting-connection', text: '' })).toEqual({
      status: 'requested',
      note: 'The bot is waiting for Marmotter to connect.',
      settled: false,
      awaitingTransfer: true,
    });
    expect(applyXdccResponse({ kind: 'sending', text: '' }).awaitingTransfer).toBe(true);
  });

  it('reads a transfer that timed out as unreachable, not as a refusal', () => {
    const outcome = applyXdccResponse({ kind: 'denied', reason: 'dcc-timeout', text: '' });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('firewall');
    expect(outcome.settled).toBe(true);
  });

  it('leaves a queue placement holding no transfer', () => {
    expect(applyXdccResponse({ kind: 'queued', position: 2, text: '' }).awaitingTransfer).toBe(
      undefined,
    );
  });
});
