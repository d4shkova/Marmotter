import { DEFAULT_CTCP_POLICY } from '@marmotter/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings.js';
import { DEFAULT_APPEARANCE, DEFAULT_USER_OPTIONS, type BlockedSender } from './view-store.js';

afterEach(cleanup);

const noop = (): void => {};

function open(
  blockedSenders: readonly BlockedSender[],
  onUnblockSender = vi.fn<(networkId: string, nick: string) => void>(),
) {
  render(
    <Settings
      networks={[]}
      appearance={DEFAULT_APPEARANCE}
      onAppearanceChange={noop}
      ctcp={DEFAULT_CTCP_POLICY}
      onCtcpChange={noop}
      userOptions={{
        ...DEFAULT_USER_OPTIONS,
        dccMonitorEnabled: true,
        downloadFolder: '/downloads',
        blockedSenders,
      }}
      onUserOptionsChange={noop}
      onUnblockSender={onUnblockSender}
      dccAvailable
      onReconnect={noop}
      onDisconnect={noop}
      onEdit={noop}
      onRemove={noop}
      onAddNetwork={noop}
      onResetSettings={noop}
      onExportConfig={noop}
      onImportConfig={noop}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
  return onUnblockSender;
}

describe('the blocked senders list', () => {
  it('lists each blocked sender with its network, and takes one off when asked', () => {
    const unblock = open([
      { networkId: 'libera', networkName: 'Libera.Chat', nick: 'BadBot' },
      { networkId: 'rizon', networkName: 'Rizon', nick: 'SlowBot' },
    ]);

    expect(screen.getByText('Blocked senders')).toBeTruthy();
    expect(screen.getByText('Libera.Chat')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unblock SlowBot' }));
    expect(unblock).toHaveBeenCalledWith('rizon', 'SlowBot');
  });

  it('says nothing when nobody is blocked', () => {
    open([]);
    expect(screen.queryByText('Blocked senders')).toBeNull();
  });
});
