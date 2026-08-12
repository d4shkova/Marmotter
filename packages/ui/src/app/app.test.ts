import type { Message } from '@marmotter/client';
import { makeSource } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import { findCommand, parseInput, suggestCommands } from './commands.js';
import { complete, wordAt } from './completion.js';
import {
  fitNick,
  formatDay,
  formatIdle,
  formatTime,
  linkify,
  segment,
  stripFormatting,
} from './format.js';
import { lostConnectionText } from './Marmotter.js';
import { buildRows, summarise } from './rows.js';
import {
  TOAST_SECONDS_RANGE,
  clampToastSeconds,
  isHighlight,
  orderNetworks,
} from './view-store.js';

const at = (iso: string) => new Date(iso);

const message = (overrides: Partial<Message> & { id: string; at: Date }): Message => ({
  kind: 'privmsg',
  fromServerTime: true,
  source: makeSource('tamsin', '~t', 'host'),
  target: '#test',
  text: 'hello',
  account: undefined,
  replyTo: undefined,
  pending: false,
  tags: new Map(),
  ...overrides,
});

describe('formatting codes', () => {
  // Written as escapes rather than as literal control characters, so the
  // source stays readable and a stray byte cannot go unnoticed in review.
  const BOLD = '\u0002';
  const ITALIC = '\u001D';
  const COLOUR = '\u0003';
  const HEX_COLOUR = '\u0004';

  it('strips bold and italic', () => {
    expect(stripFormatting(`${BOLD}bold${BOLD} and ${ITALIC}italic${ITALIC}`)).toBe(
      'bold and italic',
    );
  });

  it('strips a colour code with its numbers', () => {
    // Leaving the digits behind is the classic bug: "4red" instead of "red".
    expect(stripFormatting(`${COLOUR}04red${COLOUR} again`)).toBe('red again');
    expect(stripFormatting(`${COLOUR}4,8both`)).toBe('both');
  });

  it('strips the hex colour form', () => {
    expect(stripFormatting(`${HEX_COLOUR}FF0000red`)).toBe('red');
  });

  it('leaves ordinary digits alone', () => {
    expect(stripFormatting('there are 04 of them')).toBe('there are 04 of them');
  });
});

describe('links', () => {
  it('finds one in the middle of a sentence', () => {
    expect(linkify('see https://example.com for more')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://example.com', href: 'https://example.com' },
      { kind: 'text', text: ' for more' },
    ]);
  });

  it('leaves a trailing full stop out of the link', () => {
    const parts = linkify('go to https://example.com.');
    expect(parts[1]).toEqual({
      kind: 'link',
      text: 'https://example.com',
      href: 'https://example.com',
    });
    expect(parts[2]).toEqual({ kind: 'text', text: '.' });
  });

  it('keeps a closing bracket that belongs to the link', () => {
    const parts = linkify('https://example.com/a_(b)');
    expect(parts[0]).toEqual({
      kind: 'link',
      text: 'https://example.com/a_(b)',
      href: 'https://example.com/a_(b)',
    });
  });

  it('does not link a bare hostname', () => {
    // A word that merely looks like a domain is not something to make
    // clickable: one accidental click is one request to somebody else's server.
    expect(linkify('example.com is a site')).toEqual([
      { kind: 'text', text: 'example.com is a site' },
    ]);
  });

  it('finds an irc link', () => {
    expect(linkify('ircs://irc.example.net/#chan')[0]?.kind).toBe('link');
  });
});

describe('nicks in text', () => {
  const isMember = (word: string) => ['tamsin', 'jonquil'].includes(word.toLowerCase());

  it('marks a nick that is in the channel', () => {
    expect(segment('tamsin: hello', isMember)).toEqual([
      { kind: 'nick', text: 'tamsin' },
      { kind: 'text', text: ': hello' },
    ]);
  });

  it('leaves an ordinary word alone', () => {
    expect(segment('hello there', isMember)).toEqual([{ kind: 'text', text: 'hello there' }]);
  });

  it('does not mark somebody who has left', () => {
    expect(segment('bramble said so', isMember)).toEqual([
      { kind: 'text', text: 'bramble said so' },
    ]);
  });
});

describe('timestamps', () => {
  it('pads to a fixed width, so the column stays straight', () => {
    expect(formatTime(new Date(2026, 7, 2, 9, 5))).toBe('09:05');
    expect(formatTime(new Date(2026, 7, 2, 9, 5, 3), true)).toBe('09:05:03');
  });

  it('names today and yesterday rather than dating them', () => {
    const today = new Date(2026, 7, 2, 12, 0);
    expect(formatDay(new Date(2026, 7, 2, 9, 0), today)).toBe('Today');
    expect(formatDay(new Date(2026, 7, 1, 9, 0), today)).toBe('Yesterday');
    expect(formatDay(new Date(2026, 6, 1, 9, 0), today)).not.toBe('Today');
  });
});

describe('the nick column', () => {
  it('truncates a long nick so the message edge stays straight', () => {
    expect(fitNick('averyverylongnickname', 12)).toBe('averyverylo…');
    expect(fitNick('short', 12)).toBe('short');
  });
});

describe('idle time', () => {
  it('counts seconds when that is all there is', () => {
    expect(formatIdle(1)).toBe('1 second');
    expect(formatIdle(45)).toBe('45 seconds');
  });

  it('reads out the two largest units in words', () => {
    expect(formatIdle(60)).toBe('1 minute');
    expect(formatIdle(3_600)).toBe('1 hour');
    expect(formatIdle(3_660)).toBe('1 hour, 1 minute');
    expect(formatIdle(8_130)).toBe('2 hours, 15 minutes');
    expect(formatIdle(90_000)).toBe('1 day, 1 hour');
  });

  it('skips a unit that is zero rather than saying "0 minutes"', () => {
    expect(formatIdle(86_400)).toBe('1 day');
  });
});

describe('rows', () => {
  const join = (nick: string, minute: number) =>
    message({
      id: `j${nick}${minute}`,
      at: at(`2026-08-02T09:0${minute}:00.000Z`),
      kind: 'join',
      source: makeSource(nick, '~u', 'host'),
      text: `${nick} joined`,
    });

  it('folds a burst of joins into one row', () => {
    const rows = buildRows(
      ['a', 'b', 'c'].map((nick, index) => join(nick, index)),
      { foldEvents: true },
    );
    const events = rows.filter((row) => row.kind === 'events');
    expect(events).toHaveLength(1);
    expect(events[0]?.kind === 'events' && events[0].summary).toBe('3 people joined');
  });

  it('leaves a single event as itself rather than a summary of one', () => {
    const rows = buildRows([join('a', 0)], { foldEvents: true });
    expect(rows.filter((row) => row.kind === 'events')).toHaveLength(0);
    expect(rows.filter((row) => row.kind === 'message')).toHaveLength(1);
  });

  it('does not fold when the channel asked not to', () => {
    const rows = buildRows(
      ['a', 'b', 'c'].map((nick, index) => join(nick, index)),
      { foldEvents: false },
    );
    expect(rows.filter((row) => row.kind === 'message')).toHaveLength(3);
  });

  it('starts a day with a separator', () => {
    const rows = buildRows(
      [
        message({ id: 'a', at: at('2026-08-01T23:00:00.000Z') }),
        message({ id: 'b', at: at('2026-08-02T09:00:00.000Z') }),
      ],
      { foldEvents: true },
    );
    expect(rows.filter((row) => row.kind === 'day')).toHaveLength(2);
  });

  it('collapses the nick column for consecutive messages from one person', () => {
    const rows = buildRows(
      [
        message({ id: 'a', at: at('2026-08-02T09:00:00.000Z') }),
        message({ id: 'b', at: at('2026-08-02T09:00:30.000Z') }),
      ],
      { foldEvents: true },
    );
    const messages = rows.filter((row) => row.kind === 'message');
    expect(messages[0]?.kind === 'message' && messages[0].grouped).toBe(false);
    expect(messages[1]?.kind === 'message' && messages[1].grouped).toBe(true);
  });

  it('starts a new block after a long enough gap', () => {
    const rows = buildRows(
      [
        message({ id: 'a', at: at('2026-08-02T09:00:00.000Z') }),
        message({ id: 'b', at: at('2026-08-02T09:30:00.000Z') }),
      ],
      { foldEvents: true },
    );
    const messages = rows.filter((row) => row.kind === 'message');
    expect(messages[1]?.kind === 'message' && messages[1].grouped).toBe(false);
  });

  it('marks where reading left off', () => {
    const rows = buildRows(
      [
        message({ id: 'a', at: at('2026-08-02T09:00:00.000Z') }),
        message({ id: 'b', at: at('2026-08-02T09:01:00.000Z') }),
      ],
      { foldEvents: true, unreadCount: 1 },
    );
    expect(rows.some((row) => row.kind === 'unread-marker')).toBe(true);
  });
});

describe('summaries', () => {
  const event = (nick: string, kind: Message['kind']) =>
    message({
      id: `${nick}${kind}`,
      at: at('2026-08-02T09:00:00.000Z'),
      kind,
      source: makeSource(nick, '~u', 'host'),
    });

  it('counts people rather than events', () => {
    // Somebody reconnecting three times is one person having trouble.
    expect(summarise([event('a', 'quit'), event('a', 'join'), event('a', 'quit')])).toBe(
      'a came and went',
    );
  });

  it('says what happened when it was all one thing', () => {
    expect(summarise([event('a', 'part'), event('b', 'part')])).toBe('2 people left');
    expect(summarise([event('a', 'quit'), event('b', 'quit')])).toBe('2 people disconnected');
  });

  it('gets the grammar right for one person', () => {
    expect(summarise([event('a', 'nick')])).toBe('a changed their name');
    expect(summarise([event('a', 'nick'), event('b', 'nick')])).toBe(
      '2 people changed their names',
    );
  });
});

describe('tab completion', () => {
  const fold = (value: string) => value.toLowerCase();
  const options = { nicks: ['tamsin', 'tamara', 'jonquil'], channels: ['#test', '#tea'], fold };

  it('finds the word before the caret', () => {
    expect(wordAt('hello tam', 9)).toEqual({ word: 'tam', start: 6 });
  });

  it('addresses somebody when completing at the start of a line', () => {
    const result = complete('tam', 3, options);
    expect(result?.text).toBe('tamsin: ');
    expect(result?.caret).toBe(8);
  });

  it('just mentions them anywhere else', () => {
    expect(complete('hello tam', 9, options)?.text).toBe('hello tamsin ');
  });

  it('cycles on a second press rather than starting over', () => {
    const first = complete('tam', 3, options);
    const second = complete(first?.text ?? '', first?.caret ?? 0, {
      ...options,
      previous: first?.state,
    });
    expect(second?.text).toBe('tamara: ');
  });

  it('cycles backwards with shift', () => {
    const first = complete('tam', 3, options);
    const back = complete(first?.text ?? '', first?.caret ?? 0, {
      ...options,
      previous: first?.state,
      backwards: true,
    });
    expect(back?.text).toBe('tamara: ');
  });

  it('completes a channel when the word starts with a channel character', () => {
    expect(complete('#te', 3, options)?.text).toBe('#test: ');
  });

  it('completes nothing when nothing matches', () => {
    expect(complete('zzz', 3, options)).toBeUndefined();
    expect(complete('', 0, options)).toBeUndefined();
  });

  it('is casemapped rather than case-sensitive', () => {
    expect(complete('TAM', 3, options)?.text).toBe('tamsin: ');
  });
});

describe('the command bar', () => {
  const context = { target: '#test', nick: 'marmot' };

  it('sends ordinary text as a message', () => {
    expect(parseInput('hello', context)).toEqual({ kind: 'message', text: 'hello' });
  });

  it('lets a doubled slash send a literal one', () => {
    expect(parseInput('//not a command', context)).toEqual({
      kind: 'message',
      text: '/not a command',
    });
  });

  it('builds a join', () => {
    const result = parseInput('/join #marmotter', context);
    expect(result.kind === 'line' && result.line).toBe('JOIN #marmotter');
  });

  it('fills in the current channel when a command allows it', () => {
    const result = parseInput('/part goodbye', context);
    expect(result.kind === 'line' && result.line).toBe('PART goodbye');
    expect(parseInput('/topic Marmot business', context)).toMatchObject({
      kind: 'line',
      line: 'TOPIC #test :Marmot business',
    });
  });

  it('sends a raw line exactly as typed', () => {
    const result = parseInput('/quote CAP LS 302', context);
    expect(result.kind === 'line' && result.line).toBe('CAP LS 302');
    const raw = parseInput('/raw PING :abc', context);
    expect(raw.kind === 'line' && raw.line).toBe('PING :abc');
  });

  it('wraps an action in CTCP', () => {
    const result = parseInput('/me waves', context);
    expect(result.kind === 'line' && result.line).toContain('ACTION waves');
  });

  it('reports a command it does not know rather than sending it', () => {
    expect(parseInput('/wibble', context)).toEqual({ kind: 'unknown', name: 'wibble' });
  });

  it('resolves an alias', () => {
    expect(findCommand('j')?.name).toBe('join');
    expect(findCommand('raw')?.name).toBe('quote');
    expect(findCommand('nope')).toBeUndefined();
  });

  it('suggests by prefix, including aliases', () => {
    expect(suggestCommands('/jo').map((command) => command.name)).toEqual(['join']);
    expect(suggestCommands('j').map((command) => command.name)).toEqual(['join']);
    expect(suggestCommands('').length).toBeGreaterThan(10);
  });

  it('documents every command it offers', () => {
    // A command bar that autocompletes without explaining only helps somebody
    // who already knew the command.
    for (const command of suggestCommands('')) {
      expect(command.summary.length, command.name).toBeGreaterThan(0);
      expect(command.summary.endsWith('.'), command.name).toBe(true);
    }
  });
});

describe('highlights', () => {
  it('matches the user’s own nick on a word boundary', () => {
    expect(isHighlight('marmot: hello', 'marmot', [])).toBe(true);
    expect(isHighlight('hello marmot', 'marmot', [])).toBe(true);
  });

  it('does not match a longer word containing the nick', () => {
    expect(isHighlight('marmots are great', 'marmot', [])).toBe(false);
  });

  it('matches an extra highlight word', () => {
    expect(isHighlight('anyone seen the build?', 'marmot', ['build'])).toBe(true);
  });

  it('ignores case', () => {
    expect(isHighlight('Marmot: hello', 'marmot', [])).toBe(true);
  });

  it('matches a nick with IRC punctuation in it', () => {
    expect(isHighlight('hello tamsin[m] there', 'tamsin[m]', [])).toBe(true);
  });

  it('matches nothing when there is nothing to match', () => {
    expect(isHighlight('hello', '', [])).toBe(false);
  });
});

describe('network order', () => {
  it('keeps the order the user dragged into', () => {
    expect(orderNetworks(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b']);
  });

  it('drops an order entry for a network that is gone', () => {
    expect(orderNetworks(['a'], ['b', 'a'])).toEqual(['a']);
  });

  it('leaves an unordered list alone', () => {
    expect(orderNetworks(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});

describe('the notice timeout', () => {
  it('keeps a chosen value inside the range it offers', () => {
    expect(clampToastSeconds(30)).toBe(30);
    expect(clampToastSeconds(TOAST_SECONDS_RANGE.min - 5)).toBe(TOAST_SECONDS_RANGE.min);
    expect(clampToastSeconds(TOAST_SECONDS_RANGE.max + 500)).toBe(TOAST_SECONDS_RANGE.max);
  });

  it('falls back to the default rather than trusting a value that is not a number', () => {
    // Restored settings come off disk, and a file somebody has edited by hand
    // is the normal way a NaN reaches this. A toast with a NaN timeout never
    // leaves the screen.
    expect(clampToastSeconds(Number.NaN)).toBe(TOAST_SECONDS_RANGE.default);
    expect(clampToastSeconds(Number.POSITIVE_INFINITY)).toBe(TOAST_SECONDS_RANGE.default);
  });

  it('rounds a fractional value, since the stepper counts whole seconds', () => {
    expect(clampToastSeconds(7.4)).toBe(7);
    expect(clampToastSeconds(7.6)).toBe(8);
  });
});

describe('what to say when a connection is lost for good', () => {
  it('tells the reasons apart, because the answers differ', () => {
    // Telling somebody to check their internet when the server rejected them
    // wastes their time looking in the wrong place.
    expect(lostConnectionText('Libera.Chat', { kind: 'timeout' })).toContain('did not respond');
    expect(lostConnectionText('Libera.Chat', { kind: 'server' })).toContain(
      'closed the connection',
    );
    expect(lostConnectionText('Libera.Chat', { kind: 'tls-error', message: 'expired' })).toContain(
      'certificate',
    );
  });

  it('points at the connection when there is nothing more specific to say', () => {
    expect(lostConnectionText('Libera.Chat', { kind: 'network-error', message: '' })).toContain(
      'Check your internet connection',
    );
  });

  it('carries the reason the transport gave, where it gave one', () => {
    expect(
      lostConnectionText('Libera.Chat', {
        kind: 'network-error',
        message: 'The server stopped responding.',
      }),
    ).toContain('The server stopped responding.');
  });

  it('names the network and never apologises', () => {
    for (const reason of [
      { kind: 'timeout' },
      { kind: 'server' },
      { kind: 'network-error', message: '' },
      { kind: 'user' },
    ] as const) {
      const text = lostConnectionText('Libera.Chat', reason);
      expect(text).toContain('Libera.Chat');
      expect(text.toLowerCase()).not.toContain('sorry');
      expect(text).toMatch(/\.$/);
    }
  });
});
