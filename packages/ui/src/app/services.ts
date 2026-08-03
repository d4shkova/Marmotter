/**
 * Which services package a network runs, and what to say to it.
 *
 * `/msg NickServ REGISTER` is the same idea everywhere and a different command
 * almost everywhere. Atheme, Anope and ergo's built-in services disagree on
 * how to change a password, how to request a cloak, and what their nick service
 * is even called. CLAUDE.md asks for the account panel to translate to whichever
 * one the network runs, detected from version replies, and to degrade
 * gracefully where it cannot tell.
 *
 * Detection is deliberately conservative. Getting it wrong is worse than not
 * knowing: an unrecognised package still gets a working panel with the commands
 * it can be sure of, while a wrong guess sends a command that either fails
 * confusingly or — with a password in it — succeeds at something unintended.
 */

import type { NetworkState } from '@marmotter/client';
import { fold } from '@marmotter/protocol';

export type ServicesPackage = 'atheme' | 'anope' | 'ergo' | 'unknown';

export interface ServicesCommands {
  readonly package: ServicesPackage;
  /** How the package is named to a person, or undefined when unrecognised. */
  readonly name: string | undefined;
  /** The nick service's own name, which is not `NickServ` everywhere. */
  readonly nickServ: string;
  /** The channel service's name. */
  readonly chanServ: string;
  register: (password: string, email: string) => string;
  identify: (account: string, password: string) => string;
  /** Undefined where the package needs the old password and we should say so. */
  changePassword: (current: string, next: string) => string;
  setEmail: (address: string) => string;
  /** Undefined where the network has no cloak service to ask. */
  requestCloak: ((vhost: string) => string) | undefined;
  /** True where the package needs the current password to change it. */
  readonly passwordChangeNeedsCurrent: boolean;
}

/**
 * Which package a network runs, from its services' own version reply.
 *
 * BUILD_PLAN says "detected from version replies", and testing against a real
 * Anope showed why nothing else will do: **nothing a client sees during
 * registration names the services package.** Not the MOTD, not `RPL_MYINFO`,
 * not ISUPPORT. Asking NickServ for its version answers plainly —
 * `Anope-2.0.12 services.example :InspIRCd 3 ...` — and is the one source that
 * works on a network that has never mentioned its services in prose.
 *
 * `probeServices` sends that question; this reads the answer. Where no answer
 * has arrived the fallbacks are tried, because a network that *does* say so in
 * its MOTD should not have to be asked.
 */
export function detectServices(network: NetworkState): ServicesPackage {
  const answered = network.ctcpVersions.get(fold('NickServ', network.support.caseMapping));
  const fromVersion = answered === undefined ? undefined : packageIn(answered);
  if (fromVersion !== undefined) {
    return fromVersion;
  }

  // ergo is its own ircd as well as its own services, and says so in `005`
  // before anybody has spoken — the only signal that arrives that early.
  const raw = [...network.support.raw.keys()].join(' ').toLowerCase();
  if (raw.includes('ergo') || network.serverName.toLowerCase().includes('ergo')) {
    return 'ergo';
  }

  const said = [...network.motd, ...network.serverNotices.map((notice) => notice.text)].join('\n');
  return packageIn(said) ?? 'unknown';
}

/** The package named in a piece of text, if one is. */
function packageIn(text: string): ServicesPackage | undefined {
  const lower = text.toLowerCase();
  if (lower.includes('atheme')) {
    return 'atheme';
  }
  if (lower.includes('anope')) {
    return 'anope';
  }
  if (lower.includes('ergo') || lower.includes('oragono')) {
    return 'ergo';
  }
  return undefined;
}

/**
 * The line that asks the account service what it is.
 *
 * A CTCP to a service is unusual but harmless, and it is answered by every
 * package worth detecting. The panels send it once when they open rather than
 * on connect, so a person who never opens them never asks.
 */
export function probeServices(): string {
  return `PRIVMSG NickServ :\u0001VERSION\u0001`;
}

/** Whether the version answer has already arrived, so nobody asks twice. */
export function servicesProbed(network: NetworkState): boolean {
  return network.ctcpVersions.has(fold('NickServ', network.support.caseMapping));
}

/**
 * The commands for a package.
 *
 * Where a package is unrecognised the commands fall back to the forms Atheme
 * and Anope share, which is what the great majority of networks run — and the
 * panel says it is guessing, so a failure is legible rather than mysterious.
 */
export function servicesCommands(pkg: ServicesPackage): ServicesCommands {
  switch (pkg) {
    case 'ergo':
      return {
        package: pkg,
        name: 'ergo',
        nickServ: 'NickServ',
        chanServ: 'ChanServ',
        register: (password, email) =>
          email === ''
            ? `PRIVMSG NickServ :REGISTER * ${password}`
            : `PRIVMSG NickServ :REGISTER ${email} ${password}`,
        identify: (account, password) => `PRIVMSG NickServ :IDENTIFY ${account} ${password}`,
        // ergo's own command takes the current password first, which is why the
        // panel asks for it on this network and not on the others.
        changePassword: (current, next) => `PRIVMSG NickServ :PASSWD ${current} ${next}`,
        passwordChangeNeedsCurrent: true,
        setEmail: (address) => `PRIVMSG NickServ :SET EMAIL ${address}`,
        requestCloak: (vhost) => `PRIVMSG HostServ :REQUEST ${vhost}`,
      };

    case 'anope':
      return {
        package: pkg,
        name: 'Anope',
        nickServ: 'NickServ',
        chanServ: 'ChanServ',
        register: (password, email) => `PRIVMSG NickServ :REGISTER ${password} ${email}`.trim(),
        identify: (account, password) => `PRIVMSG NickServ :IDENTIFY ${account} ${password}`,
        changePassword: (_current, next) => `PRIVMSG NickServ :SET PASSWORD ${next}`,
        passwordChangeNeedsCurrent: false,
        setEmail: (address) => `PRIVMSG NickServ :SET EMAIL ${address}`,
        requestCloak: (vhost) => `PRIVMSG HostServ :REQUEST ${vhost}`,
      };

    case 'atheme':
    case 'unknown':
      return {
        package: pkg,
        name: pkg === 'atheme' ? 'Atheme' : undefined,
        nickServ: 'NickServ',
        chanServ: 'ChanServ',
        register: (password, email) => `PRIVMSG NickServ :REGISTER ${password} ${email}`.trim(),
        identify: (account, password) => `PRIVMSG NickServ :IDENTIFY ${account} ${password}`,
        changePassword: (_current, next) => `PRIVMSG NickServ :SET PASSWORD ${next}`,
        passwordChangeNeedsCurrent: false,
        setEmail: (address) => `PRIVMSG NickServ :SET EMAIL ${address}`,
        // Atheme's cloak service is optional and not every network runs it.
        // Offering the request costs nothing and failing tells the user more
        // than hiding the control would.
        requestCloak: (vhost) => `PRIVMSG HostServ :REQUEST ${vhost}`,
      };
  }
}

/**
 * Whether this connection is already authenticated, and how.
 *
 * SASL is preferred everywhere it exists, per CLAUDE.md, so the panel's job on
 * a network that has it is to say so rather than to offer a second way of doing
 * the same thing worse.
 */
export function accountStatus(network: NetworkState): {
  readonly signedIn: boolean;
  readonly account: string | undefined;
  readonly saslAvailable: boolean;
} {
  return {
    signedIn: network.account !== undefined && network.account !== '',
    account: network.account,
    saslAvailable: network.caps.available.has('sasl'),
  };
}
