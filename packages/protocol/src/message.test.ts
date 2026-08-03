import { describe, expect, it } from 'vitest';
import { isCommand, isNumeric, message, param, upperAscii } from './message.js';

describe('message', () => {
  it('defaults the optional fields', () => {
    const msg = message({ command: 'PING' });
    expect(msg.tags.size).toBe(0);
    expect(msg.params).toEqual([]);
    expect(msg.source).toBeUndefined();
    expect(msg.rawCommand).toBeUndefined();
  });

  it('keeps the fields it is given', () => {
    const msg = message({
      command: 'PRIVMSG',
      params: ['#c', 'hi'],
      tags: new Map([['a', 'b']]),
    });
    expect(msg.params).toEqual(['#c', 'hi']);
    expect(msg.tags.get('a')).toBe('b');
  });
});

describe('upperAscii', () => {
  it('uppercases ASCII letters', () => {
    expect(upperAscii('privmsg')).toBe('PRIVMSG');
  });

  it('leaves digits and punctuation alone', () => {
    expect(upperAscii('001')).toBe('001');
    expect(upperAscii('a-b_c')).toBe('A-B_C');
  });

  it('does not touch non-ASCII characters', () => {
    // toUpperCase() would fold these; the protocol is ASCII-only here.
    expect(upperAscii('é')).toBe('é');
    expect(upperAscii('ß')).toBe('ß');
  });
});

describe('isCommand', () => {
  it('compares case-insensitively', () => {
    const msg = message({ command: 'PRIVMSG' });
    expect(isCommand(msg, 'privmsg')).toBe(true);
    expect(isCommand(msg, 'PRIVMSG')).toBe(true);
    expect(isCommand(msg, 'NOTICE')).toBe(false);
  });
});

describe('isNumeric', () => {
  it.each(['001', '005', '353', '999', '000'])('accepts %j', (value) => {
    expect(isNumeric(value)).toBe(true);
  });

  it.each(['1', '01', '0001', 'PING', '00a', 'a01', '0a1', ''])('rejects %j', (value) => {
    expect(isNumeric(value)).toBe(false);
  });
});

describe('param', () => {
  it('reads a positional parameter', () => {
    const msg = message({ command: 'PRIVMSG', params: ['#c', 'hi'] });
    expect(param(msg, 0)).toBe('#c');
    expect(param(msg, 1)).toBe('hi');
  });

  it('returns the empty string rather than undefined when absent', () => {
    expect(param(message({ command: 'PING' }), 3)).toBe('');
  });
});
