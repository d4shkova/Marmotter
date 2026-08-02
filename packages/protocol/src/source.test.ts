import { describe, expect, it } from 'vitest';
import { makeSource, parseSource, serializeSource } from './source.js';

describe('makeSource', () => {
  it('derives the wire form from the parts', () => {
    expect(makeSource('nick', 'user', 'host').raw).toBe('nick!user@host');
    expect(makeSource('nick', '', 'host').raw).toBe('nick@host');
    expect(makeSource('nick', 'user').raw).toBe('nick!user');
    expect(makeSource('nick').raw).toBe('nick');
  });

  it('produces a source that parses back to the same parts', () => {
    for (const [nick, user, host] of [
      ['nick', 'user', 'host'],
      ['nick', '', 'host'],
      ['nick', 'user', ''],
      ['nick', '', ''],
    ] as const) {
      const built = makeSource(nick, user, host);
      const reparsed = parseSource(built.raw);
      expect(reparsed.nick).toBe(nick);
      expect(reparsed.user).toBe(user);
      expect(reparsed.host).toBe(host);
    }
  });
});

describe('serializeSource', () => {
  it('round-trips every shape the parser produces', () => {
    for (const raw of [
      'coolguy',
      'coolguy!ag@127.0.0.1',
      'coolguy@127.0.0.1',
      'coolguy!ag',
      'irc.example.com',
    ]) {
      expect(serializeSource(parseSource(raw))).toBe(raw);
    }
  });
});

describe('parseSource edge cases', () => {
  it('treats a bang after the at-sign as part of the host', () => {
    const source = parseSource('nick@host!weird');
    expect(source.nick).toBe('nick');
    expect(source.user).toBe('');
    expect(source.host).toBe('host!weird');
  });

  it('handles an empty source without throwing', () => {
    expect(parseSource('')).toEqual({ raw: '', nick: '', user: '', host: '' });
  });

  it('keeps control codes in a host verbatim', () => {
    const source = parseSource('nick!user@net5work.admin');
    expect(source.host).toBe('net5work.admin');
  });
});
