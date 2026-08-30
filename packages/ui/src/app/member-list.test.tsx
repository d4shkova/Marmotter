import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyChannel, initialNetworkState, type Member } from '@marmotter/client';
import { LONG_PRESS_MS } from '../lib/long-press.js';
import { MemberList } from './MemberList.js';

afterEach(cleanup);

const member = (nick: string, prefixes = ''): Member => ({
  nick,
  user: '',
  host: '',
  account: undefined,
  realname: '',
  away: false,
  bot: false,
  prefixes,
});

const network = initialNetworkState('libera', 'Libera.Chat', 'marmot');

const channel = (...nicks: readonly string[]) => ({
  ...emptyChannel('#marmotter'),
  joined: true,
  members: new Map(nicks.map((nick) => [nick, member(nick)])),
});

const menuFor = (): readonly { id: string; label: string; onSelect: () => void }[] => [
  { id: 'ban', label: 'Ban', onSelect: vi.fn() },
];

/**
 * Every menu in this list opened on a right-click, and a phone has none. What
 * it had instead was a `⋯` button revealed by a hover — a gesture a touch
 * screen cannot perform — so on the Android build the member actions could not
 * be reached at all.
 */
describe('reaching a member’s actions', () => {
  it('opens them on a right-click, for a pointer', () => {
    render(<MemberList network={network} channel={channel('tamsin')} menuFor={menuFor} />);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'tamsin' }));

    expect(screen.getByRole('menu', { name: 'Actions for tamsin' })).toBeTruthy();
  });

  it('opens them on a held name, for a finger', () => {
    vi.useFakeTimers();
    render(<MemberList network={network} channel={channel('tamsin')} menuFor={menuFor} />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'tamsin' }), {
      pointerType: 'touch',
      clientX: 20,
      clientY: 40,
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    vi.useRealTimers();

    expect(screen.getByRole('menu', { name: 'Actions for tamsin' })).toBeTruthy();
  });

  it('draws the actions button where nothing can hover to reveal it', () => {
    render(<MemberList network={network} channel={channel('tamsin')} menuFor={menuFor} />);

    const actions = screen.getByRole('button', { name: 'Actions for tamsin' });
    expect(actions.className).toContain('group-hover/member:opacity-100');
    expect(actions.className).toContain('pointer-coarse:opacity-100');
  });

  it('offers nothing where the shell gave it no actions to offer', () => {
    render(<MemberList network={network} channel={channel('tamsin')} />);

    expect(screen.queryByRole('button', { name: 'Actions for tamsin' })).toBeNull();
  });
});

/**
 * The list is the scrolling part of the panel, and on a phone the panel is a
 * bottom sheet — a flex column with a capped height. A flex item is floored at
 * its content height unless it is told otherwise, so without `min-h-0` a busy
 * channel's list ran past the bottom of the sheet and the names at the end were
 * unreachable.
 */
describe('a channel with more members than fit', () => {
  it('scrolls rather than growing past whatever is holding it', () => {
    render(<MemberList network={network} channel={channel('tamsin', 'ines', 'bo')} />);

    const list = screen.getByRole('list');
    expect(list.className).toContain('min-h-0');
    expect(list.className).toContain('overflow-y-auto');
  });
});
