import {
  emptyChannel,
  initialNetworkState,
  type ChannelState,
  type Message,
  type NetworkState,
} from '@marmotter/client';
import { DEFAULT_ISUPPORT, applyISupport, makeSource } from '@marmotter/protocol';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { MessageList } from './MessageList.js';

afterEach(cleanup);

/**
 * Let the virtualizer's own timer run out before the file ends.
 *
 * Asking it to scroll schedules a debounced notification 150ms later, and
 * unmounting does not cancel it. Vitest tears the environment down per file, so
 * a run that finishes inside that window leaves the callback to fire against a
 * page where `window` no longer exists — an unhandled `ReferenceError`
 * attributed to whichever test happened to be last rather than to the scroll
 * that caused it. One wait at the end drains every test's.
 */
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 250));
});

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

/**
 * The counting, against a buffer that does not hold still.
 *
 * These are the two ways the message buffer moves under a mark: history
 * backfill splices older messages in ahead of it, and a busy channel trims from
 * the front. Counting from a position survived neither, and the case that
 * triggers the first is the very one the pill exists for — the scroll handler
 * that notices the reader has left the bottom is the same one that asks for
 * older history.
 */
describe('counting new messages while the buffer shifts', () => {
  it('does not count backfilled history as new', () => {
    const { container, rerender } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));

    // Older history arrives ahead of everything already held, which is what
    // loading earlier messages does.
    const older = Array.from({ length: 20 }, (_, i) => message(`old${i}`, `earlier ${i}`));
    rerender(list(channel([...older, ...opening])));

    // Nothing was said; the list simply grew upwards.
    expect(jumpButton()).not.toBeNull();
    expect(screen.getByText('Jump to latest')).toBeTruthy();
  });

  it('still counts what arrives after a backfill', () => {
    const { container, rerender } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));

    const older = Array.from({ length: 20 }, (_, i) => message(`old${i}`, `earlier ${i}`));
    rerender(list(channel([...older, ...opening])));
    rerender(list(channel([...older, ...opening, message('n1', 'hello')])));

    expect(screen.getByText('1 new message')).toBeTruthy();
  });

  // The mark itself can be trimmed away on a busy channel. Everything still
  // held is then newer than the last thing the reader saw, which is true.
  it('survives the mark being trimmed out of the buffer', () => {
    const { container, rerender } = render(list(channel(opening)));
    act(() => scrollTo(scrollerOf(container), 'top'));

    const fresh = Array.from({ length: 30 }, (_, i) => message(`f${i}`, `fresh ${i}`));
    rerender(list(channel(fresh)));

    expect(screen.getByText('30 new messages')).toBeTruthy();
  });
});

/**
 * Opening a different conversation.
 *
 * The scroll container is reused, and the effect that follows the tail only
 * fires when the row count changes — so a channel with as many rows as the last
 * one used to open at the previous channel's offset while claiming to be at the
 * bottom, with no pill to get back down.
 */
describe('switching to a conversation of the same length', () => {
  it("opens at the bottom rather than at the last one's offset", () => {
    const { container, rerender } = render(list(channel(opening)));
    const scroller = scrollerOf(container);
    act(() => scrollTo(scroller, 'top'));
    expect(jumpButton()).not.toBeNull();

    // Same number of messages, different channel.
    const elsewhere = opening.map((_, i) => message(`e${i}`, `elsewhere ${i}`));
    rerender(list(channel(elsewhere, '#elsewhere')));

    // jsdom measures every element as zero high, so the virtualizer's own
    // scroll cannot be observed here — what is checked is the state the pill
    // reads, which is what went wrong: the list used to claim it was at the
    // bottom of a channel it had never scrolled.
    expect(jumpButton()).toBeNull();
  });
});
