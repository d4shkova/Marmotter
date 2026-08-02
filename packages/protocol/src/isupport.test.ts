import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ISUPPORT,
  applyISupport,
  isChannel,
  modeForPrefix,
  parseChanModes,
  parsePrefix,
  prefixForMode,
  prefixRank,
  splitPrefixes,
  unescapeISupportValue,
} from './isupport.js';

const apply = (...tokens: string[]) => applyISupport(DEFAULT_ISUPPORT, tokens);

describe('defaults', () => {
  it('behaves like a pre-ISUPPORT server when nothing is advertised', () => {
    expect(DEFAULT_ISUPPORT.chanTypes).toBe('#&');
    expect(DEFAULT_ISUPPORT.caseMapping).toBe('rfc1459');
    expect(DEFAULT_ISUPPORT.prefixes).toEqual([
      { mode: 'o', prefix: '@' },
      { mode: 'v', prefix: '+' },
    ]);
    expect(DEFAULT_ISUPPORT.modesPerCommand).toBe(3);
  });
});

describe('parsePrefix', () => {
  it('pairs mode letters with prefix characters in order', () => {
    expect(parsePrefix('(qaohv)~&@%+')).toEqual([
      { mode: 'q', prefix: '~' },
      { mode: 'a', prefix: '&' },
      { mode: 'o', prefix: '@' },
      { mode: 'h', prefix: '%' },
      { mode: 'v', prefix: '+' },
    ]);
  });

  it('accepts an explicitly empty prefix set', () => {
    expect(parsePrefix('()')).toEqual([]);
  });

  it('returns nothing for a malformed value rather than throwing', () => {
    expect(parsePrefix('ohv@%+')).toEqual([]);
    expect(parsePrefix('')).toEqual([]);
  });

  it('ignores mode letters with no matching prefix character', () => {
    expect(parsePrefix('(ohv)@')).toEqual([{ mode: 'o', prefix: '@' }]);
  });
});

describe('parseChanModes', () => {
  it('splits the four positional groups', () => {
    expect(parseChanModes('beI,k,l,imnpstn')).toEqual({
      list: 'beI',
      parameter: 'k',
      parameterWhenSet: 'l',
      flag: 'imnpstn',
    });
  });

  it('treats missing groups as empty', () => {
    expect(parseChanModes('b,k')).toEqual({
      list: 'b',
      parameter: 'k',
      parameterWhenSet: '',
      flag: '',
    });
  });
});

describe('unescapeISupportValue', () => {
  it('decodes hex escapes', () => {
    expect(unescapeISupportValue('a\\x20b')).toBe('a b');
    expect(unescapeISupportValue('\\x5C')).toBe('\\');
  });

  it('leaves values without escapes untouched', () => {
    expect(unescapeISupportValue('plain')).toBe('plain');
  });
});

describe('applyISupport', () => {
  it('records every token in raw form for the raw log', () => {
    const support = apply('NETWORK=Libera.Chat', 'SAFELIST', 'NICKLEN=16');
    expect(support.raw.get('NETWORK')).toBe('Libera.Chat');
    expect(support.raw.get('SAFELIST')).toBe('');
    expect(support.raw.get('NICKLEN')).toBe('16');
  });

  it('parses the tokens CLAUDE.md calls out', () => {
    const support = apply(
      'PREFIX=(qaohv)~&@%+',
      'CHANMODES=beI,k,fl,CPRSTcgimnprstuz',
      'CHANTYPES=#',
      'CASEMAPPING=ascii',
      'TARGMAX=PRIVMSG:4,NOTICE:4,JOIN:,KICK:1',
      'NETWORK=Libera.Chat',
      'CHANLIMIT=#:250',
      'MAXLIST=bqeI:100',
      'MODES=4',
      'STATUSMSG=@+',
      'MONITOR=100',
      'WHOX',
      'UTF8ONLY',
    );

    expect(support.prefixes.map((p) => p.prefix).join('')).toBe('~&@%+');
    expect(support.chanModes.list).toBe('beI');
    expect(support.chanModes.parameterWhenSet).toBe('fl');
    expect(support.chanTypes).toBe('#');
    expect(support.caseMapping).toBe('ascii');
    expect(support.network).toBe('Libera.Chat');
    expect(support.modesPerCommand).toBe(4);
    expect(support.statusMsg).toBe('@+');
    expect(support.monitor).toEqual({ supported: true, limit: 100 });
    expect(support.whox).toBe(true);
    expect(support.utf8Only).toBe(true);
  });

  it('reads TARGMAX limits, with an empty limit meaning unlimited', () => {
    const support = apply('TARGMAX=PRIVMSG:4,JOIN:,KICK:1');
    expect(support.targetMax.get('PRIVMSG')).toBe(4);
    expect(support.targetMax.get('KICK')).toBe(1);
    expect(support.targetMax.has('JOIN')).toBe(true);
    expect(support.targetMax.get('JOIN')).toBeUndefined();
  });

  it('expands grouped CHANLIMIT and MAXLIST keys', () => {
    const support = apply('CHANLIMIT=#&:25', 'MAXLIST=beI:100');
    expect(support.chanLimit.get('#')).toBe(25);
    expect(support.chanLimit.get('&')).toBe(25);
    expect(support.maxList.get('b')).toBe(100);
    expect(support.maxList.get('e')).toBe(100);
    expect(support.maxList.get('I')).toBe(100);
  });

  it('accumulates tokens across several 005 lines', () => {
    const first = apply('NETWORK=Libera.Chat', 'CHANTYPES=#');
    const second = applyISupport(first, ['NICKLEN=16']);

    expect(second.network).toBe('Libera.Chat');
    expect(second.chanTypes).toBe('#');
    expect(second.maxNickLength).toBe(16);
  });

  it('resets a negated token to its default', () => {
    const first = apply('CHANTYPES=#', 'WHOX', 'NETWORK=Test');
    const second = applyISupport(first, ['-CHANTYPES', '-WHOX', '-NETWORK']);

    expect(second.chanTypes).toBe('#&');
    expect(second.whox).toBe(false);
    expect(second.network).toBeUndefined();
    expect(second.raw.has('CHANTYPES')).toBe(false);
  });

  it('treats MODES with no value as unlimited', () => {
    expect(apply('MODES').modesPerCommand).toBeUndefined();
  });

  it('defaults EXCEPTS and INVEX mode letters when the value is empty', () => {
    const support = apply('EXCEPTS', 'INVEX');
    expect(support.excepts).toBe('e');
    expect(support.invex).toBe('I');
  });

  it('honours explicit EXCEPTS and INVEX letters', () => {
    const support = apply('EXCEPTS=X', 'INVEX=Y');
    expect(support.excepts).toBe('X');
    expect(support.invex).toBe('Y');
  });

  it('uppercases token names so case does not matter', () => {
    expect(apply('network=Test').network).toBe('Test');
  });

  it('ignores a non-numeric limit rather than producing NaN', () => {
    const support = apply('NICKLEN=lots', 'MONITOR=many');
    expect(support.maxNickLength).toBeUndefined();
    expect(support.monitor).toEqual({ supported: true, limit: undefined });
  });

  it('skips empty tokens', () => {
    expect(apply('', 'NETWORK=Test').network).toBe('Test');
  });
});

describe('helpers', () => {
  const support = apply('PREFIX=(qaohv)~&@%+', 'CHANTYPES=#&');

  it('recognises channels from CHANTYPES', () => {
    expect(isChannel('#marmotter', support)).toBe(true);
    expect(isChannel('&local', support)).toBe(true);
    expect(isChannel('nick', support)).toBe(false);
    expect(isChannel('', support)).toBe(false);
  });

  it('maps between modes and prefixes', () => {
    expect(prefixForMode('o', support)).toBe('@');
    expect(modeForPrefix('%', support)).toBe('h');
    expect(prefixForMode('z', support)).toBeUndefined();
    expect(modeForPrefix('!', support)).toBeUndefined();
  });

  it('ranks prefixes by advertised order, most privileged highest', () => {
    expect(prefixRank('~', support)).toBeGreaterThan(prefixRank('@', support));
    expect(prefixRank('@', support)).toBeGreaterThan(prefixRank('+', support));
    expect(prefixRank('!', support)).toBe(-1);
  });

  it('splits leading status prefixes off a nick', () => {
    expect(splitPrefixes('@+nick', support)).toEqual({ prefixes: '@+', nick: 'nick' });
    expect(splitPrefixes('nick', support)).toEqual({ prefixes: '', nick: 'nick' });
    expect(splitPrefixes('~&@%+nick', support)).toEqual({ prefixes: '~&@%+', nick: 'nick' });
  });

  it('does not strip a prefix the server never advertised', () => {
    const minimal = apply('PREFIX=(o)@');
    expect(splitPrefixes('%nick', minimal)).toEqual({ prefixes: '', nick: '%nick' });
  });
});
