import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyChannel, initialNetworkState } from '@marmotter/client';
import { Sidebar } from './Sidebar.js';

afterEach(cleanup);

const props = {
  networks: [],
  selection: undefined,
  onSelect: vi.fn(),
  unreadFor: () => ({ count: 0, highlight: false }),
  collapsed: new Set<string>(),
  onToggleCollapsed: vi.fn(),
  onReorder: vi.fn(),
  onAddNetwork: vi.fn(),
  onOpenSettings: vi.fn(),
};

describe('where settings open from', () => {
  it('keeps the gear in the header where nothing else carries it', () => {
    render(<Sidebar {...props} />);

    expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined();
  });

  it('gives the gear up to the window bar, rather than showing two', () => {
    render(<Sidebar {...props} showSettingsButton={false} />);

    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    // Adding a network still belongs to the sidebar either way: its header
    // button, beside the empty state's own.
    expect(screen.getAllByRole('button', { name: 'Add a network' }).length).toBeGreaterThan(0);
  });
});

describe('the right-click menu on a channel', () => {
  const withChannel = () => ({
    ...initialNetworkState('libera', 'Libera.Chat', 'marmot'),
    phase: 'registered' as const,
    channels: new Map([['#marmotter', { ...emptyChannel('#marmotter'), joined: true }]]),
  });

  it('offers whatever the shell put on it, for the channel it was opened on', () => {
    const onSelect = vi.fn();
    const conversationMenu = vi.fn(() => [
      { id: 'autojoin', label: 'Join automatically', onSelect },
    ]);

    render(<Sidebar {...props} networks={[withChannel()]} conversationMenu={conversationMenu} />);

    fireEvent.contextMenu(screen.getByText('#marmotter'));

    expect(conversationMenu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'libera' }),
      '#marmotter',
      'channel',
    );
    expect(screen.getByRole('menuitem', { name: 'Join automatically' })).toBeDefined();
  });
});
