import { describe, expect, it } from 'vitest';
import { DEFAULT_ISUPPORT, applyISupport } from './isupport.js';
import {
  EMPTY_CHANNEL_MODES,
  applyChannelModes,
  applyPrefixes,
  applyUserModes,
  classifyChannelMode,
  parseChannelModes,
  parseUserModes,
  prefixesToModes,
  serializeModeChanges,
  takesParameter,
} from './modes.js';

/**
 * BUILD_PLAN lists a `mode-parsing` vector file from ircdocs/parser-tests, but
 * upstream ships no such file — see __fixtures__/parser-tests/README.md. These
 * cases stand in for it, built around a Libera-like ISUPPORT.
 */
const support = applyISupport(DEFAULT_ISUPPORT, [
  'PREFIX=(qaohv)~&@%+',
  'CHANMODES=beI,k,fl,CPRSTcgimnprstuz',
  'MODES=4',
]);

describe('classifyChannelMode', () => {
  it.each([
    ['b', 'list'],
    ['e', 'list'],
    ['I', 'list'],
    ['k', 'parameter'],
    ['l', 'parameter-when-set'],
    ['f', 'parameter-when-set'],
    ['m', 'flag'],
    ['n', 'flag'],
    ['o', 'prefix'],
    ['v', 'prefix'],
    ['q', 'prefix'],
    ['Z', 'unknown'],
  ] as const)('classifies %j as %j', (mode, kind) => {
    expect(classifyChannelMode(mode, support)).toBe(kind);
  });

  it('prefers PREFIX over CHANMODES when a letter appears in both', () => {
    // Some networks list `q` as both a prefix mode and a list mode (quiet).
    const ambiguous = applyISupport(DEFAULT_ISUPPORT, ['PREFIX=(qo)~@', 'CHANMODES=bq,k,l,imnt']);
    expect(classifyChannelMode('q', ambiguous)).toBe('prefix');
  });
});

describe('takesParameter', () => {
  it('takes a parameter for list, parameter, and prefix modes either way', () => {
    for (const kind of ['list', 'parameter', 'prefix'] as const) {
      expect(takesParameter(kind, true)).toBe(true);
      expect(takesParameter(kind, false)).toBe(true);
    }
  });

  it('takes a parameter for type C only when setting', () => {
    expect(takesParameter('parameter-when-set', true)).toBe(true);
    expect(takesParameter('parameter-when-set', false)).toBe(false);
  });

  it('never takes a parameter for flags or unknown modes', () => {
    for (const kind of ['flag', 'unknown'] as const) {
      expect(takesParameter(kind, true)).toBe(false);
      expect(takesParameter(kind, false)).toBe(false);
    }
  });
});

describe('parseChannelModes', () => {
  it('handles the compound case from BUILD_PLAN', () => {
    const result = parseChannelModes('+o-v+b', ['nick1', 'nick2', 'mask'], support);

    expect(result.changes).toEqual([
      { add: true, mode: 'o', kind: 'prefix', parameter: 'nick1' },
      { add: false, mode: 'v', kind: 'prefix', parameter: 'nick2' },
      { add: true, mode: 'b', kind: 'list', parameter: 'mask' },
    ]);
    expect(result.truncated).toBe(false);
    expect(result.unused).toEqual([]);
  });

  it('assumes a leading sign of plus when none is given', () => {
    const result = parseChannelModes('mn', [], support);
    expect(result.changes.map((c) => c.add)).toEqual([true, true]);
  });

  it('takes no parameter when unsetting a type C mode', () => {
    const result = parseChannelModes('+l-l', ['50'], support);
    expect(result.changes).toEqual([
      { add: true, mode: 'l', kind: 'parameter-when-set', parameter: '50' },
      { add: false, mode: 'l', kind: 'parameter-when-set', parameter: undefined },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('takes a parameter when unsetting a type B mode', () => {
    const result = parseChannelModes('-k', ['secret'], support);
    expect(result.changes[0]?.parameter).toBe('secret');
  });

  it('assumes an unadvertised mode is parameterless so later modes stay aligned', () => {
    const result = parseChannelModes('+Zo', ['nick1'], support);
    expect(result.changes).toEqual([
      { add: true, mode: 'Z', kind: 'unknown', parameter: undefined },
      { add: true, mode: 'o', kind: 'prefix', parameter: 'nick1' },
    ]);
  });

  it('reports truncation when a parameter is missing', () => {
    const result = parseChannelModes('+oo', ['only-one'], support);
    expect(result.truncated).toBe(true);
    expect(result.changes[1]?.parameter).toBeUndefined();
  });

  it('reports unused parameters', () => {
    const result = parseChannelModes('+m', ['extra'], support);
    expect(result.unused).toEqual(['extra']);
  });

  it('parses a long mixed string in order', () => {
    const result = parseChannelModes('+ntkl-b+v', ['key', '42', 'mask', 'nick'], support);
    expect(result.changes.map((c) => `${c.add ? '+' : '-'}${c.mode}=${c.parameter ?? ''}`)).toEqual(
      ['+n=', '+t=', '+k=key', '+l=42', '-b=mask', '+v=nick'],
    );
  });

  it('returns nothing for an empty mode string', () => {
    expect(parseChannelModes('', [], support).changes).toEqual([]);
  });

  it('ignores repeated and trailing signs', () => {
    const result = parseChannelModes('++m--n+', [], support);
    expect(result.changes.map((c) => `${c.add ? '+' : '-'}${c.mode}`)).toEqual(['+m', '-n']);
  });
});

describe('parseUserModes', () => {
  it('parses signs without consuming parameters', () => {
    expect(parseUserModes('+iw-x')).toEqual([
      { add: true, mode: 'i', kind: 'flag', parameter: undefined },
      { add: true, mode: 'w', kind: 'flag', parameter: undefined },
      { add: false, mode: 'x', kind: 'flag', parameter: undefined },
    ]);
  });
});

describe('applyChannelModes', () => {
  it('sets flags and records parameters', () => {
    const state = applyChannelModes(
      EMPTY_CHANNEL_MODES,
      parseChannelModes('+ntkl', ['secret', '50'], support).changes,
    );

    expect([...state.flags].sort()).toEqual(['k', 'l', 'n', 't']);
    expect(state.params.get('k')).toBe('secret');
    expect(state.params.get('l')).toBe('50');
  });

  it('clears a flag and its parameter on removal', () => {
    let state = applyChannelModes(
      EMPTY_CHANNEL_MODES,
      parseChannelModes('+kl', ['secret', '50'], support).changes,
    );
    state = applyChannelModes(state, parseChannelModes('-k-l', ['secret'], support).changes);

    expect(state.flags.has('k')).toBe(false);
    expect(state.params.has('k')).toBe(false);
    expect(state.flags.has('l')).toBe(false);
    expect(state.params.has('l')).toBe(false);
  });

  it('ignores prefix and list modes', () => {
    const state = applyChannelModes(
      EMPTY_CHANNEL_MODES,
      parseChannelModes('+ob', ['nick', 'mask'], support).changes,
    );
    expect(state.flags.size).toBe(0);
    expect(state.params.size).toBe(0);
  });

  it('does not mutate the state it was given', () => {
    const before = applyChannelModes(
      EMPTY_CHANNEL_MODES,
      parseChannelModes('+n', [], support).changes,
    );
    applyChannelModes(before, parseChannelModes('+m', [], support).changes);
    expect([...before.flags]).toEqual(['n']);
  });

  it('replaces the value when a parameterised mode is set again', () => {
    let state = applyChannelModes(
      EMPTY_CHANNEL_MODES,
      parseChannelModes('+l', ['10'], support).changes,
    );
    state = applyChannelModes(state, parseChannelModes('+l', ['20'], support).changes);
    expect(state.params.get('l')).toBe('20');
  });
});

describe('applyUserModes', () => {
  it('adds and removes letters', () => {
    const first = applyUserModes(new Set(), parseUserModes('+iw'));
    expect([...first].sort()).toEqual(['i', 'w']);

    const second = applyUserModes(first, parseUserModes('-i'));
    expect([...second]).toEqual(['w']);
  });
});

describe('applyPrefixes', () => {
  it('adds a prefix for a granted mode', () => {
    const changes = parseChannelModes('+o', ['nick'], support).changes;
    expect(applyPrefixes('', changes, support)).toBe('@');
  });

  it('keeps prefixes ordered by advertised privilege', () => {
    const changes = parseChannelModes('+vo', ['nick', 'nick'], support).changes;
    expect(applyPrefixes('', changes, support)).toBe('@+');
  });

  it('removes a prefix for a revoked mode', () => {
    const changes = parseChannelModes('-o', ['nick'], support).changes;
    expect(applyPrefixes('@+', changes, support)).toBe('+');
  });

  it('ignores non-prefix modes', () => {
    const changes = parseChannelModes('+n', [], support).changes;
    expect(applyPrefixes('@', changes, support)).toBe('@');
  });

  it('ignores a prefix mode the server does not advertise', () => {
    const minimal = applyISupport(DEFAULT_ISUPPORT, ['PREFIX=(o)@', 'CHANMODES=b,k,l,imnt']);
    const changes = [{ add: true, mode: 'h', kind: 'prefix', parameter: 'nick' }] as const;
    expect(applyPrefixes('@', changes, minimal)).toBe('@');
  });
});

describe('prefixesToModes', () => {
  it('maps prefix characters back to mode letters', () => {
    expect(prefixesToModes('@+', support)).toBe('ov');
    expect(prefixesToModes('~&@%+', support)).toBe('qaohv');
  });

  it('drops characters the server never advertised', () => {
    expect(prefixesToModes('@!', support)).toBe('o');
  });
});

describe('serializeModeChanges', () => {
  it('groups consecutive changes under one sign', () => {
    const changes = parseChannelModes('+oo', ['a', 'b'], support).changes;
    expect(serializeModeChanges(changes, support)).toEqual([
      { modeString: '+oo', params: ['a', 'b'] },
    ]);
  });

  it('emits a sign only when it flips', () => {
    const changes = parseChannelModes('+o-v+b', ['a', 'b', 'mask'], support).changes;
    expect(serializeModeChanges(changes, support)).toEqual([
      { modeString: '+o-v+b', params: ['a', 'b', 'mask'] },
    ]);
  });

  it('splits into batches at the MODES limit', () => {
    const changes = parseChannelModes('+ooooo', ['a', 'b', 'c', 'd', 'e'], support).changes;
    const commands = serializeModeChanges(changes, support);

    expect(commands).toEqual([
      { modeString: '+oooo', params: ['a', 'b', 'c', 'd'] },
      { modeString: '+o', params: ['e'] },
    ]);
  });

  it('sends one command when the server advertises no limit', () => {
    const unlimited = applyISupport(DEFAULT_ISUPPORT, [
      'PREFIX=(qaohv)~&@%+',
      'CHANMODES=beI,k,fl,imnt',
      'MODES',
    ]);
    const changes = parseChannelModes('+ooooo', ['a', 'b', 'c', 'd', 'e'], unlimited).changes;
    expect(serializeModeChanges(changes, unlimited)).toHaveLength(1);
  });

  it('round-trips through the parser', () => {
    const original = parseChannelModes('+ntk-b', ['key', 'mask'], support).changes;
    const [command] = serializeModeChanges(original, support);
    expect(command).toBeDefined();
    const reparsed = parseChannelModes(command?.modeString ?? '', command?.params ?? [], support);
    expect(reparsed.changes).toEqual(original);
  });

  it('returns nothing for no changes', () => {
    expect(serializeModeChanges([], support)).toEqual([]);
  });
});
