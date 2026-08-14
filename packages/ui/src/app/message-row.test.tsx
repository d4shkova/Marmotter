import type { Message } from '@marmotter/client';
import { makeSource } from '@marmotter/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageRow } from './MessageRow.js';
import type { Row } from './rows.js';

afterEach(cleanup);

const messageRow = (text: string): Extract<Row, { kind: 'message' }> => ({
  kind: 'message',
  id: 'm1',
  grouped: false,
  message: {
    id: 'm1',
    kind: 'privmsg',
    at: new Date(0),
    fromServerTime: true,
    source: makeSource('tamsin', '~t', 'host.example'),
    target: '#marmotter',
    text,
    account: undefined,
    replyTo: undefined,
    pending: false,
    tags: new Map<string, string>(),
  } satisfies Message,
});

describe('MessageRow links', () => {
  it('intercepts a link click so the interface can confirm it', () => {
    const onOpenLink = vi.fn();
    render(
      <MessageRow
        row={messageRow('logs at https://example.com/build/4821 if you want them')}
        nickWidth={12}
        alignNicksRight={false}
        showTimestamps={false}
        onOpenLink={onOpenLink}
      />,
    );

    const link = screen.getByRole('link', { name: 'https://example.com/build/4821' });
    const defaultPrevented = !fireEvent.click(link);

    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/build/4821');
    expect(defaultPrevented).toBe(true);
  });

  it('leaves the link alone when no handler is given', () => {
    render(
      <MessageRow
        row={messageRow('see https://example.com please')}
        nickWidth={12}
        alignNicksRight={false}
        showTimestamps={false}
      />,
    );

    // Still a real link with its href, so it can be copied from the menu.
    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link.getAttribute('href')).toBe('https://example.com');
  });
});

describe('the actions on a name', () => {
  // Right-clicking a name in the message list is where every other IRC client
  // puts these, and where somebody who has just read a line is looking.
  it('opens the menu on right-click, at the pointer', () => {
    const onNickMenu = vi.fn();
    render(
      <MessageRow
        row={messageRow('anyone around?')}
        nickWidth={12}
        alignNicksRight={false}
        showTimestamps={false}
        onNickMenu={onNickMenu}
      />,
    );

    const nick = screen.getByRole('button', { name: 'tamsin' });
    const defaultPrevented = !fireEvent.contextMenu(nick, { clientX: 120, clientY: 240 });

    expect(onNickMenu).toHaveBeenCalledWith('tamsin', { x: 120, y: 240 });
    // The browser's own menu must not open on top of ours.
    expect(defaultPrevented).toBe(true);
  });

  it('leaves right-click alone when there is no menu to open', () => {
    render(
      <MessageRow
        row={messageRow('anyone around?')}
        nickWidth={12}
        alignNicksRight={false}
        showTimestamps={false}
      />,
    );

    const nick = screen.getByRole('button', { name: 'tamsin' });
    expect(!fireEvent.contextMenu(nick)).toBe(false);
  });

  // An action carries its author inside the sentence rather than in the nick
  // column, so that is the name there is to click on one of those rows.
  it('offers the same menu from the name inside an action', () => {
    const onNickMenu = vi.fn();
    const row = messageRow('waves');
    render(
      <MessageRow
        row={{ ...row, message: { ...row.message, kind: 'action' } }}
        nickWidth={12}
        alignNicksRight={false}
        showTimestamps={false}
        onNickMenu={onNickMenu}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'tamsin' }), {
      clientX: 10,
      clientY: 20,
    });

    expect(onNickMenu).toHaveBeenCalledWith('tamsin', { x: 10, y: 20 });
  });
});
