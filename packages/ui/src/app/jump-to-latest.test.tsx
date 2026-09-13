import {
  emptyChannel,
  initialNetworkState,
  type ChannelState,
  type Message,
  type NetworkState,
} from '@marmotter/client';
import { DEFAULT_ISUPPORT, applyISupport, makeSource } from '@marmotter/protocol';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageList } from './MessageList.js';

afterEach(cleanup);

const support = applyISupport(DEFAULT_ISUPPORT, ['CHANTYPES=#', 'CASEMAPPING=rfc1459']);

const message = (id: string, text: string, kind: Message['kind'] = 'privmsg'): Message => ({
  id,
  kind,
  at: new Date('2026-08-02T09:00:00.000Z'),
  fromServerTime: true,
  source: makeSource('tamsin', '~t', 'host.example'),
  target: '#marmotter',
  text,
  account: undefined,
  replyTo: undefined,
  pending: false,
  tags: new Map(),
});

const channel = (messages: readonly Message[], name = '#marmotter'): ChannelState => ({
  ...emptyChannel(name),
  joined: true,
  messages: [...messages],
});

const network = (): NetworkState => ({
  ...initialNetworkState('libera', 'Libera.Chat', 'marmot'),
  phase: 'registered',
  support,
});

const list = (conversation: ChannelState, isHighlight?: (message: Message) => boolean) => (
  <MessageList
    network={network()}
    conversation={conversation}
    nickWidth={12}
    alignNicksRight
    showTimestamps
    foldEvents
    {...(isHighlight === undefined ? {} : { isHighlight })}
  />
);

const opening = Array.from({ length: 30 }, (_, i) => message(`m${i}`, `line ${i}`));

/**
 * jsdom gives every element a zero height, so a scroll event has to carry the
 * geometry it would have in a real window. These are the numbers the handler
 * reads, and nothing else about the element matters to it.
 */
function scrollTo(scroller: HTMLElement, position: 'top' | 'bottom'): void {
  const geometry = { scrollHeight: 4000, clientHeight: 400 };
  Object.defineProperty(scroller, 'scrollHeight', {
    value: geometry.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(scroller, 'clientHeight', {
    value: geometry.clientHeight,
    configurable: true,
  });
  Object.defineProperty(scroller, 'scrollTop', {
    value: position === 'bottom' ? geometry.scrollHeight - geometry.clientHeight : 0,
    writable: true,
    configurable: true,
  });
  fireEvent.scroll(scroller);
}

/** The element the list actually scrolls in. */
function scrollerOf(container: HTMLElement): HTMLElement {
  const found = container.querySelector('.overflow-y-auto');
  if (!(found instanceof HTMLElement)) {
    throw new Error('no scroller');
  }
  return found;
}

const jumpButton = () => screen.queryByRole('button', { name: /Jump to the latest/ });

describe('finding the way back to the live conversation', () => {
  it('offers nothing while the reader is at the bottom', () => {
    render(list(channel(opening)));
    expect(jumpButton()).toBeNull();
  });

  it('offers a way back as soon as the reader scrolls up', () => {
    const { container } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));

    // Shown on having scrolled up, not on somebody speaking: a person who
    // scrolled up into a quiet channel needs the way down just as much.
    expect(jumpButton()).not.toBeNull();
    expect(screen.getByText('Jump to latest')).toBeTruthy();
  });

  it('counts what arrives while they are reading', () => {
    const { container, rerender } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));

    rerender(list(channel([...opening, message('n1', 'hello'), message('n2', 'anyone about?')])));
    expect(screen.getByText('2 new messages')).toBeTruthy();

    rerender(
      list(channel([...opening, message('n1', 'hello'), message('n2', 'x'), message('n3', 'y')])),
    );
    expect(screen.getByText('3 new messages')).toBeTruthy();
  });

  it('says one message in the singular', () => {
    const { container, rerender } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));

    rerender(list(channel([...opening, message('n1', 'hello')])));
    expect(screen.getByText('1 new message')).toBeTruthy();
  });

  // A count that turns out to be three people reconnecting is a button that
  // teaches somebody not to trust it.
  it('does not count joins and parts as things people said', () => {
    const { container, rerender } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));

    rerender(
      list(
        channel([
          ...opening,
          message('j1', '', 'join'),
          message('j2', '', 'part'),
          message('j3', '', 'quit'),
        ]),
      ),
    );

    // Still offered — they are scrolled up and need the way down — but it does
    // not claim anybody spoke.
    expect(jumpButton()).not.toBeNull();
    expect(screen.getByText('Jump to latest')).toBeTruthy();
  });

  it('says when one of them was addressed to the reader', () => {
    const mentions = (candidate: Message): boolean => candidate.text.includes('marmot');
    const { container, rerender } = render(list(channel(opening), mentions));
    act(() => scrollTo(scrollerOf(container), 'top'));

    rerender(list(channel([...opening, message('n1', 'marmot: are you there?')]), mentions));

    const button = jumpButton();
    expect(button?.getAttribute('aria-label')).toContain('mentions you');
    // The accent, not red. Red in this interface always means something failed.
    expect(button?.className).toContain('bg-[var(--accent)]');
    expect(button?.className).not.toContain('danger');
  });

  it('goes away once the reader is back at the bottom', () => {
    const { container, rerender } = render(list(channel(opening)));
    const scroller = scrollerOf(container);
    act(() => scrollTo(scroller, 'top'));
    rerender(list(channel([...opening, message('n1', 'hello')])));
    expect(screen.getByText('1 new message')).toBeTruthy();

    act(() => scrollTo(scroller, 'bottom'));
    expect(jumpButton()).toBeNull();
  });

  it('clears the count when pressed', () => {
    const { container, rerender } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));
    rerender(list(channel([...opening, message('n1', 'hello')])));

    const button = jumpButton();
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });

    expect(jumpButton()).toBeNull();
  });

  // Without this, opening a channel inherits the last one's scroll position:
  // the button arrives already counting messages nobody missed.
  it('starts clean in a different conversation', () => {
    const { container, rerender } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));
    rerender(list(channel([...opening, message('n1', 'hello')])));
    expect(jumpButton()).not.toBeNull();

    rerender(list(channel(opening, '#elsewhere')));
    expect(jumpButton()).toBeNull();
  });

  // The scroller must not be the element the button is positioned against, or
  // it scrolls away with the content it is meant to escape.
  it('sits outside the scrolling area', () => {
    const { container } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));

    const button = jumpButton();
    expect(button).not.toBeNull();
    for (let node = button?.parentElement ?? null; node !== null; node = node.parentElement) {
      expect(node.className.toString()).not.toContain('overflow-y-auto');
    }
  });
});
