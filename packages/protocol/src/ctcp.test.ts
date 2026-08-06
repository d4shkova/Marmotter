import { describe, expect, it } from 'vitest';
import {
  AUTO_ANSWERED,
  ctcpDequote,
  ctcpQuote,
  decodeAction,
  decodeCtcp,
  encodeAction,
  encodeCtcp,
  extractCtcp,
  isAutoAnswered,
  isCtcp,
  lowLevelDequote,
  lowLevelQuote,
} from './ctcp.js';

const D = '\x01';

describe('low-level quoting', () => {
  it('escapes the bytes that cannot travel in an IRC message', () => {
    expect(lowLevelQuote('a\0b\nc\rd')).toBe('a\x100b\x10nc\x10rd');
  });

  it('escapes its own escape character', () => {
    expect(lowLevelQuote('a\x10b')).toBe('a\x10\x10b');
  });

  it('round-trips', () => {
    for (const value of ['plain', 'a\0b', 'a\nb', 'a\rb', 'a\x10b', '', '🦫']) {
      expect(lowLevelDequote(lowLevelQuote(value))).toBe(value);
    }
  });

  it('drops the escape from an unknown sequence', () => {
    expect(lowLevelDequote('a\x10qb')).toBe('aqb');
  });

  it('drops a trailing escape', () => {
    expect(lowLevelDequote('ab\x10')).toBe('ab');
  });

  it('leaves text without escapes untouched', () => {
    expect(lowLevelDequote('plain')).toBe('plain');
  });
});

describe('CTCP-level quoting', () => {
  it('escapes the delimiter and the backslash', () => {
    expect(ctcpQuote(`a${D}b\\c`)).toBe('a\\ab\\\\c');
  });

  it('round-trips', () => {
    for (const value of ['plain', `a${D}b`, 'a\\b', '\\a', '', '🦫']) {
      expect(ctcpDequote(ctcpQuote(value))).toBe(value);
    }
  });

  it('drops the escape from an unknown sequence', () => {
    expect(ctcpDequote('a\\qb')).toBe('aqb');
  });

  it('drops a trailing backslash', () => {
    expect(ctcpDequote('ab\\')).toBe('ab');
  });
});

describe('isCtcp', () => {
  it('recognises a delimited body', () => {
    expect(isCtcp(`${D}VERSION${D}`)).toBe(true);
    expect(isCtcp('ordinary message')).toBe(false);
  });
});

describe('extractCtcp', () => {
  it('reads a command with no parameters', () => {
    expect(extractCtcp(`${D}VERSION${D}`)).toEqual({
      messages: [{ command: 'VERSION', params: '' }],
      text: '',
    });
  });

  it('reads a command with parameters', () => {
    expect(extractCtcp(`${D}PING 1699999999${D}`).messages).toEqual([
      { command: 'PING', params: '1699999999' },
    ]);
  });

  it('uppercases the command', () => {
    expect(extractCtcp(`${D}version${D}`).messages[0]?.command).toBe('VERSION');
  });

  it('keeps surrounding plain text separate', () => {
    const result = extractCtcp(`before ${D}VERSION${D} after`);
    expect(result.messages).toEqual([{ command: 'VERSION', params: '' }]);
    expect(result.text).toBe('before  after');
  });

  it('reads several blocks in one message', () => {
    const result = extractCtcp(`${D}VERSION${D}${D}TIME${D}`);
    expect(result.messages.map((m) => m.command)).toEqual(['VERSION', 'TIME']);
  });

  it('tolerates an unterminated block', () => {
    expect(extractCtcp(`${D}ACTION waves`).messages).toEqual([
      { command: 'ACTION', params: 'waves' },
    ]);
  });

  it('ignores an empty block', () => {
    expect(extractCtcp(`${D}${D}`).messages).toEqual([]);
  });

  it('returns plain text unchanged when there is no CTCP', () => {
    expect(extractCtcp('just a message')).toEqual({ messages: [], text: 'just a message' });
  });

  it('unquotes both layers', () => {
    const body = lowLevelQuote(`${D}ACTION says \\a not a delimiter${D}`);
    expect(extractCtcp(body).messages).toEqual([
      { command: 'ACTION', params: `says ${D} not a delimiter` },
    ]);
  });
});

describe('decodeCtcp', () => {
  it('decodes a body that is exactly one CTCP message', () => {
    expect(decodeCtcp(`${D}VERSION${D}`)).toEqual({ command: 'VERSION', params: '' });
  });

  it('declines a body with text alongside the CTCP', () => {
    expect(decodeCtcp(`hello ${D}VERSION${D}`)).toBeUndefined();
  });

  it('declines a body with two CTCP messages', () => {
    expect(decodeCtcp(`${D}VERSION${D}${D}TIME${D}`)).toBeUndefined();
  });

  it('declines an ordinary message', () => {
    expect(decodeCtcp('hello')).toBeUndefined();
  });
});

describe('encodeCtcp', () => {
  it('wraps the command in delimiters', () => {
    expect(encodeCtcp('VERSION')).toBe(`${D}VERSION${D}`);
  });

  it('appends parameters', () => {
    expect(encodeCtcp('PING', '1699999999')).toBe(`${D}PING 1699999999${D}`);
  });

  it('uppercases the command', () => {
    expect(encodeCtcp('ping', '1')).toBe(`${D}PING 1${D}`);
  });

  it('round-trips through the decoder', () => {
    for (const [command, params] of [
      ['VERSION', ''],
      ['PING', '1699999999'],
      ['ACTION', 'waves at everyone'],
      ['ACTION', 'says 🦫'],
      ['ACTION', `embeds a ${D} delimiter`],
      ['ACTION', 'embeds a \\ backslash'],
    ] as const) {
      expect(decodeCtcp(encodeCtcp(command, params))).toEqual({ command, params });
    }
  });
});

describe('ACTION', () => {
  it('encodes and decodes the /me command', () => {
    expect(encodeAction('waves')).toBe(`${D}ACTION waves${D}`);
    expect(decodeAction(`${D}ACTION waves${D}`)).toBe('waves');
  });

  it('returns nothing for a different CTCP command', () => {
    expect(decodeAction(`${D}VERSION${D}`)).toBeUndefined();
  });

  it('returns nothing for an ordinary message', () => {
    expect(decodeAction('waves')).toBeUndefined();
  });
});

describe('automatic answers', () => {
  it('answers only the small set that leaks least', () => {
    expect([...AUTO_ANSWERED].sort()).toEqual(['CLIENTINFO', 'PING', 'TIME', 'VERSION']);
  });

  it('matches case-insensitively', () => {
    expect(isAutoAnswered('version')).toBe(true);
    expect(isAutoAnswered('VERSION')).toBe(true);
  });

  it('does not answer anything else', () => {
    // DCC is surfaced to the file monitor, never auto-answered as a CTCP reply.
    expect(isAutoAnswered('DCC')).toBe(false);
    expect(isAutoAnswered('USERINFO')).toBe(false);
    expect(isAutoAnswered('FINGER')).toBe(false);
  });
});
