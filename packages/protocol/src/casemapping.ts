/**
 * Casemapping.
 *
 * Nick and channel comparison is case-insensitive, but *which* characters count
 * as equivalent is decided by the network via the `CASEMAPPING` token in
 * ISUPPORT. Under `rfc1459`, `[`, `]`, `\` and `~` are the uppercase forms of
 * `{`, `}`, `|` and `^`, because those pairs were considered case variants in
 * Scandinavian character sets.
 *
 * Getting this wrong means treating `nick[]` and `nick{}` as two people on some
 * networks and one on others, so every comparison and every map key in Marmotter
 * goes through this module. `toLowerCase()` is never correct here: it would also
 * fold non-ASCII characters the server does not fold.
 */

export type CaseMapping = 'ascii' | 'rfc1459' | 'rfc1459-strict';

export const DEFAULT_CASEMAPPING: CaseMapping = 'rfc1459';

const KNOWN: readonly CaseMapping[] = ['ascii', 'rfc1459', 'rfc1459-strict'];

/**
 * Interprets a `CASEMAPPING` token value.
 *
 * An unrecognised value falls back to `rfc1459`, which is what the token
 * defaults to when a server omits it entirely.
 */
export function parseCaseMapping(value: string): CaseMapping {
  const lowered = foldAscii(value);
  return KNOWN.includes(lowered as CaseMapping) ? (lowered as CaseMapping) : DEFAULT_CASEMAPPING;
}

/** Folds ASCII `A`–`Z` only. */
function foldAscii(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : value[i];
  }
  return out;
}

/**
 * Folds a nick or channel name to its canonical comparison form.
 *
 * The result is only meaningful as a map key or for equality against another
 * folded string. It is never displayed: the user sees the name as the server
 * sent it.
 */
export function fold(value: string, mapping: CaseMapping): string {
  if (mapping === 'ascii') {
    return foldAscii(value);
  }

  // `rfc1459` folds `[]\^` onto `{}|~`; `rfc1459-strict` leaves `^`/`~` alone.
  const extra = mapping === 'rfc1459' ? 0x5e : 0x5d;

  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCharCode(code + 0x20);
    } else if (code >= 0x5b && code <= extra) {
      out += String.fromCharCode(code + 0x20);
    } else {
      out += value[i];
    }
  }
  return out;
}

/** Whether two names refer to the same target under the given mapping. */
export function sameTarget(a: string, b: string, mapping: CaseMapping): boolean {
  return fold(a, mapping) === fold(b, mapping);
}

/**
 * A Map keyed by folded target name, preserving the display form of each key.
 *
 * Channel and member collections use this so lookups are correct under the
 * network's casemapping while the original spelling survives for the interface.
 */
export class TargetMap<V> {
  private readonly entries = new Map<string, { display: string; value: V }>();

  constructor(private readonly mapping: CaseMapping) {}

  get size(): number {
    return this.entries.size;
  }

  set(name: string, value: V): this {
    this.entries.set(fold(name, this.mapping), { display: name, value });
    return this;
  }

  get(name: string): V | undefined {
    return this.entries.get(fold(name, this.mapping))?.value;
  }

  has(name: string): boolean {
    return this.entries.has(fold(name, this.mapping));
  }

  delete(name: string): boolean {
    return this.entries.delete(fold(name, this.mapping));
  }

  clear(): void {
    this.entries.clear();
  }

  /** The name as it was last written, not the folded key. */
  displayName(name: string): string | undefined {
    return this.entries.get(fold(name, this.mapping))?.display;
  }

  *[Symbol.iterator](): IterableIterator<[string, V]> {
    for (const { display, value } of this.entries.values()) {
      yield [display, value];
    }
  }

  values(): IterableIterator<V> {
    const iterator = this.entries.values();
    return (function* () {
      for (const entry of iterator) {
        yield entry.value;
      }
    })();
  }

  keys(): IterableIterator<string> {
    const iterator = this.entries.values();
    return (function* () {
      for (const entry of iterator) {
        yield entry.display;
      }
    })();
  }
}
