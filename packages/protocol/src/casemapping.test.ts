import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CASEMAPPING,
  TargetMap,
  fold,
  parseCaseMapping,
  sameTarget,
} from './casemapping.js';

describe('parseCaseMapping', () => {
  it.each([
    ['ascii', 'ascii'],
    ['rfc1459', 'rfc1459'],
    ['rfc1459-strict', 'rfc1459-strict'],
    ['RFC1459', 'rfc1459'],
  ] as const)('reads %j as %j', (input, expected) => {
    expect(parseCaseMapping(input)).toBe(expected);
  });

  it('falls back to rfc1459 for an unknown mapping', () => {
    expect(parseCaseMapping('utf8-not-a-thing')).toBe('rfc1459');
    expect(DEFAULT_CASEMAPPING).toBe('rfc1459');
  });
});

describe('fold', () => {
  it('folds ASCII letters under every mapping', () => {
    for (const mapping of ['ascii', 'rfc1459', 'rfc1459-strict'] as const) {
      expect(fold('CoolGuy', mapping)).toBe('coolguy');
    }
  });

  it('leaves the Scandinavian pairs alone under ascii', () => {
    expect(fold('nick[]\\^', 'ascii')).toBe('nick[]\\^');
  });

  it('folds [ ] \\ and ^ under rfc1459', () => {
    expect(fold('nick[]\\^', 'rfc1459')).toBe('nick{}|~');
  });

  it('leaves ^ alone under rfc1459-strict', () => {
    expect(fold('nick[]\\^', 'rfc1459-strict')).toBe('nick{}|^');
  });

  it('does not fold non-ASCII characters', () => {
    // toLowerCase() would turn this into 'straße'-adjacent forms; the
    // server does no such thing.
    expect(fold('NICKÉ', 'rfc1459')).toBe('nickÉ');
    expect(fold('İ', 'ascii')).toBe('İ');
  });

  it('leaves digits and punctuation untouched', () => {
    expect(fold('#Channel-1_2', 'rfc1459')).toBe('#channel-1_2');
  });
});

describe('sameTarget', () => {
  it('matches names differing only by case', () => {
    expect(sameTarget('#Marmotter', '#marmotter', 'ascii')).toBe(true);
  });

  it('distinguishes bracket variants under ascii but not rfc1459', () => {
    expect(sameTarget('nick[]', 'nick{}', 'ascii')).toBe(false);
    expect(sameTarget('nick[]', 'nick{}', 'rfc1459')).toBe(true);
  });
});

describe('TargetMap', () => {
  it('looks up regardless of case', () => {
    const map = new TargetMap<number>('rfc1459');
    map.set('#Marmotter', 1);
    expect(map.get('#marmotter')).toBe(1);
    expect(map.has('#MARMOTTER')).toBe(true);
  });

  it('keeps the display form of the key', () => {
    const map = new TargetMap<number>('ascii');
    map.set('CoolGuy', 1);
    expect(map.displayName('coolguy')).toBe('CoolGuy');
    expect([...map.keys()]).toEqual(['CoolGuy']);
  });

  it('overwrites the display form on re-set', () => {
    const map = new TargetMap<number>('ascii');
    map.set('CoolGuy', 1);
    map.set('coolGUY', 2);
    expect(map.size).toBe(1);
    expect(map.get('CoolGuy')).toBe(2);
    expect(map.displayName('coolguy')).toBe('coolGUY');
  });

  it('deletes and clears by folded key', () => {
    const map = new TargetMap<number>('rfc1459');
    map.set('nick[]', 1);
    expect(map.delete('nick{}')).toBe(true);
    expect(map.size).toBe(0);

    map.set('a', 1);
    map.clear();
    expect(map.size).toBe(0);
  });

  it('iterates as display-name and value pairs', () => {
    const map = new TargetMap<number>('ascii');
    map.set('One', 1).set('Two', 2);
    expect([...map]).toEqual([
      ['One', 1],
      ['Two', 2],
    ]);
    expect([...map.values()]).toEqual([1, 2]);
  });

  it('returns undefined for a missing key', () => {
    const map = new TargetMap<number>('ascii');
    expect(map.get('nope')).toBeUndefined();
    expect(map.displayName('nope')).toBeUndefined();
    expect(map.delete('nope')).toBe(false);
  });
});
