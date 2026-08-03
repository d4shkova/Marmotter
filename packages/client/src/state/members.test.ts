import { DEFAULT_ISUPPORT, applyISupport } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import {
  countAway,
  emptyMember,
  getMember,
  removeMember,
  renameMember,
  sortMembers,
  upsertMember,
} from './members.js';
import type { Member } from './types.js';

const support = applyISupport(DEFAULT_ISUPPORT, ['PREFIX=(qaohv)~&@%+', 'CHANTYPES=#']);

const listOf = (...entries: [string, Partial<Member>][]): ReadonlyMap<string, Member> => {
  let members: ReadonlyMap<string, Member> = new Map();
  for (const [nick, update] of entries) {
    members = upsertMember(members, nick, 'rfc1459', update);
  }
  return members;
};

describe('building a member up from several sources', () => {
  it('creates someone the first time they are mentioned', () => {
    const members = upsertMember(new Map(), 'tamsin', 'rfc1459', { prefixes: '@' });
    expect(getMember(members, 'tamsin', 'rfc1459')).toEqual({
      ...emptyMember('tamsin'),
      prefixes: '@',
    });
  });

  it('keeps what an earlier source contributed', () => {
    // NAMES gives the prefix, extended-join the account, WHO the host. None of
    // them may discard the others' work.
    let members = upsertMember(new Map(), 'tamsin', 'rfc1459', { prefixes: '@' });
    members = upsertMember(members, 'tamsin', 'rfc1459', { account: 'tam' });
    members = upsertMember(members, 'tamsin', 'rfc1459', { host: 'host.example' });

    expect(getMember(members, 'tamsin', 'rfc1459')).toMatchObject({
      prefixes: '@',
      account: 'tam',
      host: 'host.example',
    });
  });

  it('finds someone whatever case the server spelled them in', () => {
    const members = listOf(['Tamsin', {}]);
    expect(getMember(members, 'tamsin', 'rfc1459')?.nick).toBe('Tamsin');
    expect(getMember(members, 'TAMSIN', 'rfc1459')?.nick).toBe('Tamsin');
  });

  it('treats rfc1459 bracket characters as the same person', () => {
    const members = upsertMember(new Map(), 'tamsin[m]', 'rfc1459', {});
    expect(getMember(members, 'tamsin{m}', 'rfc1459')?.nick).toBe('tamsin[m]');

    // On a network mapping ascii they are two different people, which is why
    // the mapping is read from ISUPPORT rather than assumed.
    const ascii = upsertMember(new Map(), 'tamsin[m]', 'ascii', {});
    expect(getMember(ascii, 'tamsin{m}', 'ascii')).toBeUndefined();
  });

  it('keeps the spelling already recorded unless a source restates it', () => {
    let members = listOf(['Tamsin', {}]);
    members = upsertMember(members, 'TAMSIN', 'rfc1459', { away: true });
    expect(getMember(members, 'tamsin', 'rfc1459')?.nick).toBe('Tamsin');
  });

  it('does not change the original map', () => {
    const original = listOf(['tamsin', {}]);
    upsertMember(original, 'jonquil', 'rfc1459', {});
    expect(original.size).toBe(1);
  });
});

describe('removing', () => {
  it('drops someone by any spelling of their nick', () => {
    const members = removeMember(listOf(['Tamsin', {}]), 'tamsin', 'rfc1459');
    expect(members.size).toBe(0);
  });

  it('returns the same map when there is nobody to remove', () => {
    const members = listOf(['tamsin', {}]);
    expect(removeMember(members, 'stranger', 'rfc1459')).toBe(members);
  });
});

describe('renaming', () => {
  it('keeps everything about the person, changing only their name', () => {
    const members = renameMember(
      listOf(['tamsin', { prefixes: '@', account: 'tam', away: true, host: 'h' }]),
      'tamsin',
      'tamsin2',
      'rfc1459',
    );

    expect(getMember(members, 'tamsin', 'rfc1459')).toBeUndefined();
    expect(getMember(members, 'tamsin2', 'rfc1459')).toMatchObject({
      nick: 'tamsin2',
      prefixes: '@',
      account: 'tam',
      away: true,
      host: 'h',
    });
  });

  it('returns the same map for somebody who is not here', () => {
    const members = listOf(['tamsin', {}]);
    expect(renameMember(members, 'stranger', 'other', 'rfc1459')).toBe(members);
  });

  it('handles a rename that only changes case', () => {
    const members = renameMember(listOf(['tamsin', {}]), 'tamsin', 'Tamsin', 'rfc1459');
    expect(members.size).toBe(1);
    expect(getMember(members, 'tamsin', 'rfc1459')?.nick).toBe('Tamsin');
  });
});

describe('sorting for display', () => {
  it('ranks by the order PREFIX advertises, not by a hardcoded @%+', () => {
    const members = listOf(
      ['voiced', { prefixes: '+' }],
      ['plain', {}],
      ['owner', { prefixes: '~' }],
      ['op', { prefixes: '@' }],
      ['halfop', { prefixes: '%' }],
      ['admin', { prefixes: '&' }],
    );

    expect(sortMembers(members, support).map((member) => member.nick)).toEqual([
      'owner',
      'admin',
      'op',
      'halfop',
      'voiced',
      'plain',
    ]);
  });

  it('ranks by the highest prefix a person holds', () => {
    const members = listOf(['multi', { prefixes: '@+' }], ['op', { prefixes: '@' }]);
    // multi-prefix lists them most privileged first, so the first is the rank.
    expect(sortMembers(members, support).map((member) => member.nick)).toEqual(['multi', 'op']);
  });

  it('sorts equals by nick, ignoring case', () => {
    const members = listOf(['Zoe', {}], ['adam', {}], ['Bea', {}]);
    expect(sortMembers(members, support).map((member) => member.nick)).toEqual([
      'adam',
      'Bea',
      'Zoe',
    ]);
  });

  it('puts a prefix the network never advertised below everyone', () => {
    const members = listOf(['odd', { prefixes: '!' }], ['plain', {}]);
    const sorted = sortMembers(members, support).map((member) => member.nick);
    // Both are unranked, so they fall back to nick order rather than to chance.
    expect(sorted).toEqual(['odd', 'plain']);
  });

  it('sorts an empty list to nothing', () => {
    expect(sortMembers(new Map(), support)).toEqual([]);
  });
});

describe('counting', () => {
  it('counts who is away', () => {
    const members = listOf(['a', { away: true }], ['b', {}], ['c', { away: true }]);
    expect(countAway(members)).toBe(2);
  });

  it('counts nobody in an empty channel', () => {
    expect(countAway(new Map())).toBe(0);
  });
});
