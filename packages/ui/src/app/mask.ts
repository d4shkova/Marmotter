/**
 * The ban mask builder.
 *
 * CLAUDE.md's abstraction table asks for a ban that offers host, account and
 * nick scope with a preview of the resulting mask. This is that, as pure
 * functions: given somebody and what the network advertises, what could a ban
 * on them mean, and what mask does each meaning produce.
 *
 * Two things are read from the server rather than assumed. `EXTBAN` gives the
 * prefix for an account ban, which is `~` on UnrealIRCd and `$` on solanum — a
 * client that hardcodes one bans the wrong thing on the other. And a network
 * that advertises no extbans is never offered an account ban at all, because
 * offering a control that cannot work is worse than not offering it.
 */

import type { Member } from '@marmotter/client';
import type { ISupport } from '@marmotter/protocol';

export type BanScope = 'nick' | 'host' | 'user-host' | 'domain' | 'account';

export interface BanOption {
  readonly scope: BanScope;
  /** What this ban means, named by who it stops. */
  readonly label: string;
  /** One sentence on how wide it is and how easily it is evaded. */
  readonly description: string;
  readonly mask: string;
}

/**
 * The ban masks that make sense for one person, widest last.
 *
 * Ordered by how easy each is to evade, because that is the decision being
 * made: a nick ban is trivially stepped around and a host ban is not.
 */
export function banOptions(member: Member, support: ISupport): readonly BanOption[] {
  const nick = member.nick;
  // `user` and `host` are empty until `extended-join` or a `WHO` fills them in.
  // Until then the only honest option is the name, because a mask built from a
  // blank host would read `*!*@` and ban nothing at all.
  const user = member.user === '' ? '*' : member.user;
  const host = member.host;
  const options: BanOption[] = [
    {
      scope: 'nick',
      label: 'Just this name',
      description: 'Stops this name only. Changing name steps around it.',
      mask: `${nick}!*@*`,
    },
  ];

  if (host !== '' && host !== '*') {
    options.push({
      scope: 'user-host',
      label: 'This account on this address',
      description: 'Stops this login from this address. A different login on it still gets in.',
      mask: `*!${user}@${host}`,
    });
    options.push({
      scope: 'host',
      label: 'Anyone from this address',
      description: 'Stops everybody connecting from this address, not only this person.',
      mask: `*!*@${host}`,
    });

    const wider = widenHost(host);
    if (wider !== undefined) {
      options.push({
        scope: 'domain',
        label: 'Anyone from this provider',
        description: `Stops everybody whose address ends in ${wider}. This is wide — check who it would affect.`,
        mask: `*!*@${wider}`,
      });
    }
  }

  // Account bans need the network to say how it spells one. Where it does, this
  // is the option to reach for: an account follows the person across addresses,
  // so it is the only one a determined evader cannot simply reconnect around.
  const account = member.account;
  if (account !== undefined && account !== '' && support.extban !== undefined) {
    if (support.extban.types.includes('a')) {
      options.push({
        scope: 'account',
        label: 'Their network account',
        description: 'Stops this account wherever they connect from. The hardest to step around.',
        mask: `${support.extban.prefix}a:${account}`,
      });
    }
  }

  return options;
}

/**
 * A host with its most specific part replaced by a wildcard, or undefined.
 *
 * Returns nothing where widening would produce something meaningless or far too
 * broad — a bare `*`, a bare TLD, or the top of a cloak.
 */
export function widenHost(host: string): string | undefined {
  // A cloak — `libera/staff/tamsin`, `user/marmot` — is a network's own naming,
  // and its parts read left to right from general to specific. So the widening
  // is the opposite direction from a DNS name.
  if (host.includes('/')) {
    const parts = host.split('/');
    return parts.length < 2 ? undefined : `${parts.slice(0, -1).join('/')}/*`;
  }

  // An IPv4 address widens to its /24, which is the only cut that is
  // conventionally meaningful. IPv6 is left alone: guessing a prefix length
  // from text is how a client bans half a country by accident.
  const ipv4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(host);
  if (ipv4 !== null) {
    return `${ipv4[1] ?? ''}.*`;
  }
  if (host.includes(':')) {
    return undefined;
  }

  const labels = host.split('.');
  return labels.length < 3 ? undefined : `*.${labels.slice(1).join('.')}`;
}

/**
 * Whether a hostmask matches a mask.
 *
 * Used only to preview who a ban would affect before it is sent — the server
 * does the real matching. `*` and `?` are the wildcards IRC uses, and matching
 * is case-insensitive because hostnames are.
 */
export function matchesMask(hostmask: string, mask: string): boolean {
  const pattern = mask
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`, 'i').test(hostmask);
}

/** `nick!user@host` for a member, with `*` where the server has not said. */
export function hostmaskOf(member: Member): string {
  return `${member.nick}!${member.user === '' ? '*' : member.user}@${
    member.host === '' ? '*' : member.host
  }`;
}

/**
 * Members a mask would catch.
 *
 * An extban is not a hostmask and cannot be previewed this way, so an account
 * ban reports only the person it names rather than pretending to know more.
 */
export function membersMatching(
  mask: string,
  members: Iterable<Member>,
  support: ISupport,
): readonly Member[] {
  const prefix = support.extban?.prefix;
  if (prefix !== undefined && prefix !== '' && mask.startsWith(prefix)) {
    const account = mask.slice(mask.indexOf(':') + 1);
    return [...members].filter((member) => member.account === account);
  }
  return [...members].filter((member) => matchesMask(hostmaskOf(member), mask));
}
