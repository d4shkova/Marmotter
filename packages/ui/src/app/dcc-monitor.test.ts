import type { DccSend } from '@marmotter/protocol';
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
