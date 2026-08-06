import type { DccSend, XdccPack } from '@marmotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { useView } from './view-store.js';

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
      userOptions: { dccMonitorEnabled: true, downloadFolder: '/tmp/dl' },
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
    useView.setState({ userOptions: { dccMonitorEnabled: false, downloadFolder: '/tmp/dl' } });
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

  it('clears every offer on request', () => {
    useView.getState().recordDccOffer(offer());
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
      userOptions: { dccMonitorEnabled: true, downloadFolder: '/tmp/dl' },
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
