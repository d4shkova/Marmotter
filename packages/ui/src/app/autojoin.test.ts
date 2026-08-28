import { describe, expect, it } from 'vitest';
import type { AutojoinTarget } from '@marmotter/shared';
import { formatAutojoin, isAutojoined, parseAutojoin, toggleAutojoin } from './autojoin.js';

const secret = { kind: 'secret-ref', id: 'key-1' } as const;

describe('reading a typed list of channels', () => {
  it('splits on commas and on whitespace alike', () => {
    expect(parseAutojoin('#one, #two #three')).toEqual([
      { target: '#one' },
      { target: '#two' },
      { target: '#three' },
    ]);
  });

  it('reads an empty line as no channels', () => {
    expect(parseAutojoin('   ')).toEqual([]);
  });

  it('collapses a channel named twice in different cases', () => {
    expect(parseAutojoin('#Marmotter, #marmotter')).toEqual([{ target: '#Marmotter' }]);
  });

  it('keeps the key of a channel that already had one', () => {
    const existing: AutojoinTarget[] = [{ target: '#private', key: secret }];
    // Retyping the name must not drop the password saved against it.
    expect(parseAutojoin('#private, #open', existing)).toEqual([
      { target: '#private', key: secret },
      { target: '#open' },
    ]);
  });

  it('drops a channel taken off the line, key and all', () => {
    const existing: AutojoinTarget[] = [{ target: '#private', key: secret }];
    expect(parseAutojoin('#open', existing)).toEqual([{ target: '#open' }]);
  });

  it('round-trips through the text field', () => {
    const targets = parseAutojoin('#one #two');
    expect(parseAutojoin(formatAutojoin(targets))).toEqual(targets);
  });
});

describe('toggling one channel', () => {
  const list: AutojoinTarget[] = [{ target: '#one' }, { target: '#two' }];

  it('adds a channel at the end', () => {
    expect(toggleAutojoin(list, '#three')).toEqual([
      { target: '#one' },
      { target: '#two' },
      { target: '#three' },
    ]);
  });

  it('takes one off whatever case it is named in', () => {
    expect(toggleAutojoin(list, '#TWO')).toEqual([{ target: '#one' }]);
  });

  it('reports what is on the list, under the network’s casemapping', () => {
    expect(isAutojoined(list, '#ONE')).toBe(true);
    expect(isAutojoined(list, '#nope')).toBe(false);
  });
});
