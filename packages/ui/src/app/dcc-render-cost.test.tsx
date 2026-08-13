/**
 * What a busy file monitor costs the rest of the interface.
 *
 * Not a benchmark — a guard on the thing that actually went wrong. The shell
 * read the whole view store, so every catalogue line a serving bot posted and
 * every megabyte of every download re-rendered the client around the file pane.
 * These tests stand in for the shell with a component that reads the store the
 * way it does, and count.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_USER_OPTIONS, selectViewWithoutOffers, useView } from './view-store.js';

// Store updates here are driven straight at zustand rather than through a
// control, so React needs telling that `act` is available.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

describe('a busy monitor and the interface around it', () => {
  let renders = 0;

  /** Stands in for the shell: reads the store, renders everything else. */
  function Shell(): ReactNode {
    const view = useView(useShallow(selectViewWithoutOffers));
    renders += 1;
    return <p>{view.pane}</p>;
  }

  beforeEach(() => {
    renders = 0;
    useView.setState({
      userOptions: { ...DEFAULT_USER_OPTIONS, dccMonitorEnabled: true, downloadFolder: '/tmp/dl' },
      dccActive: true,
      dccOffers: [],
      pane: 'chat',
    });
  });

  it('does not re-render the shell for a bot listing its catalogue', () => {
    render(<Shell />);
    const before = renders;

    act(() => {
      for (let pack = 0; pack < 500; pack += 1) {
        useView.getState().recordXdccOffer({
          networkId: 'rizon',
          networkName: 'Rizon',
          from: '[EWG]Totoro',
          target: '#packlist',
          pack: { pack, gets: 3, filename: `Pack.${pack}.mkv`, sizeText: '1M', sizeBytes: 1024 },
          at: 1_000,
        });
      }
    });

    expect(useView.getState().dccOffers).toHaveLength(500);
    expect(renders).toBe(before);
  });

  it('does not re-render the shell as a download reports progress', () => {
    useView.getState().recordDccOffer({
      networkId: 'rizon',
      networkName: 'Rizon',
      from: 'tamsin',
      target: '#marmotter',
      send: {
        filename: 'holiday.jpg',
        host: '192.168.1.1',
        port: 5000,
        size: 100_000_000,
        passive: false,
      },
      at: 1_000,
    });
    const id = useView.getState().dccOffers[0]!.id;

    render(<Shell />);
    const before = renders;

    act(() => {
      for (let megabyte = 1; megabyte <= 100; megabyte += 1) {
        useView.getState().setDccOfferProgress(id, megabyte * 1_048_576);
      }
    });

    expect(useView.getState().dccOffers[0]?.received).toBe(100 * 1_048_576);
    expect(renders).toBe(before);
  });

  it('still re-renders the shell when it has something new to show', () => {
    render(<Shell />);
    const before = renders;

    act(() => {
      useView.getState().setPane('dcc');
    });

    expect(renders).toBeGreaterThan(before);
    expect(screen.getByText('dcc')).toBeDefined();
  });
});
