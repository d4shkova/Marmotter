import { makeSource } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import {
  addIgnore,
  completeMask,
  findIgnore,
  hostmaskOf,
  isActive,
  isIgnored,
  matchesMask,
  pruneIgnores,
  removeIgnore,
  suggestMasks,
} from './ignore.js';
import { DEFAULT_IGNORE_SCOPE, type IgnoreRule } from './types.js';

const at = (iso: string) => new Date(iso);
const now = at('2026-08-02T12:00:00.000Z');

const rule = (mask: string, overrides: Partial<IgnoreRule> = {}): IgnoreRule => ({
  mask,
  scope: DEFAULT_IGNORE_SCOPE,
  expiresAt: undefined,
  note: undefined,
  ...overrides,
});

describe('completing a mask', () => {
  it('reads a bare nick as that person anywhere', () => {
    expect(completeMask('tamsin')).toBe('tamsin!*@*');
  });

  it('fills in the nick when only a user and host are given', () => {
    expect(completeMask('~u@host.example')).toBe('*!~u@host.example');
  });

  it('fills in the user when only a host is given', () => {
    expect(completeMask('@host.example')).toBe('*!*@host.example');
  });

  it('fills in the host when only a nick and user are given', () => {
    expect(completeMask('tamsin!~u')).toBe('tamsin!~u@*');
  });

  it('leaves a complete mask alone', () => {
    expect(completeMask('tamsin!~u@host.example')).toBe('tamsin!~u@host.example');
  });

  it('reads an empty mask as everyone, rather than as nothing', () => {
    expect(completeMask('')).toBe('*!*@*');
  });
});

describe('matching', () => {
  it('matches a nick-scoped rule against a full hostmask', () => {
    expect(matchesMask('tamsin', 'tamsin!~u@host.example', 'rfc1459')).toBe(true);
    expect(matchesMask('tamsin', 'jonquil!~u@host.example', 'rfc1459')).toBe(false);
  });

  it('matches a host-scoped rule regardless of nick', () => {
    expect(matchesMask('*!*@host.example', 'anyone!~u@host.example', 'rfc1459')).toBe(true);
  });

  it('honours the network casemapping rather than lowercasing', () => {
    // On rfc1459 `[` and `{` are the same character, so a rule written one way
    // still catches the other. Plain toLowerCase would miss this.
    expect(matchesMask('tamsin[m]', 'Tamsin{m}!~u@host', 'rfc1459')).toBe(true);
    expect(matchesMask('tamsin[m]', 'Tamsin{m}!~u@host', 'ascii')).toBe(false);
  });

  it('treats ? as exactly one character', () => {
    expect(matchesMask('tamsi?', 'tamsin!~u@host', 'ascii')).toBe(true);
    expect(matchesMask('tamsi?', 'tamsinn!~u@host', 'ascii')).toBe(false);
  });

  it('does not let a dot in a hostname act as a wildcard', () => {
    expect(matchesMask('*!*@host.example', 'x!~u@hostXexample', 'ascii')).toBe(false);
  });

  it('does not let regex metacharacters in a mask change its meaning', () => {
    expect(matchesMask('a+b', 'a+b!~u@host', 'ascii')).toBe(true);
    expect(matchesMask('a+b', 'aaab!~u@host', 'ascii')).toBe(false);
    expect(matchesMask('(x)', '(x)!~u@host', 'ascii')).toBe(true);
  });
});

describe('rendering a source as a hostmask', () => {
  it('uses the parts the server gave', () => {
    expect(hostmaskOf(makeSource('tamsin', '~u', 'host.example'))).toBe('tamsin!~u@host.example');
  });

  it('widens a source with no user or host, so a nick rule still catches it', () => {
    const mask = hostmaskOf(makeSource('tamsin'));
    expect(mask).toBe('tamsin!*@*');
    expect(matchesMask('tamsin', mask ?? '', 'ascii')).toBe(true);
    // But a host-scoped rule must not match something with no known host.
    expect(matchesMask('*!*@host.example', mask ?? '', 'ascii')).toBe(false);
  });

  it('has nothing to match against for a server source', () => {
    expect(hostmaskOf(undefined)).toBeUndefined();
    expect(hostmaskOf(makeSource(''))).toBeUndefined();
  });
});

describe('the list', () => {
  it('finds the rule that suppresses something', () => {
    const rules = [rule('*!*@spam.example'), rule('tamsin!*@*')];
    const found = findIgnore(rules, {
      hostmask: 'tamsin!~u@host.example',
      channel: 'messages',
      mapping: 'rfc1459',
      now,
    });
    expect(found?.mask).toBe('tamsin!*@*');
  });

  it('respects the scope, so a mute on chatter does not mute invites', () => {
    const rules = [rule('tamsin!*@*', { scope: { ...DEFAULT_IGNORE_SCOPE, invites: false } })];
    const query = { hostmask: 'tamsin!~u@h', mapping: 'ascii' as const, now };

    expect(isIgnored(rules, { ...query, channel: 'messages' })).toBe(true);
    expect(isIgnored(rules, { ...query, channel: 'invites' })).toBe(false);
  });

  it('leaves joins and parts visible unless the user asks otherwise', () => {
    expect(DEFAULT_IGNORE_SCOPE.events).toBe(false);
  });

  it('adds a rule with the default scope', () => {
    const rules = addIgnore([], 'tamsin', { now });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.mask).toBe('tamsin!*@*');
    expect(rules[0]?.scope).toEqual(DEFAULT_IGNORE_SCOPE);
    expect(rules[0]?.expiresAt).toBeUndefined();
  });

  it('replaces a rule for the same mask rather than stacking one on top', () => {
    const first = addIgnore([], 'tamsin', { now, durationMs: 60_000 });
    const second = addIgnore(first, 'tamsin!*@*', { now });
    expect(second).toHaveLength(1);
    // The second, indefinite rule is the one in force.
    expect(second[0]?.expiresAt).toBeUndefined();
  });

  it('keeps the note the user wrote', () => {
    expect(addIgnore([], 'tamsin', { now, note: 'bot spam' })[0]?.note).toBe('bot spam');
  });

  it('removes by whatever shorthand the user types', () => {
    const rules = addIgnore([], 'tamsin', { now });
    expect(removeIgnore(rules, 'tamsin')).toHaveLength(0);
    expect(removeIgnore(rules, 'tamsin!*@*')).toHaveLength(0);
    expect(removeIgnore(rules, 'jonquil')).toHaveLength(1);
  });
});

describe('expiry', () => {
  it('stops matching once it lapses, without anyone removing it', () => {
    const rules = addIgnore([], 'tamsin', { now, durationMs: 60_000 });
    const query = {
      hostmask: 'tamsin!~u@h',
      channel: 'messages' as const,
      mapping: 'ascii' as const,
    };

    expect(isIgnored(rules, { ...query, now: at('2026-08-02T12:00:30.000Z') })).toBe(true);
    expect(isIgnored(rules, { ...query, now: at('2026-08-02T12:01:30.000Z') })).toBe(false);
  });

  it('lapses exactly at its expiry, not a moment after', () => {
    const lapsing = rule('tamsin!*@*', { expiresAt: now });
    expect(isActive(lapsing, at('2026-08-02T11:59:59.999Z'))).toBe(true);
    expect(isActive(lapsing, now)).toBe(false);
  });

  it('prunes lapsed rules and keeps the rest', () => {
    const rules = [
      rule('a!*@*', { expiresAt: at('2026-08-02T11:00:00.000Z') }),
      rule('b!*@*'),
      rule('c!*@*', { expiresAt: at('2026-08-02T13:00:00.000Z') }),
    ];
    expect(pruneIgnores(rules, now).map((entry) => entry.mask)).toEqual(['b!*@*', 'c!*@*']);
  });

  it('returns the same array when nothing lapsed', () => {
    const rules = [rule('a!*@*')];
    expect(pruneIgnores(rules, now)).toBe(rules);
  });
});

describe('the mask builder', () => {
  it('offers narrowest first', () => {
    expect(suggestMasks(makeSource('tamsin', '~u', 'host.example'))).toEqual([
      'tamsin!~u@host.example',
      'tamsin!*@*',
      '*!~u@host.example',
      '*!*@host.example',
    ]);
  });

  it('does not offer the same mask twice when parts are unknown', () => {
    expect(suggestMasks(makeSource('tamsin'))).toEqual(['tamsin!*@*', '*!*@*']);
  });
});
