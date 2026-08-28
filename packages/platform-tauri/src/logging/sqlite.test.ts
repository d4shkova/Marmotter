import { describe, expect, it } from 'vitest';
import { ftsQuery, whereFor } from './sqlite.js';

/**
 * The two pieces of the SQLite store worth testing without a database.
 *
 * Everything else it does is a statement handed straight to SQLite. These two
 * build strings, and both have a failure mode that is silent: a wrong date
 * bound returns the wrong window without complaining, and an unescaped search
 * term is how a search box becomes an injection.
 */

describe('turning a search box into an FTS query', () => {
  it('requires every word', () => {
    expect(ftsQuery('marmot photo')).toBe('"marmot" AND "photo"');
  });

  it('quotes a term so FTS syntax in it is read as text', () => {
    // FTS5 treats `-`, `*` and `:` as operators. Somebody typing `foo-bar`
    // means the text, and an unquoted term would be parsed as "foo NOT bar".
    expect(ftsQuery('foo-bar')).toBe('"foo-bar"');
    expect(ftsQuery('a*b')).toBe('"a*b"');
    expect(ftsQuery('NEAR')).toBe('"NEAR"');
  });

  it("doubles a term's own quotes rather than letting them close the phrase", () => {
    expect(ftsQuery('say "hello"')).toBe('"say" AND """hello"""');
  });

  it('is empty for an empty search, which the caller reads as "no words"', () => {
    expect(ftsQuery('')).toBe('');
    expect(ftsQuery('   ')).toBe('');
  });
});

describe('narrowing a search', () => {
  it('has no clause at all when nothing is narrowed', () => {
    expect(whereFor({ text: '', limit: 10 })).toEqual({ clause: '', binds: [] });
  });

  it('binds every value rather than writing it into the SQL', () => {
    const { clause, binds } = whereFor({
      text: '',
      limit: 10,
      networkId: "n1'; DROP TABLE messages; --",
      target: '#marmotter',
    });

    expect(clause).toBe('WHERE m.network_id = $1 AND m.target = $2');
    expect(binds).toEqual(["n1'; DROP TABLE messages; --", '#marmotter']);
    expect(clause).not.toContain('DROP');
  });

  it('compares dates as the numbers they are stored as', () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 11, 31);
    const { clause, binds } = whereFor({ text: '', limit: 10, from, to });

    expect(clause).toBe('WHERE m.at_ms >= $1 AND m.at_ms <= $2');
    expect(binds).toEqual([from.getTime(), to.getTime()]);
  });

  it('numbers its placeholders in order as clauses accumulate', () => {
    // An off-by-one here binds a date to the network and silently returns
    // nothing, which looks like "no logs" rather than like a bug.
    const { clause, binds } = whereFor({
      text: '',
      limit: 10,
      networkId: 'n1',
      target: '#a',
      from: new Date(2026, 0, 1),
      to: new Date(2026, 1, 1),
    });

    expect(clause).toBe(
      'WHERE m.network_id = $1 AND m.target = $2 AND m.at_ms >= $3 AND m.at_ms <= $4',
    );
    expect(binds).toHaveLength(4);
  });
});
