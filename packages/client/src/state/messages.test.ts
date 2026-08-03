import { makeSource } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import {
  derivedId,
  hasGap,
  insertMessage,
  reconcileEcho,
  timestampOf,
  withoutIgnored,
} from './messages.js';
import type { Message } from './types.js';

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

const buffer = (...entries: [string, string][]): readonly Message[] =>
  entries.map(([id, iso]) => message({ id, at: at(iso), text: id }));

describe('stable ids', () => {
  it('derives the same id for the same message arriving twice', () => {
    const base = {
      at: at('2026-08-02T09:00:00.000Z'),
      target: '#test',
      text: 'hello',
      source: { nick: 'tamsin' },
    };
    expect(derivedId(base)).toBe(derivedId({ ...base }));
  });

  it('derives different ids for different senders', () => {
    const base = { at: at('2026-08-02T09:00:00.000Z'), target: '#test', text: 'hello' };
    expect(derivedId({ ...base, source: { nick: 'tamsin' } })).not.toBe(
      derivedId({ ...base, source: { nick: 'jonquil' } }),
    );
  });

  it('ignores sub-second differences, so a rounded history copy still matches', () => {
    const target = '#test';
    const text = 'hello';
    const source = { nick: 'tamsin' };
    expect(derivedId({ at: at('2026-08-02T09:00:00.100Z'), target, text, source })).toBe(
      derivedId({ at: at('2026-08-02T09:00:00.900Z'), target, text, source }),
    );
  });

  it('copes with a message from a server, which has no nick', () => {
    expect(
      derivedId({
        at: at('2026-08-02T09:00:00.000Z'),
        target: '',
        text: 'notice',
        source: undefined,
      }),
    ).toContain('d:');
  });
});

describe('timestamps', () => {
  it('prefers the server’s clock, and says so', () => {
    const tags = new Map([['time', '2026-08-02T09:00:00.000Z']]);
    expect(timestampOf(tags)).toEqual({
      at: at('2026-08-02T09:00:00.000Z'),
      fromServerTime: true,
    });
  });

  it('falls back to the local clock, and says so', () => {
    const now = () => at('2026-08-02T12:00:00.000Z');
    expect(timestampOf(new Map(), now)).toEqual({
      at: at('2026-08-02T12:00:00.000Z'),
      fromServerTime: false,
    });
  });

  it('falls back when the tag is not a time at all', () => {
    const now = () => at('2026-08-02T12:00:00.000Z');
    expect(timestampOf(new Map([['time', 'nonsense']]), now).fromServerTime).toBe(false);
    expect(timestampOf(new Map([['time', '']]), now).fromServerTime).toBe(false);
  });
});

describe('inserting', () => {
  it('appends the common case without re-sorting', () => {
    const messages = insertMessage(
      buffer(['a', '2026-08-02T09:00:00.000Z']),
      message({ id: 'b', at: at('2026-08-02T09:01:00.000Z') }),
    );
    expect(messages.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('places an out-of-order message by its timestamp', () => {
    const messages = insertMessage(
      buffer(['a', '2026-08-02T09:00:00.000Z'], ['c', '2026-08-02T09:02:00.000Z']),
      message({ id: 'b', at: at('2026-08-02T09:01:00.000Z') }),
    );
    expect(messages.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('places a message older than everything at the front', () => {
    const messages = insertMessage(
      buffer(['b', '2026-08-02T09:01:00.000Z']),
      message({ id: 'a', at: at('2026-08-02T09:00:00.000Z') }),
    );
    expect(messages.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('starts an empty buffer', () => {
    const messages = insertMessage([], message({ id: 'a', at: at('2026-08-02T09:00:00.000Z') }));
    expect(messages).toHaveLength(1);
  });

  it('does not add the same message twice', () => {
    const existing = buffer(['a', '2026-08-02T09:00:00.000Z']);
    const messages = insertMessage(
      existing,
      message({ id: 'a', at: at('2026-08-02T09:00:00.000Z') }),
    );
    expect(messages).toHaveLength(1);
  });

  it('takes the better copy when a duplicate carries more detail', () => {
    const existing = [message({ id: 'a', at: at('2026-08-02T09:00:00.000Z'), pending: true })];
    const messages = insertMessage(
      existing,
      message({ id: 'a', at: at('2026-08-02T09:00:00.000Z'), account: 'tam' }),
    );
    expect(messages[0]?.pending).toBe(false);
    expect(messages[0]?.account).toBe('tam');
  });

  it('does not let a pending copy overwrite a confirmed one', () => {
    const existing = [message({ id: 'a', at: at('2026-08-02T09:00:00.000Z'), account: 'tam' })];
    const messages = insertMessage(
      existing,
      message({ id: 'a', at: at('2026-08-02T09:00:00.000Z'), pending: true }),
    );
    expect(messages).toBe(existing);
  });

  it('drops the oldest once the buffer is full', () => {
    let messages: readonly Message[] = [];
    for (let index = 0; index < 5; index += 1) {
      messages = insertMessage(
        messages,
        message({ id: `m${index}`, at: at(`2026-08-02T09:0${index}:00.000Z`) }),
        3,
      );
    }
    expect(messages.map((entry) => entry.id)).toEqual(['m2', 'm3', 'm4']);
  });

  it('enforces the limit on an out-of-order insert too', () => {
    const existing = buffer(
      ['a', '2026-08-02T09:00:00.000Z'],
      ['c', '2026-08-02T09:02:00.000Z'],
      ['d', '2026-08-02T09:03:00.000Z'],
    );
    const messages = insertMessage(
      existing,
      message({ id: 'b', at: at('2026-08-02T09:01:00.000Z') }),
      3,
    );
    expect(messages.map((entry) => entry.id)).toEqual(['b', 'c', 'd']);
  });
});

describe('reconciling our own messages', () => {
  it('matches the echo on msgid when the server gave one', () => {
    const existing = [
      message({ id: 'e1', at: at('2026-08-02T09:00:00.000Z'), pending: true, text: 'mine' }),
    ];
    const messages = reconcileEcho(
      existing,
      message({ id: 'e1', at: at('2026-08-02T09:00:00.000Z'), text: 'mine' }),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.pending).toBe(false);
  });

  it('matches the most recent pending line when the ids differ', () => {
    const existing = [
      message({ id: 'd:1', at: at('2026-08-02T09:00:00.000Z'), pending: true, text: 'mine' }),
    ];
    const messages = reconcileEcho(
      existing,
      message({ id: 'server-id', at: at('2026-08-02T09:00:01.000Z'), text: 'mine' }),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe('server-id');
    expect(messages[0]?.pending).toBe(false);
  });

  it('never matches somebody else’s line, because only ours are pending', () => {
    const existing = [message({ id: 'other', at: at('2026-08-02T09:00:00.000Z'), text: 'mine' })];
    const messages = reconcileEcho(
      existing,
      message({ id: 'server-id', at: at('2026-08-02T09:00:01.000Z'), text: 'mine' }),
    );
    expect(messages).toHaveLength(2);
  });

  it('does not match a pending line on a different target', () => {
    const existing = [
      message({
        id: 'd:1',
        at: at('2026-08-02T09:00:00.000Z'),
        pending: true,
        text: 'mine',
        target: '#other',
      }),
    ];
    const messages = reconcileEcho(
      existing,
      message({ id: 'server-id', at: at('2026-08-02T09:00:01.000Z'), text: 'mine' }),
    );
    expect(messages).toHaveLength(2);
  });

  it('just inserts an echo with nothing to reconcile against', () => {
    const messages = reconcileEcho(
      [],
      message({ id: 'server-id', at: at('2026-08-02T09:00:00.000Z') }),
    );
    expect(messages).toHaveLength(1);
  });
});

describe('gaps', () => {
  const messages = buffer(['live', '2026-08-02T09:00:00.000Z']);

  it('reports a hole when history ends before the buffer starts', () => {
    expect(hasGap(messages, at('2026-08-02T07:00:00.000Z'), at('2026-08-02T08:00:00.000Z'))).toBe(
      true,
    );
  });

  it('reports none when the two overlap', () => {
    expect(hasGap(messages, at('2026-08-02T07:00:00.000Z'), at('2026-08-02T09:30:00.000Z'))).toBe(
      false,
    );
  });

  it('claims nothing without history to compare against', () => {
    expect(hasGap(messages, undefined, undefined)).toBe(false);
    expect(hasGap(messages, at('2026-08-02T07:00:00.000Z'), undefined)).toBe(false);
  });

  it('claims nothing about an empty buffer', () => {
    expect(hasGap([], at('2026-08-02T07:00:00.000Z'), at('2026-08-02T08:00:00.000Z'))).toBe(false);
  });
});

describe('filtering out a muted person', () => {
  it('drops their lines and keeps everyone else’s', () => {
    const messages = [
      message({ id: 'a', at: at('2026-08-02T09:00:00.000Z') }),
      message({
        id: 'b',
        at: at('2026-08-02T09:01:00.000Z'),
        source: makeSource('jonquil', '~j', 'host'),
      }),
    ];
    const kept = withoutIgnored(messages, (nick) => nick === 'tamsin');
    expect(kept.map((entry) => entry.id)).toEqual(['b']);
  });

  it('keeps lines with no sender, which are the server’s', () => {
    const messages = [message({ id: 'a', at: at('2026-08-02T09:00:00.000Z'), source: undefined })];
    expect(withoutIgnored(messages, () => true)).toHaveLength(1);
  });
});
