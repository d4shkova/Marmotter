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
        onDismiss={noop}
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

  it('pins a requested file above the catalogue so it cannot scroll away', () => {
    const catalogue = Array.from({ length: 40 }, (_, index) =>
      offer({
        id: `bulk-${index}`,
        filename: `Some.Other.Pack.${index}.mkv`,
        pack: 400 + index,
        status: 'available',
      }),
    );

    render(
      <DccBrowser
        offers={[...catalogue, offer({ status: 'downloading' })]}
        downloadFolder="/tmp/dl"
        onDownload={noop}
        onCancel={noop}
        onChooseFolder={noop}
        onClear={noop}
        onDismiss={noop}
        now={2_000}
      />,
    );

    const tray = screen.getByRole('region', { name: 'Your downloads' });
    expect(tray.textContent).toContain('Celebrity.Wheel.of.Fortune.S01E01.tar');
    expect(tray.textContent).toContain('1 download');

    // Lifted out of the table rather than listed in both places.
    const table = screen.getByRole('table');
    expect(table.textContent).not.toContain('Celebrity.Wheel.of.Fortune.S01E01.tar');
    expect(table.textContent).toContain('Some.Other.Pack.0.mkv');
  });

  it('keeps a tracked file out of the tray until the user asks for it', () => {
    render(
      <DccBrowser
        offers={[offer({ status: 'available' })]}
        downloadFolder="/tmp/dl"
        onDownload={noop}
        onCancel={noop}
        onChooseFolder={noop}
        onClear={noop}
        onDismiss={noop}
        now={2_000}
      />,
    );

    expect(screen.queryByRole('region', { name: 'Your downloads' })).toBeNull();
    expect(screen.getByRole('table').textContent).toContain(
      'Celebrity.Wheel.of.Fortune.S01E01.tar',
    );
  });

  it('keeps saved and failed files pinned, so a finished download stays findable', () => {
    render(
      <DccBrowser
        offers={[
          offer({ id: 'saved', filename: 'done.mkv', status: 'downloaded' }),
          offer({ id: 'broke', filename: 'broke.mkv', status: 'failed' }),
          offer({ id: 'idle', filename: 'idle.mkv', status: 'available' }),
        ]}
        downloadFolder="/tmp/dl"
        onDownload={noop}
        onCancel={noop}
        onChooseFolder={noop}
        onClear={noop}
        onDismiss={noop}
        now={2_000}
      />,
    );

    const tray = screen.getByRole('region', { name: 'Your downloads' });
    expect(tray.textContent).toContain('done.mkv');
    expect(tray.textContent).toContain('broke.mkv');
    expect(tray.textContent).not.toContain('idle.mkv');
    expect(tray.textContent).toContain('2 downloads');
  });

  it('leaves the tray alone when the search narrows the catalogue', () => {
    render(
      <DccBrowser
        offers={[
          offer({ status: 'downloading' }),
          offer({ id: 'idle', filename: 'unrelated.mkv', status: 'available' }),
        ]}
        downloadFolder="/tmp/dl"
        onDownload={noop}
        onCancel={noop}
        onChooseFolder={noop}
        onClear={noop}
        onDismiss={noop}
        now={2_000}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search files'), {
      target: { value: 'nothing-matches-this' },
    });

    // The catalogue empties, but a transfer in flight stays in view — that is
    // the whole point of pinning it.
    expect(screen.queryByText('unrelated.mkv')).toBeNull();
    expect(screen.getByRole('region', { name: 'Your downloads' }).textContent).toContain(
      'Celebrity.Wheel.of.Fortune.S01E01.tar',
    );
  });

  it('puts running transfers at the top of the tray, above finished ones', () => {
    render(
      <DccBrowser
        offers={[
          offer({ id: 'saved', filename: 'saved.mkv', status: 'downloaded' }),
          offer({ id: 'broke', filename: 'broke.mkv', status: 'failed' }),
          offer({ id: 'running', filename: 'running.mkv', status: 'downloading' }),
        ]}
        downloadFolder="/tmp/dl"
        onDownload={noop}
        onCancel={noop}
        onChooseFolder={noop}
        onClear={noop}
        onDismiss={noop}
        now={2_000}
      />,
    );

    const names = screen
      .getAllByRole('listitem')
      .map((item) => item.textContent?.match(/^[\w.]+\.mkv/)?.[0]);
    expect(names).toEqual(['running.mkv', 'broke.mkv', 'saved.mkv']);
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
          onDismiss={noop}
          now={2_000}
        />,
      );
      expect(screen.queryByRole('button', { name: /Cancel downloading/ })).toBeNull();
      cleanup();
    }
  });
});

describe('getting a row off the list', () => {
  const render_ = (offers: DccOfferRecord[], onDismiss: () => void) =>
    render(
      <DccBrowser
        offers={offers}
        downloadFolder="/tmp/dl"
        onDownload={noop}
        onCancel={noop}
        onChooseFolder={noop}
        onClear={noop}
        onDismiss={onDismiss}
        now={2_000}
      />,
    );

  it('offers a way out of a pack a bot never answered', () => {
    // `requested` is the state with no other control on it: the download button
    // is replaced by a disabled "Requested", and there is nothing to cancel
    // because nothing is running. Without this the row pinned itself to the top
    // of the list for good.
    const onDismiss = vi.fn();
    render_([offer({ status: 'requested', filename: 'holiday.zip' })], onDismiss);

    fireEvent.click(screen.getByRole('button', { name: 'Remove holiday.zip from the list' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('offers it in every other tracked state too', () => {
    for (const status of ['downloading', 'downloaded', 'failed'] as const) {
      const onDismiss = vi.fn();
      render_([offer({ status, filename: 'holiday.zip' })], onDismiss);
      expect(
        screen.getAllByRole('button', { name: /holiday\.zip.*from the list/ }).length,
        status,
      ).toBeGreaterThan(0);
      cleanup();
    }
  });

  it('says it stops the transfer when that is what it will do', () => {
    // Removing a running download cancels it. Saying only "remove from the
    // list" there would understate what the button does.
    const onDismiss = vi.fn();
    render_([offer({ status: 'downloading', filename: 'holiday.zip' })], onDismiss);

    expect(
      screen.getByRole('button', {
        name: 'Stop downloading holiday.zip and remove it from the list',
      }),
    ).toBeDefined();
  });

  it('is not confused with the cancel button beside it', () => {
    // A downloading row carries both. They must not be the same control twice.
    render_([offer({ status: 'downloading', filename: 'holiday.zip' })], vi.fn());

    expect(screen.getByRole('button', { name: 'Cancel downloading holiday.zip' })).toBeDefined();
    expect(
      screen.getByRole('button', {
        name: 'Stop downloading holiday.zip and remove it from the list',
      }),
    ).toBeDefined();
  });

  it('leaves the catalogue below it alone', () => {
    // Only the pinned rows get one; an untouched offer is removed by clearing,
    // and a bin on every one of thousands of catalogue rows would be noise.
    render_([offer({ status: 'available', filename: 'holiday.zip' })], vi.fn());
    expect(screen.queryByRole('button', { name: /from the list/ })).toBeNull();
  });
});
