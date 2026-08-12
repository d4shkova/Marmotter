import type { DccSend, XdccPack } from '@marmotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { shallow } from 'zustand/shallow';
import {
  DEFAULT_USER_OPTIONS,
  classifyDccReoffer,
  selectViewWithoutOffers,
  useView,
} from './view-store.js';

const send: DccSend = {
  filename: 'holiday.jpg',
  host: '192.168.1.1',
  port: 5000,
  size: 204800,
  passive: false,
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

  it('does not retry a failed row from a passive re-offer it cannot fetch', () => {
    expect(classifyDccReoffer({ status: 'failed' }, { passive: true })).toBe('ignore');
  });

  it('ignores a re-offer of a row that is mid-transfer, saved, or still waiting', () => {
    expect(classifyDccReoffer({ status: 'downloading' }, active)).toBe('ignore');
    expect(classifyDccReoffer({ status: 'downloaded' }, active)).toBe('ignore');
    expect(classifyDccReoffer({ status: 'available' }, active)).toBe('ignore');
    expect(classifyDccReoffer({ status: 'requested' }, active)).toBe('ignore');
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
