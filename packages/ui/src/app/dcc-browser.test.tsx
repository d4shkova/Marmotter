import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DccBrowser } from './DccBrowser.js';
import type { DccOfferRecord } from './view-store.js';

afterEach(cleanup);

const offer = (overrides: Partial<DccOfferRecord> = {}): DccOfferRecord => ({
  id: 'row-1',
  kind: 'xdcc',
  networkId: 'rizon',
  networkName: 'Rizon',
  from: '[EWG]Totoro',
  target: '#packlist',
  filename: 'Celebrity.Wheel.of.Fortune.S01E01.tar',
  size: 992_491_520,
  received: 300_000_000,
  pack: 265,
  gets: 3,
  passive: false,
  receivedAt: 1_000,
  status: 'downloading',
  ...overrides,
});

const noop = (): void => {};

describe('DccBrowser download controls', () => {
  it('offers a cancel button beside the bar while a file is downloading', () => {
    const onCancel = vi.fn();
    render(
      <DccBrowser
        offers={[offer()]}
        downloadFolder="/tmp/dl"
        onDownload={noop}
        onCancel={onCancel}
        onChooseFolder={noop}
        onClear={noop}
        now={2_000}
      />,
    );

    // The bar is there to read progress against.
    expect(screen.getByRole('progressbar')).toBeTruthy();

    const cancel = screen.getByRole('button', {
      name: 'Cancel downloading Celebrity.Wheel.of.Fortune.S01E01.tar',
    });
    fireEvent.click(cancel);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel.mock.calls[0]?.[0]?.id).toBe('row-1');
  });

  it('shows no cancel button once a download is available, saved, or failed', () => {
    for (const status of ['available', 'downloaded', 'failed'] as const) {
      render(
        <DccBrowser
          offers={[offer({ status })]}
          downloadFolder="/tmp/dl"
          onDownload={noop}
          onCancel={noop}
          onChooseFolder={noop}
          onClear={noop}
          now={2_000}
        />,
      );
      expect(screen.queryByRole('button', { name: /Cancel downloading/ })).toBeNull();
      cleanup();
    }
  });
});
