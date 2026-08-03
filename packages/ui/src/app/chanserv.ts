/**
 * Who is allowed to do what in a channel, across three services packages that
 * disagree about what that question even means.
 *
 * Atheme models channel access as **capabilities**: a person holds a set of
 * flags, and each flag permits one thing. Anope and ergo model it as **levels**
 * or **roles**: a person is a VOP, an AOP, an operator. CLAUDE.md asks for a
 * grid of members against capabilities — which is the right shape for Atheme
 * and a lie on the other two, because a grid of checkboxes silently rounded to
 * the nearest role would throw away choices the person made.
 *
 * So the shape follows the network. On Atheme this is a grid; elsewhere it is a
 * role per person, which is what those packages actually store. Both are the
 * same panel and the same commands underneath.
 */

import type { ServicesPackage } from './services.js';

export type AccessModel = 'flags' | 'roles' | 'unsupported';

/** One column of the Atheme grid: a flag letter and what it lets somebody do. */
export interface Capability {
  readonly flag: string;
  readonly label: string;
  readonly detail: string;
}

/**
 * The capabilities worth a column, in the order they escalate.
 *
 * Not every Atheme flag: `+A` (view the list) and the auto- variants are real
 * but belong to a level of detail nobody reaches for from a grid, and adding
 * twelve columns makes the eight useful ones harder to read. Anything not here
 * is still reachable through the command bar, and the panel says so.
 */
export const CAPABILITIES: readonly Capability[] = [
  { flag: 'v', label: 'Speak when moderated', detail: 'Can be given voice, and take it back.' },
  { flag: 'V', label: 'Voiced on arrival', detail: 'Gets voice automatically on joining.' },
  { flag: 'o', label: 'Run the channel', detail: 'Can be given operator, and take it back.' },
  { flag: 'O', label: 'Operator on arrival', detail: 'Gets operator automatically on joining.' },
  { flag: 't', label: 'Change the topic', detail: 'Can set the topic through the service.' },
  { flag: 'i', label: 'Invite people', detail: 'Can invite somebody into a closed channel.' },
  { flag: 'r', label: 'Remove people', detail: 'Can remove somebody from the channel.' },
  { flag: 'b', label: 'Ban people', detail: 'Can add and remove bans through the service.' },
  { flag: 's', label: 'Change settings', detail: 'Can change what the service remembers.' },
  { flag: 'f', label: 'Change who can do what', detail: 'Can grant and revoke these permissions.' },
];

/** Roles, for the packages that store one instead of a set of flags. */
export interface Role {
  readonly value: string;
  readonly label: string;
  readonly detail: string;
}

export const ANOPE_ROLES: readonly Role[] = [
  { value: 'VOP', label: 'Voiced', detail: 'Speaks when the channel is moderated.' },
  { value: 'HOP', label: 'Half-op', detail: 'Can remove people and set the topic.' },
  { value: 'AOP', label: 'Operator', detail: 'Runs the channel day to day.' },
  { value: 'SOP', label: 'Senior operator', detail: 'Can also change who else can do what.' },
];

export const ERGO_ROLES: readonly Role[] = [
  { value: '+v', label: 'Voiced', detail: 'Speaks when the channel is moderated.' },
  { value: '+h', label: 'Half-op', detail: 'Can remove people and set the topic.' },
  { value: '+o', label: 'Operator', detail: 'Runs the channel day to day.' },
  { value: '+a', label: 'Admin', detail: 'Can also change who else can do what.' },
];

/** One person's access, as the panel holds it. */
export interface AccessEntry {
  /** Account or mask, as the service spells it. */
  readonly target: string;
  /** Atheme only: the flags they hold, without the leading sign. */
  readonly flags: string;
  /** Elsewhere: the role or level, as the service reported it. */
  readonly role: string;
  /** True where the service marked them as the channel's owner. */
  readonly founder: boolean;
}

export interface AccessCommands {
  readonly model: AccessModel;
  /** Asks the service for the current list. */
  list: (channel: string) => string;
  /** Grants and revokes in one change, for the grid. */
  setFlags: (channel: string, target: string, add: string, remove: string) => string;
  /** Sets somebody's role, for the packages that have them. */
  setRole: (channel: string, target: string, role: string) => string;
  /** Removes somebody's access entirely. */
  remove: (channel: string, target: string) => string;
  readonly roles: readonly Role[];
}

export function accessCommands(pkg: ServicesPackage): AccessCommands {
  switch (pkg) {
    case 'anope':
      return {
        model: 'roles',
        list: (channel) => `PRIVMSG ChanServ :ACCESS ${channel} LIST`,
        setFlags: (channel, target) => `PRIVMSG ChanServ :ACCESS ${channel} LIST ${target}`,
        setRole: (channel, target, role) => `PRIVMSG ChanServ :${role} ${channel} ADD ${target}`,
        remove: (channel, target) => `PRIVMSG ChanServ :ACCESS ${channel} DEL ${target}`,
        roles: ANOPE_ROLES,
      };

    case 'ergo':
      return {
        model: 'roles',
        list: (channel) => `PRIVMSG ChanServ :AMODE ${channel}`,
        setFlags: (channel, target) => `PRIVMSG ChanServ :AMODE ${channel} ${target}`,
        setRole: (channel, target, role) => `PRIVMSG ChanServ :AMODE ${channel} ${role} ${target}`,
        remove: (channel, target) => `PRIVMSG ChanServ :AMODE ${channel} -o-h-v ${target}`,
        roles: ERGO_ROLES,
      };

    case 'atheme':
      return {
        model: 'flags',
        list: (channel) => `PRIVMSG ChanServ :FLAGS ${channel}`,
        setFlags: (channel, target, add, remove) =>
          `PRIVMSG ChanServ :FLAGS ${channel} ${target} ${flagChange(add, remove)}`,
        setRole: (channel, target, role) => `PRIVMSG ChanServ :FLAGS ${channel} ${target} ${role}`,
        remove: (channel, target) => `PRIVMSG ChanServ :FLAGS ${channel} ${target} -*`,
        roles: [],
      };

    case 'unknown':
      // Guessing here means sending a command that either fails confusingly or
      // grants the wrong thing. Neither is worth it: the panel says it cannot
      // tell, and the command bar still works.
      return {
        model: 'unsupported',
        list: (channel) => `PRIVMSG ChanServ :FLAGS ${channel}`,
        setFlags: (channel) => `PRIVMSG ChanServ :FLAGS ${channel}`,
        setRole: (channel) => `PRIVMSG ChanServ :FLAGS ${channel}`,
        remove: (channel) => `PRIVMSG ChanServ :FLAGS ${channel}`,
        roles: [],
      };
  }
}

/** `+ov-b`, or just one side where only one changed. */
export function flagChange(add: string, remove: string): string {
  return `${add === '' ? '' : `+${add}`}${remove === '' ? '' : `-${remove}`}`;
}

/**
 * Reads a services reply into access entries.
 *
 * Deliberately forgiving and deliberately narrow: it matches the two shapes
 * Atheme and Anope actually print and returns nothing for anything else, so a
 * network whose output is unfamiliar shows the reply verbatim rather than a
 * confidently wrong table. Services output is not a protocol and must never be
 * treated as one.
 */
export function parseAccessListing(
  lines: readonly string[],
  model: AccessModel,
): readonly AccessEntry[] {
  const entries: AccessEntry[] = [];

  for (const line of lines) {
    if (model === 'flags') {
      // Atheme: `1     tamsin                 +AFORefiorstv (FOUNDER)`
      const match = /^\s*\d+\s+(\S+)\s+\+(\S+)/.exec(line);
      if (match !== null) {
        const flags = match[2] ?? '';
        entries.push({
          target: match[1] ?? '',
          flags,
          role: '',
          founder: flags.includes('F') || /\(FOUNDER\)/i.test(line),
        });
      }
      continue;
    }

    // Anope: `1     10       tamsin` — the level is a number, and the panel
    // shows the nearest role rather than the raw level, which means nothing.
    const numbered = /^\s*\d+\s+(\d+)\s+(\S+)/.exec(line);
    if (numbered !== null) {
      entries.push({
        target: numbered[2] ?? '',
        flags: '',
        role: roleForLevel(Number.parseInt(numbered[1] ?? '0', 10)),
        founder: Number.parseInt(numbered[1] ?? '0', 10) >= 10_000,
      });
      continue;
    }

    // ergo: `+o  tamsin`
    const moded = /^\s*([+-][a-z]+)\s+(\S+)/.exec(line);
    if (moded !== null) {
      entries.push({ target: moded[2] ?? '', flags: '', role: moded[1] ?? '', founder: false });
    }
  }

  return entries;
}

/**
 * Anope's numeric levels as the role they correspond to by default.
 *
 * The thresholds are Anope's own XOP defaults. A network that has changed them
 * will show a role that is close rather than exact, which is why the panel
 * shows the service's own reply alongside.
 */
export function roleForLevel(level: number): string {
  if (level >= 10) {
    return 'SOP';
  }
  if (level >= 5) {
    return 'AOP';
  }
  if (level >= 4) {
    return 'HOP';
  }
  return 'VOP';
}

/**
 * The flags to add and remove to get from one set to another.
 *
 * Sending the whole desired set would clear flags this panel does not show,
 * which is how a grid quietly strips permissions somebody set with a command.
 * Only the columns that moved are touched.
 */
export function flagDiff(
  current: string,
  desired: ReadonlySet<string>,
): { readonly add: string; readonly remove: string } {
  const held = new Set(current.split(''));
  let add = '';
  let remove = '';

  for (const capability of CAPABILITIES) {
    const wanted = desired.has(capability.flag);
    if (wanted && !held.has(capability.flag)) {
      add += capability.flag;
    } else if (!wanted && held.has(capability.flag)) {
      remove += capability.flag;
    }
  }

  return { add, remove };
}
