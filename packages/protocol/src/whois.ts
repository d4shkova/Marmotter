/**
 * A WHOIS reply, assembled from its numerics into one profile.
 *
 * WHOIS arrives as a run of numerics — 311 for the user, 319 for channels, 317
 * for idle, and so on — terminated by 318. Rendered raw they are a wall of
 * protocol; the interface shows a single profile card instead, per CLAUDE.md's
 * abstraction layer. This module does the assembly, and only the assembly: it is
 * pure functions over the numerics, with no notion of a connection or a store.
 *
 * The reducer holds one profile per nick and folds each numeric in as it
 * arrives, starting a fresh one on 311 (which a server always sends first) so a
 * repeated WHOIS never shows stale fields from the last one.
 */

import {
  RPL_WHOISACCOUNT,
  RPL_WHOISACTUALLY,
  RPL_WHOISBOT,
  RPL_WHOISCHANNELS,
  RPL_WHOISIDLE,
  RPL_WHOISOPERATOR,
  RPL_WHOISSECURE,
  RPL_WHOISSERVER,
  RPL_WHOISUSER,
  RPL_WHOWASUSER,
} from './numerics.js';

export interface WhoisProfile {
  /** As the server spelled it in the reply. */
  readonly nick: string;
  readonly user: string | undefined;
  readonly host: string | undefined;
  readonly realname: string | undefined;
  /** Services account, when the person is logged in. */
  readonly account: string | undefined;
  readonly server: string | undefined;
  readonly serverInfo: string | undefined;
  /**
   * The real host or IP, from RPL_WHOISACTUALLY, where the network reveals it to
   * us. Absent on networks that cloak it or to users who cannot see it.
   */
  readonly actualHost: string | undefined;
  /** Channels they are in, each keeping the status prefix the server sent. */
  readonly channels: readonly string[];
  readonly idleSeconds: number | undefined;
  readonly signonAt: Date | undefined;
  /** Their away message, when they are away. */
  readonly away: string | undefined;
  readonly isOperator: boolean;
  readonly isBot: boolean;
  /** On a TLS connection, per RPL_WHOISSECURE. */
  readonly secure: boolean;
  /** Set once RPL_ENDOFWHOIS marks the reply finished. */
  readonly complete: boolean;
}

export const emptyWhois = (nick: string): WhoisProfile => ({
  nick,
  user: undefined,
  host: undefined,
  realname: undefined,
  account: undefined,
  server: undefined,
  serverInfo: undefined,
  actualHost: undefined,
  channels: [],
  idleSeconds: undefined,
  signonAt: undefined,
  away: undefined,
  isOperator: false,
  isBot: false,
  secure: false,
  complete: false,
});

const toSeconds = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const toDate = (seconds: string | undefined): Date | undefined => {
  if (seconds === undefined || !/^\d+$/.test(seconds)) {
    return undefined;
  }
  const value = Number.parseInt(seconds, 10) * 1000;
  return Number.isSafeInteger(value) ? new Date(value) : undefined;
};

/**
 * Folds one WHOIS numeric into the profile.
 *
 * `params` is the reply's parameters with our own nick already stripped, so
 * `params[0]` is the subject's nick and the fields follow — the same shape the
 * `whois` event from `interpretNumeric` carries. An unrecognised numeric leaves
 * the profile untouched, so a network's extra WHOIS lines are simply ignored
 * rather than mishandled.
 */
export function applyWhoisNumeric(
  profile: WhoisProfile,
  numeric: string,
  params: readonly string[],
): WhoisProfile {
  const rest = params.slice(1);

  switch (numeric) {
    case RPL_WHOISUSER:
    case RPL_WHOWASUSER:
      // <nick> <user> <host> * :<realname>
      return {
        ...profile,
        user: rest[0] ?? profile.user,
        host: rest[1] ?? profile.host,
        realname: rest[3] ?? profile.realname,
      };

    case RPL_WHOISSERVER:
      // <nick> <server> :<server info>
      return {
        ...profile,
        server: rest[0] ?? profile.server,
        serverInfo: rest[1] ?? profile.serverInfo,
      };

    case RPL_WHOISOPERATOR:
      return { ...profile, isOperator: true };

    case RPL_WHOISBOT:
      return { ...profile, isBot: true };

    case RPL_WHOISSECURE:
      return { ...profile, secure: true };

    case RPL_WHOISACCOUNT:
      // <nick> <account> :is logged in as
      return { ...profile, account: rest[0] ?? profile.account };

    case RPL_WHOISACTUALLY:
      // <nick> <host|ip> :actually using host. The exact wording varies by
      // ircd; the first field is the host or IP on the ones that send it.
      return { ...profile, actualHost: rest[0] ?? profile.actualHost };

    case RPL_WHOISIDLE:
      // <nick> <seconds idle> [<signon>] :seconds idle, signon time
      return {
        ...profile,
        idleSeconds: toSeconds(rest[0]) ?? profile.idleSeconds,
        signonAt: toDate(rest[1]) ?? profile.signonAt,
      };

    case RPL_WHOISCHANNELS: {
      // <nick> :[prefix]#chan [prefix]#chan … — one space-separated trailing
      // parameter. Servers may split a long list across several 319 lines, so
      // entries accumulate rather than replace.
      const listed = (rest[0] ?? '').split(/\s+/).filter((entry) => entry !== '');
      return listed.length === 0
        ? profile
        : { ...profile, channels: [...profile.channels, ...listed] };
    }

    default:
      return profile;
  }
}
