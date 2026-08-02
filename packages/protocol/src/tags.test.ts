import { describe, expect, it } from 'vitest';
import { escapeTagValue, isClientTag, parseTags, serializeTags, unescapeTagValue } from './tags.js';

describe('unescapeTagValue', () => {
  it.each([
    ['\\:', ';'],
    ['\\s', ' '],
    ['\\\\', '\\'],
    ['\\r', '\r'],
    ['\\n', '\n'],
  ])('decodes %j', (input, expected) => {
    expect(unescapeTagValue(input)).toBe(expected);
  });

  it('drops the backslash from an undefined escape', () => {
    expect(unescapeTagValue('\\1')).toBe('1');
    expect(unescapeTagValue('\\q')).toBe('q');
  });

  it('drops a lone trailing backslash', () => {
    expect(unescapeTagValue('value\\')).toBe('value');
  });

  it('returns a value with no escapes unchanged', () => {
    expect(unescapeTagValue('plain value')).toBe('plain value');
  });

  it('handles an empty value', () => {
    expect(unescapeTagValue('')).toBe('');
  });
});

describe('escapeTagValue', () => {
  it('encodes every character that needs it', () => {
    expect(escapeTagValue('; \\\r\n')).toBe('\\:\\s\\\\\\r\\n');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeTagValue('plain')).toBe('plain');
  });

  it('round-trips through unescape', () => {
    for (const value of ['a;b', 'a b', 'a\\b', 'a\rb', 'a\nb', 'plain', '', '🦫']) {
      expect(unescapeTagValue(escapeTagValue(value))).toBe(value);
    }
  });
});

describe('parseTags', () => {
  it('reads names and values', () => {
    const tags = parseTags('a=1;b;c=hello');
    expect(tags.get('a')).toBe('1');
    expect(tags.get('b')).toBe('');
    expect(tags.get('c')).toBe('hello');
  });

  it('returns nothing for an empty section', () => {
    expect(parseTags('').size).toBe(0);
  });

  it('skips empty segments', () => {
    expect(parseTags('a=1;;b').size).toBe(2);
  });

  it('keeps the last of a duplicated name', () => {
    expect(parseTags('a=1;a=2').get('a')).toBe('2');
  });

  it('does not let a tag name reach an object prototype', () => {
    const tags = parseTags('__proto__=evil;constructor=bad');
    expect(tags.get('__proto__')).toBe('evil');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call({}, 'evil')).toBe(false);
  });
});

describe('serializeTags', () => {
  it('returns the empty string when there are no tags', () => {
    expect(serializeTags(new Map())).toBe('');
  });

  it('omits the equals sign for a valueless tag', () => {
    expect(serializeTags(new Map([['a', '']]))).toBe('@a');
  });

  it('escapes values', () => {
    expect(serializeTags(new Map([['a', 'x;y']]))).toBe('@a=x\\:y');
  });

  it('preserves insertion order so output is stable', () => {
    const tags = new Map([
      ['b', '2'],
      ['a', '1'],
    ]);
    expect(serializeTags(tags)).toBe('@b=2;a=1');
  });

  it('round-trips through parseTags', () => {
    const tags = new Map([
      ['time', '2026-07-30T09:14:00.000Z'],
      ['msgid', 'abc123'],
      ['+draft/reply', 'xyz'],
      ['empty', ''],
    ]);
    const reparsed = parseTags(serializeTags(tags).slice(1));
    expect([...reparsed]).toEqual([...tags]);
  });
});

describe('isClientTag', () => {
  it('recognises the client-only prefix', () => {
    expect(isClientTag('+draft/reply')).toBe(true);
    expect(isClientTag('server-time')).toBe(false);
  });
});
