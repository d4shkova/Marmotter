import type { Member } from '@marmotter/client';
import { DEFAULT_ISUPPORT, applyISupport } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import { banOptions, matchesMask, membersMatching, widenHost } from './mask.js';

const member = (overrides: Partial<Member> = {}): Member => ({
  nick: 'corvid',
  user: '~c',
  host: 'pool-31.isp.example',
  account: undefined,
  realname: 'corvid',
  away: false,
  bot: false,
  prefixes: '',
  ...overrides,
});

const withTokens = (...tokens: string[]) => applyISupport(DEFAULT_ISUPPORT, tokens);

const maskFor = (scope: string, support = DEFAULT_ISUPPORT, who = member()) =>
  banOptions(who, support).find((option) => option.scope === scope)?.mask;

describe('the ban mask builder', () => {
  it('offers name, login and address scope, widest last', () => {
    const scopes = banOptions(member(), DEFAULT_ISUPPORT).map((option) => option.scope);
    expect(scopes.slice(0, 3)).toEqual(['nick', 'user-host', 'host']);
  });

  it('builds the mask each scope means', () => {
    expect(maskFor('nick')).toBe('corvid!*@*');
    expect(maskFor('user-host')).toBe('*!~c@pool-31.isp.example');
    expect(maskFor('host')).toBe('*!*@pool-31.isp.example');
    expect(maskFor('domain')).toBe('*!*@*.isp.example');
  });

  // The prefix differs by ircd — `~` on UnrealIRCd, `$` on solanum — so a
  // hardcoded one bans nothing on half the networks in existence.
  it('takes the account-ban prefix from what the network advertises', () => {
    const who = member({ account: 'corvid_acct' });
    expect(maskFor('account', withTokens('EXTBAN=$,ajrx'), who)).toBe('$a:corvid_acct');
    expect(maskFor('account', withTokens('EXTBAN=~,aqc'), who)).toBe('~a:corvid_acct');
  });

  it('never offers an account ban a network cannot enforce', () => {
    const who = member({ account: 'corvid_acct' });
    expect(maskFor('account', DEFAULT_ISUPPORT, who)).toBeUndefined();
    expect(maskFor('account', withTokens('EXTBAN=$,jrx'), who)).toBeUndefined();
  });

  it('offers no account ban for somebody who is not logged in', () => {
    expect(maskFor('account', withTokens('EXTBAN=$,ajrx'))).toBeUndefined();
  });

  // A member seen only in a NAMES burst has no host yet. A mask built from a
  // blank one would read `*!*@` and ban nobody, so only the name is offered.
  it('offers only the name when the server has not said where they are', () => {
    const scopes = banOptions(member({ host: '', user: '' }), DEFAULT_ISUPPORT).map(
      (option) => option.scope,
    );
    expect(scopes).toEqual(['nick']);
  });
});

describe('widening a host', () => {
  it('drops the most specific label of a domain name', () => {
    expect(widenHost('pool-31.isp.example')).toBe('*.isp.example');
  });

  // A cloak reads left to right from general to specific, which is the
  // opposite of a DNS name — widening the wrong end would ban the network's
  // whole staff instead of one project.
  it('widens a cloak from the right, not the left', () => {
    expect(widenHost('libera/staff/tamsin')).toBe('libera/staff/*');
    expect(widenHost('user/marmot')).toBe('user/*');
  });

  it('widens an IPv4 address to its /24 and no further', () => {
    expect(widenHost('198.51.100.7')).toBe('198.51.100.*');
  });

  // Guessing a prefix length from IPv6 text is how a client bans a continent.
  it('refuses to guess at IPv6', () => {
    expect(widenHost('2001:db8::1')).toBeUndefined();
  });

  it('refuses to widen into a bare domain or a bare wildcard', () => {
    expect(widenHost('isp.example')).toBeUndefined();
    expect(widenHost('localhost')).toBeUndefined();
  });
});

describe('previewing who a mask catches', () => {
  it('matches the IRC wildcards, case-insensitively', () => {
    expect(matchesMask('corvid!~c@pool-31.isp.example', '*!*@*.isp.example')).toBe(true);
    expect(matchesMask('CORVID!~c@host.example', 'corvid!*@*')).toBe(true);
    expect(matchesMask('jonquil!~j@host.example', 'corvid!*@*')).toBe(false);
  });

  it('does not treat a dot in the mask as a wildcard', () => {
    expect(matchesMask('corvid!~c@poolXisp.example', '*!*@pool.isp.example')).toBe(false);
  });

  it('resolves an account ban against accounts rather than hostmasks', () => {
    const support = withTokens('EXTBAN=$,ajrx');
    const members = [member({ account: 'corvid_acct' }), member({ nick: 'jonquil' })];
    expect(membersMatching('$a:corvid_acct', members, support).map((entry) => entry.nick)).toEqual([
      'corvid',
    ]);
  });
});
