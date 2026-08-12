import type { LogRecord, LoggingPolicy } from '@marmotter/shared';
import { defaultLoggingPolicy } from '@marmotter/shared';
import { makeSource } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import type { Message } from '../state/types.js';
import { effectivePolicy, retentionCutoff, shouldLog, targetKind } from './policy.js';
import { fileFor, formatLine, groupByFile, safeSegment, stampOf } from './plaintext.js';
import { toLogRecord } from './records.js';
import { matchesTerms, parseLine, selectMatching, termsOf, withinRange } from './search.js';

const isChannel = (target: string): boolean => target.startsWith('#');

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  kind: 'privmsg',
  at: new Date('2026-08-12T14:30:05Z'),
  fromServerTime: true,
  source: makeSource('tamsin', '~t', 'host'),
  target: '#marmotter',
  text: 'morning',
  account: undefined,
  replyTo: undefined,
  pending: false,
  tags: new Map(),
  ...overrides,
});

const policy = (overrides: Partial<LoggingPolicy> = {}): LoggingPolicy => ({
  ...defaultLoggingPolicy,
  enabled: true,
  ...overrides,
});

const record = (overrides: Partial<LogRecord> = {}): LogRecord => ({
  id: 'm1',
  networkId: 'n1',
  networkName: 'Libera.Chat',
  target: '#marmotter',
  at: new Date(2026, 7, 12, 14, 30, 5),
  kind: 'privmsg',
  nick: 'tamsin',
  text: 'morning',
  ...overrides,
});

describe('what gets logged', () => {
  it('writes nothing at all while logging is off', () => {
    // The default, on every platform. Enabling it is the explicit choice.
    expect(shouldLog(defaultLoggingPolicy, message(), isChannel)).toBe(false);
    expect(defaultLoggingPolicy.enabled).toBe(false);
  });

  it('follows the scope for channels, private messages and server notices', () => {
    const only = (scope: Partial<LoggingPolicy['scope']>) =>
      policy({
        scope: { channels: false, privateMessages: false, serverNotices: false, ...scope },
      });

    expect(shouldLog(only({ channels: true }), message(), isChannel)).toBe(true);
    expect(shouldLog(only({ privateMessages: true }), message(), isChannel)).toBe(false);

    const direct = message({ target: 'jonquil' });
    expect(shouldLog(only({ privateMessages: true }), direct, isChannel)).toBe(true);
    expect(shouldLog(only({ channels: true }), direct, isChannel)).toBe(false);

    const notice = message({ kind: 'server', target: '' });
    expect(shouldLog(only({ serverNotices: true }), notice, isChannel)).toBe(true);
    expect(shouldLog(only({ channels: true, privateMessages: true }), notice, isChannel)).toBe(
      false,
    );
  });

  it('reads what counts as a channel from the network, not from a hash', () => {
    // A network whose CHANTYPES is `&` has channels that do not start with `#`.
    const amp = (target: string): boolean => target.startsWith('&');
    expect(targetKind(message({ target: '&ops' }), amp)).toBe('channel');
    expect(targetKind(message({ target: '#marmotter' }), amp)).toBe('private');
  });

  it('never writes a message that has not been acknowledged', () => {
    // An optimistic send has no confirmed text or time yet. It is logged when
    // `echo-message` returns it, or not at all — writing it twice is worse.
    expect(shouldLog(policy(), message({ pending: true }), isChannel)).toBe(false);
  });

  it("never writes the client's own error lines", () => {
    // These are the interface talking to the person in front of it, not the
    // conversation. A log of them is a log of Marmotter, not of IRC.
    expect(
      shouldLog(
        policy({ scope: { channels: true, privateMessages: true, serverNotices: true } }),
        message({ kind: 'error' }),
        isChannel,
      ),
    ).toBe(false);
  });
});

describe('how long it is kept', () => {
  it('keeps everything when retention is forever', () => {
    expect(retentionCutoff(policy({ retentionDays: 'forever' }), new Date())).toBeUndefined();
  });

  it('cuts off a whole number of days back', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    const cutoff = retentionCutoff(policy({ retentionDays: 30 }), now);
    expect(cutoff?.toISOString()).toBe('2026-07-13T00:00:00.000Z');
  });

  it('treats a nonsensical retention as "keep nothing older than now"', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    expect(retentionCutoff(policy({ retentionDays: -5 }), now)?.getTime()).toBe(now.getTime());
  });
});

describe('a network overriding the global policy', () => {
  it('follows the global policy where it has no override', () => {
    const global = policy({ retentionDays: 30 });
    expect(effectivePolicy(global, undefined)).toEqual(global);
  });

  it('lets a network keep less than the rest', () => {
    const merged = effectivePolicy(
      policy({ retentionDays: 'forever' }),
      policy({ retentionDays: 7 }),
    );
    expect(merged.retentionDays).toBe(7);
  });

  it('cannot keep logging after logging is switched off globally', () => {
    // Somebody reaching for the global switch means everywhere. An override
    // that kept writing past it would be a setting that lies.
    const merged = effectivePolicy(policy({ enabled: false }), policy({ enabled: true }));
    expect(merged.enabled).toBe(false);
  });
});

describe('the plaintext format', () => {
  it("uses HexChat's stamp, so the tools people already have keep working", () => {
    expect(stampOf(new Date(2026, 7, 12, 9, 5, 3))).toBe('Aug 12 09:05:03');
  });

  it('writes speech, actions and notices apart from one another', () => {
    expect(formatLine(record())).toBe('Aug 12 14:30:05 <tamsin>\tmorning');
    expect(formatLine(record({ kind: 'action', text: 'waves' }))).toBe(
      'Aug 12 14:30:05 *\ttamsin waves',
    );
    expect(formatLine(record({ kind: 'notice' }))).toBe('Aug 12 14:30:05 -tamsin-\tmorning');
    expect(formatLine(record({ kind: 'join', text: '' }))).toBe(
      'Aug 12 14:30:05 *\ttamsin has joined',
    );
  });

  it('never lets a message break the line it is written on', () => {
    // IRC cannot carry a newline, but a relay or a paste service can put one in
    // a tag. One that reached the file would make the log unparseable.
    const line = formatLine(record({ text: 'first\nsecond' }));
    expect(line).toBe('Aug 12 14:30:05 <tamsin>\tfirst second');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('files a conversation under its network', () => {
    expect(fileFor(record())).toBe('Libera.Chat/#marmotter.log');
    expect(fileFor(record({ target: 'jonquil' }))).toBe('Libera.Chat/jonquil.log');
  });

  it('files a server notice under the network itself', () => {
    expect(fileFor(record({ target: '', kind: 'server' }))).toBe('Libera.Chat/Libera.Chat.log');
  });

  it('makes a channel name safe on every platform without losing it', () => {
    // `#foo\bar` and `#c++` are legal channels; a filename is stricter than IRC
    // is, and Windows is stricter than the rest. Using its rules everywhere
    // means a folder copied from Linux still opens there.
    expect(safeSegment('#foo\\bar')).toBe('#foo_bar');
    expect(safeSegment('#a:b*c?d')).toBe('#a_b_c_d');
    expect(safeSegment('')).toBe('_');
    expect(safeSegment('trailing.')).toBe('trailing');
  });

  it('strips the formatting codes a channel name may carry', () => {
    // mIRC colour codes are legal in a channel name and produce a filename no
    // file manager will show.
    expect(safeSegment('#\u0003' + '04red')).toBe('#_04red');
  });

  it('sidesteps the names Windows reserves', () => {
    expect(safeSegment('con')).toBe('_con');
    expect(safeSegment('LPT1')).toBe('_LPT1');
    expect(safeSegment('#con')).toBe('#con');
  });

  it('groups a batch by the file each line belongs in', () => {
    const grouped = groupByFile([
      record({ id: 'a' }),
      record({ id: 'b', target: 'jonquil' }),
      record({ id: 'c' }),
    ]);

    expect([...grouped.keys()]).toEqual(['Libera.Chat/#marmotter.log', 'Libera.Chat/jonquil.log']);
    expect(grouped.get('Libera.Chat/#marmotter.log')?.map((entry) => entry.id)).toEqual(['a', 'c']);
  });
});

describe('searching', () => {
  it('requires every word, in any order', () => {
    expect(matchesTerms('the marmot ate a photo', termsOf('marmot photo'))).toBe(true);
    expect(matchesTerms('the marmot ate', termsOf('marmot photo'))).toBe(false);
  });

  it('keeps a quoted phrase together', () => {
    expect(termsOf('"marmot photo" holiday')).toEqual(['marmot photo', 'holiday']);
    expect(matchesTerms('a marmot photo here', termsOf('"marmot photo"'))).toBe(true);
    expect(matchesTerms('a photo of a marmot', termsOf('"marmot photo"'))).toBe(false);
  });

  it('matches whatever the case', () => {
    expect(matchesTerms('Marmot Photo', termsOf('marmot PHOTO'))).toBe(true);
  });

  it('an empty search is a date and conversation filter, not nothing', () => {
    expect(matchesTerms('anything at all', termsOf('  '))).toBe(true);
  });

  it('narrows to a network, a conversation and a date range', () => {
    const entry = record({ at: new Date(2026, 7, 12) });
    expect(withinRange(entry, { text: '', limit: 10, networkId: 'n1' })).toBe(true);
    expect(withinRange(entry, { text: '', limit: 10, networkId: 'other' })).toBe(false);
    expect(withinRange(entry, { text: '', limit: 10, target: '#marmotter' })).toBe(true);
    expect(withinRange(entry, { text: '', limit: 10, target: '#other' })).toBe(false);
    expect(withinRange(entry, { text: '', limit: 10, from: new Date(2026, 7, 13) })).toBe(false);
    expect(withinRange(entry, { text: '', limit: 10, to: new Date(2026, 7, 11) })).toBe(false);
  });

  it('returns the newest first, and no more than asked for', () => {
    const hits = selectMatching(
      [
        record({ id: 'old', at: new Date(2026, 0, 1), text: 'marmot' }),
        record({ id: 'new', at: new Date(2026, 7, 1), text: 'marmot' }),
        record({ id: 'mid', at: new Date(2026, 3, 1), text: 'marmot' }),
        record({ id: 'no', text: 'something else' }),
      ],
      { text: 'marmot', limit: 2 },
    );

    expect(hits.map((hit) => hit.id)).toEqual(['new', 'mid']);
  });
});

describe('reading a plaintext log back', () => {
  const context = {
    networkId: 'n1',
    networkName: 'Libera.Chat',
    target: '#marmotter',
    reference: new Date(2026, 7, 12, 18, 0, 0),
  };

  it('round-trips a line it wrote', () => {
    const original = record({ at: new Date(2026, 7, 12, 14, 30, 5) });
    const parsed = parseLine(formatLine(original), context);

    expect(parsed?.nick).toBe('tamsin');
    expect(parsed?.text).toBe('morning');
    expect(parsed?.kind).toBe('privmsg');
    expect(parsed?.at.getTime()).toBe(original.at.getTime());
  });

  it('reads a notice back as a notice', () => {
    const parsed = parseLine(formatLine(record({ kind: 'notice' })), context);
    expect(parsed?.kind).toBe('notice');
    expect(parsed?.nick).toBe('tamsin');
  });

  it('puts a line stamped later in the year than now into last year', () => {
    // The format carries no year, which is HexChat's, and a December line read
    // in January is eleven months in the past rather than in the future.
    const january = { ...context, reference: new Date(2026, 0, 5, 12, 0, 0) };
    const parsed = parseLine('Dec 20 09:00:00 <tamsin>\tmorning', january);

    expect(parsed?.at.getFullYear()).toBe(2025);
  });

  it('ignores a line that is not one of ours rather than inventing a record', () => {
    expect(parseLine('', context)).toBeUndefined();
    expect(parseLine('not a log line', context)).toBeUndefined();
    expect(parseLine('Foo 99 99:99:99 <x>\ty', context)).toBeUndefined();
  });
});

describe('turning a message into a record', () => {
  it('keeps what a person would want a year later and drops the rest', () => {
    const entry = toLogRecord(message(), { id: 'n1', name: 'Libera.Chat' });

    expect(entry).toEqual({
      id: 'm1',
      networkId: 'n1',
      networkName: 'Libera.Chat',
      target: '#marmotter',
      at: new Date('2026-08-12T14:30:05Z'),
      kind: 'privmsg',
      nick: 'tamsin',
      text: 'morning',
    });
  });

  it('records a line the server itself sent with no nick', () => {
    const entry = toLogRecord(message({ source: undefined, kind: 'server' }), {
      id: 'n1',
      name: 'Libera.Chat',
    });
    expect(entry.nick).toBe('');
  });
});
