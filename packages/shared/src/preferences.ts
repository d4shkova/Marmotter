/**
 * What the user tells Marmotter once, rather than once per network.
 *
 * mIRC and every client since asks for a name and a couple of fallbacks at the
 * start and then stops asking. Marmotter did not, so adding a third network
 * meant typing the same nick a third time. This is that answer, kept where the
 * "Add a network" form can read it.
 *
 * Deliberately not a secret store. A nick, a real name and an email address are
 * things IRC broadcasts to anyone who asks — `WHOIS` returns the real name to
 * strangers — so they are ordinary settings. Passwords are not here and must
 * not be: they go to the platform keychain through a `SecretRef`.
 */

import type { Identity, NetworkProfile } from './profile.js';

/** The identity a new network starts from. */
export interface DefaultIdentity {
  readonly nick: string;
  /** The name tried when the first is taken, and the one after that. */
  readonly altNick: string;
  readonly thirdNick: string;
  /**
   * The real name, sent at registration and returned by `WHOIS`.
   *
   * Optional, and the form says who can see it. Every network shows this to
   * anybody who asks, which is not obvious from the words "full name".
   */
  readonly realname: string;
  /**
   * An email address, for services registration.
   *
   * Optional. Not sent at connection — nothing in the IRC protocol carries it.
   * It is filled into the NickServ registration form so somebody registering an
   * account is not typing it again.
   */
  readonly email: string;
}

export const EMPTY_IDENTITY: DefaultIdentity = {
  nick: '',
  altNick: '',
  thirdNick: '',
  realname: '',
  email: '',
};

/**
 * Settings that outlive a session, where the platform has somewhere to keep
 * them.
 *
 * Message content is not here and never will be. This is configuration.
 */
export interface StoredPreferences {
  readonly identity: DefaultIdentity;
  /**
   * The networks that have been set up.
   *
   * Restored on the next launch but **not connected**: a client that dials out
   * the moment it opens is one that cannot be started to change a setting, and
   * the same reasoning already applies to adding a network. Each one comes back
   * as a row in the sidebar with Connect on its menu.
   *
   * Carries no password. Profiles hold a `SecretRef`, and the value it stands
   * for lives in the OS keychain.
   */
  readonly networks: readonly NetworkProfile[];
  /**
   * The settings screen's own state — layout, notifications, CTCP, logging.
   *
   * Opaque here on purpose. Some of it is typed in `@marmotter/protocol`, which
   * this package deliberately does not depend on, and the shape belongs to the
   * shell that draws the screen rather than to the profile schema. The shell
   * validates it on the way in; this just carries it.
   */
  readonly settings?: Readonly<Record<string, unknown>>;
}

/**
 * Somewhere to keep settings between launches.
 *
 * Supplied by the platform, like `Transport` and `LogStore`. Desktop passes one
 * backed by a file in the app data directory; **web passes nothing**, and its
 * identity lives in memory for the session — which still saves typing across
 * several networks added in one sitting, without keeping anything after the tab
 * closes.
 */
export interface PreferenceStore {
  load(): Promise<StoredPreferences | undefined>;
  save(preferences: StoredPreferences): Promise<void>;
}

/**
 * Whether a nick is one a server will accept.
 *
 * RFC 2812's grammar, which every ircd is at least as permissive as: a letter
 * or one of the special characters first, then letters, digits, hyphens and
 * specials. Length is left to the network, which advertises its own limit in
 * `NICKLEN` — refusing nine characters here would be this client inventing a
 * rule the network does not have.
 */
const NICK_PATTERN = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]*$/;

export function isValidNick(nick: string): boolean {
  return NICK_PATTERN.test(nick);
}

/** Why a nick was refused, in the interface's voice, or undefined if it is fine. */
export function nickProblem(nick: string): string | undefined {
  if (nick === '') {
    return 'Enter a name.';
  }
  if (/^[0-9-]/.test(nick)) {
    return 'A name cannot start with a number or a hyphen.';
  }
  if (nick.includes(' ')) {
    return 'A name cannot contain spaces.';
  }
  if (!isValidNick(nick)) {
    return 'A name can use letters, numbers, and - [ ] \\ ` _ ^ { | } only.';
  }
  return undefined;
}

/**
 * The fallbacks Marmotter suggests for a nick.
 *
 * The same shape the client has always generated on its own, offered as a
 * starting point rather than imposed — somebody who wants `tamsin_away` as
 * their second choice types it over the suggestion.
 */
export function suggestedAlternates(nick: string): { altNick: string; thirdNick: string } {
  return nick === ''
    ? { altNick: '', thirdNick: '' }
    : { altNick: `${nick}_`, thirdNick: `${nick}__` };
}

/**
 * A network's identity, built from the defaults.
 *
 * `username` is the nick rather than anything the user typed: it is the part
 * before the `@` in a hostmask, most networks replace or prefix it anyway, and
 * asking somebody for a "username" that is neither their account nor their
 * display name is exactly the kind of question this client exists to stop
 * asking. The empty entries are dropped so a profile never carries a blank
 * fallback the server would reject.
 */
export function identityFrom(defaults: DefaultIdentity, nick?: string): Identity {
  const chosen = (nick ?? defaults.nick).trim();
  const alternates = [defaults.altNick, defaults.thirdNick]
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && entry !== chosen);

  return {
    nick: chosen,
    altNicks: alternates.length > 0 ? alternates : [`${chosen}_`, `${chosen}__`],
    username: chosen,
    realname: defaults.realname.trim() === '' ? chosen : defaults.realname.trim(),
  };
}
