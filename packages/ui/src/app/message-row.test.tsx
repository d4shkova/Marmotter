import type { Message } from '@marmotter/client';
import { makeSource } from '@marmotter/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageRow } from './MessageRow.js';
import type { Row } from './rows.js';

afterEach(cleanup);

const messageRow = (text: string): Row => ({
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
