import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES } from './limits.js';
import { message } from './message.js';
import { measureMessage, needsTrailing, serializeMessage } from './serialize.js';
import { makeSource } from './source.js';

describe('needsTrailing', () => {
  it.each([
    ['', true],
    ['has space', true],
    [':leading-colon', true],
    ['plain', false],
    ['has\ttab', false],
    ['trailing:colon', false],
  ])('reports %j as %j', (value, expected) => {
    expect(needsTrailing(value)).toBe(expected);
  });
});

describe('serializeMessage', () => {
  it('writes tags, source, verb, and parameters in order', () => {
    const result = serializeMessage(
      message({
        tags: new Map([['time', '2026-07-30T09:14:00.000Z']]),
        source: makeSource('nick', 'user', 'host'),
        command: 'PRIVMSG',
        params: ['#marmotter', 'hello there'],
      }),
    );
    expect(result).toEqual({
      ok: true,
      line: '@time=2026-07-30T09:14:00.000Z :nick!user@host PRIVMSG #marmotter :hello there',
    });
  });

  it('omits the tag section entirely when there are no tags', () => {
    const result = serializeMessage(message({ command: 'PING', params: ['token'] }));
    expect(result).toEqual({ ok: true, line: 'PING token' });
  });

  it('prefers the wire form of the verb when one was recorded', () => {
    const result = serializeMessage(
      message({ command: 'PRIVMSG', rawCommand: 'privmsg', params: ['#c', 'hi'] }),
    );
    expect(result.ok && result.line).toBe('privmsg #c hi');
  });
});

describe('measureMessage', () => {
  it('counts the body including CRLF', () => {
    const result = measureMessage(message({ command: 'PING', params: ['x'] }));
    expect(result.bodyBytes).toBe('PING x'.length + 2);
    expect(result.tagBytes).toBe(0);
    expect(result.withinBodyLimit).toBe(true);
  });

  it('measures the tag section separately, including its trailing space', () => {
    const result = measureMessage(
      message({ tags: new Map([['a', 'b']]), command: 'PING', params: ['x'] }),
    );
    expect(result.tagBytes).toBe('@a=b'.length + 1);
    // The tag section does not count against the 512-byte body limit.
    expect(result.bodyBytes).toBe('PING x'.length + 2);
  });

  it('measures multi-byte parameters in bytes', () => {
    const result = measureMessage(message({ command: 'PRIVMSG', params: ['#c', '🦫'] }));
    expect(result.bodyBytes).toBe('PRIVMSG #c '.length + 4 + 2);
  });

  it('reports a body over the limit', () => {
    const result = measureMessage(
      message({ command: 'PRIVMSG', params: ['#c', 'a'.repeat(MAX_MESSAGE_BYTES)] }),
    );
    expect(result.withinBodyLimit).toBe(false);
  });

  it('reports zero body bytes when the message cannot be serialized', () => {
    const result = measureMessage(message({ command: 'BAD VERB' }));
    expect(result.bodyBytes).toBe(0);
    expect(result.withinBodyLimit).toBe(true);
  });
});
