/**
 * The numeric reply map.
 *
 * No numeric ever reaches a consumer as a raw string. Every one is either
 * consumed into connection state or turned into a typed event the interface can
 * render, and errors carry plain-English copy with a suggested action, per the
 * interface copy rules in CLAUDE.md.
 */

import { type ISupport, isChannel, splitPrefixes } from './isupport.js';
import type { IrcMessage } from './message.js';

export const RPL_WELCOME = '001';
export const RPL_YOURHOST = '002';
export const RPL_CREATED = '003';
export const RPL_MYINFO = '004';
export const RPL_ISUPPORT = '005';

export const RPL_LUSERCLIENT = '251';
export const RPL_LUSEROP = '252';
export const RPL_LUSERUNKNOWN = '253';
export const RPL_LUSERCHANNELS = '254';
export const RPL_LUSERME = '255';
export const RPL_LOCALUSERS = '265';
export const RPL_GLOBALUSERS = '266';

export const RPL_AWAY = '301';
export const RPL_UNAWAY = '305';
export const RPL_NOWAWAY = '306';

export const RPL_WHOISUSER = '311';
export const RPL_WHOISSERVER = '312';
export const RPL_WHOISOPERATOR = '313';
export const RPL_WHOWASUSER = '314';
export const RPL_ENDOFWHO = '315';
export const RPL_WHOISIDLE = '317';
export const RPL_ENDOFWHOIS = '318';
export const RPL_WHOISCHANNELS = '319';
export const RPL_WHOISACCOUNT = '330';
export const RPL_WHOISACTUALLY = '338';
export const RPL_WHOISSECURE = '671';
export const RPL_WHOISBOT = '335';
export const RPL_ENDOFWHOWAS = '369';

export const RPL_LISTSTART = '321';
export const RPL_LIST = '322';
export const RPL_LISTEND = '323';

export const RPL_CHANNELMODEIS = '324';
export const RPL_CREATIONTIME = '329';
export const RPL_NOTOPIC = '331';
export const RPL_TOPIC = '332';
export const RPL_TOPICWHOTIME = '333';

export const RPL_INVITING = '341';
export const RPL_INVITELIST = '346';
export const RPL_ENDOFINVITELIST = '347';
export const RPL_EXCEPTLIST = '348';
export const RPL_ENDOFEXCEPTLIST = '349';

export const RPL_WHOREPLY = '352';
export const RPL_NAMREPLY = '353';
export const RPL_WHOSPCRPL = '354';
export const RPL_ENDOFNAMES = '366';

export const RPL_BANLIST = '367';
export const RPL_ENDOFBANLIST = '368';

export const RPL_MOTD = '372';
export const RPL_MOTDSTART = '375';
export const RPL_ENDOFMOTD = '376';
export const ERR_NOMOTD = '422';

export const RPL_QUIETLIST = '728';
export const RPL_ENDOFQUIETLIST = '729';

/**
 * WATCH, the older notify mechanism.
 *
 * UnrealIRCd and its relatives offer WATCH where Libera offers MONITOR. The two
 * carry the same information in different shapes, so both reduce to the same
 * `monitor` event and the Friends panel never learns which one it got.
 */
export const RPL_LOGON = '600';
export const RPL_LOGOFF = '601';
export const RPL_WATCHOFF = '602';
export const RPL_WATCHSTAT = '603';
export const RPL_NOWON = '604';
export const RPL_NOWOFF = '605';
export const RPL_WATCHLIST = '606';
export const RPL_ENDOFWATCHLIST = '607';
export const RPL_NOWISAWAY = '609';

export const RPL_MONONLINE = '730';
export const RPL_MONOFFLINE = '731';
export const RPL_MONLIST = '732';
export const RPL_ENDOFMONLIST = '733';
export const ERR_MONLISTFULL = '734';

export const RPL_LOGGEDIN = '900';
export const RPL_LOGGEDOUT = '901';
export const ERR_NICKLOCKED = '902';
export const RPL_SASLSUCCESS = '903';
export const ERR_SASLFAIL = '904';
export const ERR_SASLTOOLONG = '905';
export const ERR_SASLABORTED = '906';
export const ERR_SASLALREADY = '907';
export const RPL_SASLMECHS = '908';

export const ERR_NOSUCHNICK = '401';
export const ERR_NOSUCHSERVER = '402';
export const ERR_NOSUCHCHANNEL = '403';
export const ERR_CANNOTSENDTOCHAN = '404';
export const ERR_TOOMANYCHANNELS = '405';
export const ERR_UNKNOWNCOMMAND = '421';
export const ERR_ERRONEUSNICKNAME = '432';
export const ERR_NICKNAMEINUSE = '433';
export const ERR_NICKCOLLISION = '436';
export const ERR_UNAVAILRESOURCE = '437';
export const ERR_USERNOTINCHANNEL = '441';
export const ERR_NOTONCHANNEL = '442';
export const ERR_USERONCHANNEL = '443';
export const ERR_NEEDMOREPARAMS = '461';
export const ERR_PASSWDMISMATCH = '464';
/**
 * The connection itself was refused, before any channel.
 *
 * `465` is a network-wide ban (a K-line or G-line); `466` is a warning that one
 * is coming. Both carry the server's own explanation as the trailing text, and
 * that explanation is the whole point — "proxy detected", "you are banned" —
 * so it must reach the person rather than being dropped as an unknown numeric.
 */
export const ERR_YOUREBANNEDCREEP = '465';
export const ERR_YOUWILLBEBANNED = '466';
export const ERR_CHANNELISFULL = '471';
export const ERR_UNKNOWNMODE = '472';
export const ERR_INVITEONLYCHAN = '473';
export const ERR_BANNEDFROMCHAN = '474';
export const ERR_BADCHANNELKEY = '475';
export const ERR_BADCHANMASK = '476';
export const ERR_NOCHANMODES = '477';
export const ERR_BANLISTFULL = '478';
export const ERR_CHANOPRIVSNEEDED = '482';
export const ERR_UMODEUNKNOWNFLAG = '501';
export const ERR_USERSDONTMATCH = '502';
export const ERR_NOPRIVILEGES = '481';
export const ERR_RESTRICTED = '484';

/**
 * How a numeric is handled.
 *
 * `state` numerics are folded into connection or channel state and never
 * rendered on their own; `notice` numerics become a server-notice item; `error`
 * numerics get plain-English copy.
 */
export type NumericDisposition = 'state' | 'notice' | 'error';

export type NumericCategory =
  | 'registration'
  | 'server-info'
  | 'names-topic'
  | 'motd'
  | 'whois'
  | 'list'
  | 'channel-list'
  | 'sasl'
  | 'monitor'
  | 'away'
  | 'error'
  | 'other';

export interface NumericInfo {
  readonly name: string;
  readonly category: NumericCategory;
  readonly disposition: NumericDisposition;
}

const info = (
  name: string,
  category: NumericCategory,
  disposition: NumericDisposition,
): NumericInfo => ({ name, category, disposition });

/** Names and handling for every numeric Marmotter recognises. */
export const NUMERICS: ReadonlyMap<string, NumericInfo> = new Map([
  [RPL_WELCOME, info('RPL_WELCOME', 'registration', 'state')],
  [RPL_YOURHOST, info('RPL_YOURHOST', 'registration', 'state')],
  [RPL_CREATED, info('RPL_CREATED', 'registration', 'state')],
  [RPL_MYINFO, info('RPL_MYINFO', 'registration', 'state')],
  [RPL_ISUPPORT, info('RPL_ISUPPORT', 'registration', 'state')],

  [RPL_LUSERCLIENT, info('RPL_LUSERCLIENT', 'server-info', 'state')],
  [RPL_LUSEROP, info('RPL_LUSEROP', 'server-info', 'state')],
  [RPL_LUSERUNKNOWN, info('RPL_LUSERUNKNOWN', 'server-info', 'state')],
  [RPL_LUSERCHANNELS, info('RPL_LUSERCHANNELS', 'server-info', 'state')],
  [RPL_LUSERME, info('RPL_LUSERME', 'server-info', 'state')],
  [RPL_LOCALUSERS, info('RPL_LOCALUSERS', 'server-info', 'state')],
  [RPL_GLOBALUSERS, info('RPL_GLOBALUSERS', 'server-info', 'state')],

  [RPL_AWAY, info('RPL_AWAY', 'away', 'notice')],
  [RPL_UNAWAY, info('RPL_UNAWAY', 'away', 'state')],
  [RPL_NOWAWAY, info('RPL_NOWAWAY', 'away', 'state')],

  [RPL_WHOISUSER, info('RPL_WHOISUSER', 'whois', 'state')],
  [RPL_WHOISSERVER, info('RPL_WHOISSERVER', 'whois', 'state')],
  [RPL_WHOISOPERATOR, info('RPL_WHOISOPERATOR', 'whois', 'state')],
  [RPL_WHOWASUSER, info('RPL_WHOWASUSER', 'whois', 'state')],
  [RPL_WHOISIDLE, info('RPL_WHOISIDLE', 'whois', 'state')],
  [RPL_ENDOFWHOIS, info('RPL_ENDOFWHOIS', 'whois', 'state')],
  [RPL_WHOISCHANNELS, info('RPL_WHOISCHANNELS', 'whois', 'state')],
  [RPL_WHOISACCOUNT, info('RPL_WHOISACCOUNT', 'whois', 'state')],
  [RPL_WHOISACTUALLY, info('RPL_WHOISACTUALLY', 'whois', 'state')],
  [RPL_WHOISBOT, info('RPL_WHOISBOT', 'whois', 'state')],
  [RPL_WHOISSECURE, info('RPL_WHOISSECURE', 'whois', 'state')],
  [RPL_ENDOFWHOWAS, info('RPL_ENDOFWHOWAS', 'whois', 'state')],

  [RPL_LISTSTART, info('RPL_LISTSTART', 'channel-list', 'state')],
  [RPL_LIST, info('RPL_LIST', 'channel-list', 'state')],
  [RPL_LISTEND, info('RPL_LISTEND', 'channel-list', 'state')],

  [RPL_CHANNELMODEIS, info('RPL_CHANNELMODEIS', 'names-topic', 'state')],
  [RPL_CREATIONTIME, info('RPL_CREATIONTIME', 'names-topic', 'state')],
  [RPL_NOTOPIC, info('RPL_NOTOPIC', 'names-topic', 'state')],
  [RPL_TOPIC, info('RPL_TOPIC', 'names-topic', 'state')],
  [RPL_TOPICWHOTIME, info('RPL_TOPICWHOTIME', 'names-topic', 'state')],
  [RPL_NAMREPLY, info('RPL_NAMREPLY', 'names-topic', 'state')],
  [RPL_ENDOFNAMES, info('RPL_ENDOFNAMES', 'names-topic', 'state')],
  [RPL_WHOREPLY, info('RPL_WHOREPLY', 'names-topic', 'state')],
  [RPL_WHOSPCRPL, info('RPL_WHOSPCRPL', 'names-topic', 'state')],
  [RPL_ENDOFWHO, info('RPL_ENDOFWHO', 'names-topic', 'state')],
  [RPL_INVITING, info('RPL_INVITING', 'names-topic', 'notice')],

  [RPL_BANLIST, info('RPL_BANLIST', 'list', 'state')],
  [RPL_ENDOFBANLIST, info('RPL_ENDOFBANLIST', 'list', 'state')],
  [RPL_INVITELIST, info('RPL_INVITELIST', 'list', 'state')],
  [RPL_ENDOFINVITELIST, info('RPL_ENDOFINVITELIST', 'list', 'state')],
  [RPL_EXCEPTLIST, info('RPL_EXCEPTLIST', 'list', 'state')],
  [RPL_ENDOFEXCEPTLIST, info('RPL_ENDOFEXCEPTLIST', 'list', 'state')],
  [RPL_QUIETLIST, info('RPL_QUIETLIST', 'list', 'state')],
  [RPL_ENDOFQUIETLIST, info('RPL_ENDOFQUIETLIST', 'list', 'state')],

  [RPL_MOTDSTART, info('RPL_MOTDSTART', 'motd', 'state')],
  [RPL_MOTD, info('RPL_MOTD', 'motd', 'state')],
  [RPL_ENDOFMOTD, info('RPL_ENDOFMOTD', 'motd', 'state')],
  [ERR_NOMOTD, info('ERR_NOMOTD', 'motd', 'state')],

  [RPL_LOGON, info('RPL_LOGON', 'monitor', 'state')],
  [RPL_LOGOFF, info('RPL_LOGOFF', 'monitor', 'state')],
  [RPL_WATCHOFF, info('RPL_WATCHOFF', 'monitor', 'state')],
  [RPL_WATCHSTAT, info('RPL_WATCHSTAT', 'monitor', 'state')],
  [RPL_NOWON, info('RPL_NOWON', 'monitor', 'state')],
  [RPL_NOWOFF, info('RPL_NOWOFF', 'monitor', 'state')],
  [RPL_WATCHLIST, info('RPL_WATCHLIST', 'monitor', 'state')],
  [RPL_ENDOFWATCHLIST, info('RPL_ENDOFWATCHLIST', 'monitor', 'state')],
  [RPL_NOWISAWAY, info('RPL_NOWISAWAY', 'monitor', 'state')],
  [RPL_MONONLINE, info('RPL_MONONLINE', 'monitor', 'state')],
  [RPL_MONOFFLINE, info('RPL_MONOFFLINE', 'monitor', 'state')],
  [RPL_MONLIST, info('RPL_MONLIST', 'monitor', 'state')],
  [RPL_ENDOFMONLIST, info('RPL_ENDOFMONLIST', 'monitor', 'state')],
  [ERR_MONLISTFULL, info('ERR_MONLISTFULL', 'monitor', 'error')],

  [RPL_LOGGEDIN, info('RPL_LOGGEDIN', 'sasl', 'state')],
  [RPL_LOGGEDOUT, info('RPL_LOGGEDOUT', 'sasl', 'state')],
  [ERR_NICKLOCKED, info('ERR_NICKLOCKED', 'sasl', 'error')],
  [RPL_SASLSUCCESS, info('RPL_SASLSUCCESS', 'sasl', 'state')],
  [ERR_SASLFAIL, info('ERR_SASLFAIL', 'sasl', 'error')],
  [ERR_SASLTOOLONG, info('ERR_SASLTOOLONG', 'sasl', 'error')],
  [ERR_SASLABORTED, info('ERR_SASLABORTED', 'sasl', 'error')],
  [ERR_SASLALREADY, info('ERR_SASLALREADY', 'sasl', 'state')],
  [RPL_SASLMECHS, info('RPL_SASLMECHS', 'sasl', 'state')],

  [ERR_NOSUCHNICK, info('ERR_NOSUCHNICK', 'error', 'error')],
  [ERR_NOSUCHSERVER, info('ERR_NOSUCHSERVER', 'error', 'error')],
  [ERR_NOSUCHCHANNEL, info('ERR_NOSUCHCHANNEL', 'error', 'error')],
  [ERR_CANNOTSENDTOCHAN, info('ERR_CANNOTSENDTOCHAN', 'error', 'error')],
  [ERR_TOOMANYCHANNELS, info('ERR_TOOMANYCHANNELS', 'error', 'error')],
  [ERR_UNKNOWNCOMMAND, info('ERR_UNKNOWNCOMMAND', 'error', 'error')],
  [ERR_ERRONEUSNICKNAME, info('ERR_ERRONEUSNICKNAME', 'error', 'error')],
  [ERR_NICKNAMEINUSE, info('ERR_NICKNAMEINUSE', 'error', 'error')],
  [ERR_NICKCOLLISION, info('ERR_NICKCOLLISION', 'error', 'error')],
  [ERR_UNAVAILRESOURCE, info('ERR_UNAVAILRESOURCE', 'error', 'error')],
  [ERR_USERNOTINCHANNEL, info('ERR_USERNOTINCHANNEL', 'error', 'error')],
  [ERR_NOTONCHANNEL, info('ERR_NOTONCHANNEL', 'error', 'error')],
  [ERR_USERONCHANNEL, info('ERR_USERONCHANNEL', 'error', 'error')],
  [ERR_NEEDMOREPARAMS, info('ERR_NEEDMOREPARAMS', 'error', 'error')],
  [ERR_PASSWDMISMATCH, info('ERR_PASSWDMISMATCH', 'error', 'error')],
  [ERR_YOUREBANNEDCREEP, info('ERR_YOUREBANNEDCREEP', 'error', 'error')],
  [ERR_YOUWILLBEBANNED, info('ERR_YOUWILLBEBANNED', 'error', 'error')],
  [ERR_CHANNELISFULL, info('ERR_CHANNELISFULL', 'error', 'error')],
  [ERR_UNKNOWNMODE, info('ERR_UNKNOWNMODE', 'error', 'error')],
  [ERR_INVITEONLYCHAN, info('ERR_INVITEONLYCHAN', 'error', 'error')],
  [ERR_BANNEDFROMCHAN, info('ERR_BANNEDFROMCHAN', 'error', 'error')],
  [ERR_BADCHANNELKEY, info('ERR_BADCHANNELKEY', 'error', 'error')],
  [ERR_BADCHANMASK, info('ERR_BADCHANMASK', 'error', 'error')],
  [ERR_NOCHANMODES, info('ERR_NOCHANMODES', 'error', 'error')],
  [ERR_BANLISTFULL, info('ERR_BANLISTFULL', 'error', 'error')],
  [ERR_NOPRIVILEGES, info('ERR_NOPRIVILEGES', 'error', 'error')],
  [ERR_CHANOPRIVSNEEDED, info('ERR_CHANOPRIVSNEEDED', 'error', 'error')],
  [ERR_RESTRICTED, info('ERR_RESTRICTED', 'error', 'error')],
  [ERR_UMODEUNKNOWNFLAG, info('ERR_UMODEUNKNOWNFLAG', 'error', 'error')],
  [ERR_USERSDONTMATCH, info('ERR_USERSDONTMATCH', 'error', 'error')],
]);

/** The RFC name of a numeric, for the raw log and the decoder. */
export function numericName(numeric: string): string | undefined {
  return NUMERICS.get(numeric)?.name;
}

/** An action the interface can offer alongside an error. */
export type SuggestedAction =
  | 'choose-another-nick'
  | 'request-invite'
  | 'enter-channel-password'
  | 'retry-later'
  | 'ask-an-operator'
  | 'check-the-name'
  | 'none';

export interface ErrorReport {
  /** One or two sentences, in the interface's voice. Never apologises. */
  readonly message: string;
  readonly action: SuggestedAction;
}

/**
 * Plain-English copy for an error numeric.
 *
 * Copy rules from CLAUDE.md: say what happened and what to do, name things by
 * what the user controls rather than by protocol mechanism, and never surface a
 * numeric or a mode letter here — those belong to the decoder and the raw log.
 */
/** Ensures a fragment of server text reads as a finished sentence. */
const endWithStop = (text: string): string => (/[.!?]$/.test(text.trim()) ? text : `${text}.`);

export function describeError(numeric: string, params: readonly string[]): ErrorReport {
  // params[0] is our own nick on every error numeric; the subject follows.
  const subject = params[1] ?? '';
  const detail = params[params.length - 1] ?? '';

  switch (numeric) {
    case ERR_NOSUCHNICK:
      return {
        message: `There's nobody here called ${subject}. They may have disconnected or changed their name.`,
        action: 'check-the-name',
      };
    case ERR_NOSUCHSERVER:
      return { message: `No server called ${subject} was found.`, action: 'check-the-name' };
    case ERR_NOSUCHCHANNEL:
      return { message: `The channel ${subject} doesn't exist.`, action: 'check-the-name' };
    case ERR_CANNOTSENDTOCHAN:
      return {
        message: `You can't send messages to ${subject}. You may need to join it first, or be given permission to speak.`,
        action: 'ask-an-operator',
      };
    case ERR_TOOMANYCHANNELS:
      return {
        message: `You've joined as many channels as this network allows. Leave one before joining ${subject}.`,
        action: 'none',
      };
    case ERR_UNKNOWNCOMMAND:
      return { message: `This network doesn't recognise ${subject}.`, action: 'none' };
    case ERR_ERRONEUSNICKNAME:
      return {
        message: `${subject} isn't a name this network accepts. Try one with only letters, digits, and basic punctuation.`,
        action: 'choose-another-nick',
      };
    case ERR_NICKNAMEINUSE:
      return { message: `${subject} is already taken.`, action: 'choose-another-nick' };
    case ERR_NICKCOLLISION:
      return {
        message: `${subject} is in use elsewhere on the network.`,
        action: 'choose-another-nick',
      };
    case ERR_UNAVAILRESOURCE:
      return {
        message: `${subject} isn't available right now. It may be held briefly after someone else used it.`,
        action: 'retry-later',
      };
    case ERR_USERNOTINCHANNEL:
      return { message: `${subject} isn't in ${params[2] ?? 'that channel'}.`, action: 'none' };
    case ERR_NOTONCHANNEL:
      return { message: `You're not in ${subject}.`, action: 'none' };
    case ERR_USERONCHANNEL:
      return {
        message: `${subject} is already in ${params[2] ?? 'that channel'}.`,
        action: 'none',
      };
    case ERR_NEEDMOREPARAMS:
      return { message: `${subject} needs more information to run.`, action: 'none' };
    case ERR_CHANNELISFULL:
      return { message: `${subject} is full.`, action: 'retry-later' };
    case ERR_UNKNOWNMODE:
      return { message: `This network doesn't support that channel setting.`, action: 'none' };
    case ERR_INVITEONLYCHAN:
      return {
        message: `${subject} is invite-only. You'll need an invitation from someone already in the channel.`,
        action: 'request-invite',
      };
    case ERR_BANNEDFROMCHAN:
      return {
        message: `You're banned from ${subject}.`,
        action: 'ask-an-operator',
      };
    case ERR_BADCHANNELKEY:
      return {
        message: `${subject} needs a password to join.`,
        action: 'enter-channel-password',
      };
    case ERR_BADCHANMASK:
      return { message: `${subject} isn't a valid channel name.`, action: 'check-the-name' };
    case ERR_NOCHANMODES:
      return { message: `${subject} doesn't support channel settings.`, action: 'none' };
    case ERR_BANLISTFULL:
      return {
        message: `The ban list for ${subject} is full. Remove an entry before adding another.`,
        action: 'none',
      };
    case ERR_NOPRIVILEGES:
      return { message: `You don't have permission to do that.`, action: 'none' };
    case ERR_CHANOPRIVSNEEDED:
      return {
        message: `You need to be an operator in ${subject} to do that.`,
        action: 'ask-an-operator',
      };
    case ERR_RESTRICTED:
      return { message: `Your connection is restricted, so that isn't allowed.`, action: 'none' };
    case ERR_UMODEUNKNOWNFLAG:
      return { message: `This network doesn't support that account setting.`, action: 'none' };
    case ERR_USERSDONTMATCH:
      return { message: `You can only change your own settings.`, action: 'none' };
    case ERR_NICKLOCKED:
      return {
        message: `This account is tied to a different name, so you can't sign in under this one.`,
        action: 'choose-another-nick',
      };
    case ERR_SASLFAIL:
      return {
        message: `Sign-in failed. Check the account name and password for this network.`,
        action: 'none',
      };
    case ERR_SASLTOOLONG:
      return { message: `Sign-in failed because the credentials were too long.`, action: 'none' };
    case ERR_SASLABORTED:
      return { message: `Sign-in was cancelled.`, action: 'none' };
    case ERR_MONLISTFULL:
      return {
        message: `Your notify list is full. Remove someone before adding another person.`,
        action: 'none',
      };
    case ERR_YOUREBANNEDCREEP:
    case ERR_YOUWILLBEBANNED:
      // The server's own reason is the useful part — an anti-proxy rule, a
      // ban list — so it leads, with a plain statement of what happened.
      return {
        message:
          detail !== ''
            ? `This network refused the connection: ${endWithStop(detail)}`
            : `This network has refused your connection.`,
        action: 'none',
      };
    case ERR_PASSWDMISMATCH:
      return {
        message: `The server password was wrong, or one was needed and none was given.`,
        action: 'none',
      };
    default:
      // Fall back to the server's own text rather than inventing copy. It is
      // still a sentence, not a numeric.
      return {
        message: detail !== '' ? detail : `The network refused that request.`,
        action: 'none',
      };
  }
}

/** Which list a list numeric belongs to. */
export type ListKind = 'ban' | 'except' | 'invite' | 'quiet';

export interface NamesEntry {
  readonly prefixes: string;
  readonly nick: string;
}

/** Structured events produced from numerics. */
export type NumericEvent =
  | { readonly kind: 'welcome'; readonly nick: string; readonly text: string }
  | { readonly kind: 'isupport'; readonly tokens: readonly string[] }
  | { readonly kind: 'my-info'; readonly server: string; readonly version: string }
  | { readonly kind: 'server-info'; readonly text: string }
  | { readonly kind: 'motd-start'; readonly text: string }
  | { readonly kind: 'motd-line'; readonly text: string }
  | { readonly kind: 'motd-end'; readonly text: string }
  | { readonly kind: 'no-motd'; readonly text: string }
  | { readonly kind: 'topic'; readonly channel: string; readonly topic: string }
  | { readonly kind: 'no-topic'; readonly channel: string }
  | {
      readonly kind: 'topic-set-by';
      readonly channel: string;
      readonly setBy: string;
      readonly at: Date | undefined;
    }
  | {
      readonly kind: 'names';
      readonly channel: string;
      readonly members: readonly NamesEntry[];
    }
  | { readonly kind: 'names-end'; readonly channel: string }
  | {
      readonly kind: 'channel-modes';
      readonly channel: string;
      readonly modeString: string;
      readonly params: readonly string[];
    }
  | {
      readonly kind: 'list-entry';
      readonly list: ListKind;
      readonly channel: string;
      readonly mask: string;
      readonly setBy: string | undefined;
      readonly at: Date | undefined;
    }
  | { readonly kind: 'list-end'; readonly list: ListKind; readonly channel: string }
  | {
      readonly kind: 'channel-list-entry';
      readonly channel: string;
      readonly members: number;
      readonly topic: string;
    }
  | { readonly kind: 'channel-list-end' }
  | {
      readonly kind: 'whois';
      readonly numeric: string;
      readonly nick: string;
      readonly params: readonly string[];
    }
  | { readonly kind: 'whois-end'; readonly nick: string }
  | {
      readonly kind: 'who-reply';
      readonly channel: string;
      readonly username: string;
      readonly host: string;
      readonly server: string;
      readonly nick: string;
      readonly away: boolean;
      readonly oper: boolean;
      readonly bot: boolean;
      /** Status prefixes carried in the flags field. */
      readonly prefixes: string;
      readonly realname: string;
    }
  /**
   * A WHOX reply. The field order is decided by the token the client sent, so
   * the protocol layer reports the fields and the caller — which knows what it
   * asked for — reads them.
   */
  | { readonly kind: 'whox-reply'; readonly fields: readonly string[] }
  | { readonly kind: 'who-end'; readonly target: string }
  | { readonly kind: 'channel-list-start' }
  | { readonly kind: 'channel-created'; readonly channel: string; readonly at: Date | undefined }
  | { readonly kind: 'inviting'; readonly channel: string; readonly nick: string }
  | { readonly kind: 'monitor-list'; readonly targets: readonly string[] }
  | { readonly kind: 'monitor-list-end' }
  /** A nick left the notify list. WATCH confirms removals; MONITOR does not. */
  | { readonly kind: 'monitor-removed'; readonly targets: readonly string[] }
  | { readonly kind: 'logged-out' }
  | { readonly kind: 'sasl-already-authenticated' }
  | { readonly kind: 'away'; readonly nick: string; readonly reason: string }
  | { readonly kind: 'away-state'; readonly away: boolean }
  | { readonly kind: 'sasl-success'; readonly account: string | undefined }
  | { readonly kind: 'sasl-mechanisms'; readonly mechanisms: readonly string[] }
  | {
      readonly kind: 'monitor';
      readonly online: boolean;
      readonly targets: readonly string[];
    }
  | {
      readonly kind: 'error';
      readonly numeric: string;
      readonly report: ErrorReport;
      readonly params: readonly string[];
    }
  | { readonly kind: 'unhandled'; readonly numeric: string; readonly params: readonly string[] };

const toDate = (seconds: string | undefined): Date | undefined => {
  if (seconds === undefined || !/^\d+$/.test(seconds)) {
    return undefined;
  }
  const value = Number.parseInt(seconds, 10) * 1000;
  return Number.isSafeInteger(value) ? new Date(value) : undefined;
};

const LIST_KINDS: ReadonlyMap<string, ListKind> = new Map([
  [RPL_BANLIST, 'ban'],
  [RPL_ENDOFBANLIST, 'ban'],
  [RPL_EXCEPTLIST, 'except'],
  [RPL_ENDOFEXCEPTLIST, 'except'],
  [RPL_INVITELIST, 'invite'],
  [RPL_ENDOFINVITELIST, 'invite'],
  [RPL_QUIETLIST, 'quiet'],
  [RPL_ENDOFQUIETLIST, 'quiet'],
]);

/**
 * Turns a numeric message into a typed event.
 *
 * Anything unrecognised comes back as `unhandled` carrying its parameters, so
 * the raw log still shows it and the message list still does not.
 */
export function interpretNumeric(msg: IrcMessage, support: ISupport): NumericEvent {
  const numeric = msg.command;
  const p = msg.params;
  const last = p[p.length - 1] ?? '';

  switch (numeric) {
    case RPL_WELCOME:
      return { kind: 'welcome', nick: p[0] ?? '', text: last };

    case RPL_ISUPPORT:
      // Drop the leading nick and the trailing human-readable sentence.
      return { kind: 'isupport', tokens: p.slice(1, -1) };

    case RPL_MYINFO:
      return { kind: 'my-info', server: p[1] ?? '', version: p[2] ?? '' };

    case RPL_YOURHOST:
    case RPL_CREATED:
    case RPL_LUSERCLIENT:
    case RPL_LUSEROP:
    case RPL_LUSERUNKNOWN:
    case RPL_LUSERCHANNELS:
    case RPL_LUSERME:
    case RPL_LOCALUSERS:
    case RPL_GLOBALUSERS:
      return { kind: 'server-info', text: last };

    case RPL_MOTDSTART:
      return { kind: 'motd-start', text: last };
    case RPL_MOTD:
      return { kind: 'motd-line', text: last };
    case RPL_ENDOFMOTD:
      return { kind: 'motd-end', text: last };
    case ERR_NOMOTD:
      return { kind: 'no-motd', text: last };

    case RPL_TOPIC:
      return { kind: 'topic', channel: p[1] ?? '', topic: last };
    case RPL_NOTOPIC:
      return { kind: 'no-topic', channel: p[1] ?? '' };
    case RPL_TOPICWHOTIME:
      return {
        kind: 'topic-set-by',
        channel: p[1] ?? '',
        setBy: p[2] ?? '',
        at: toDate(p[3]),
      };

    case RPL_NAMREPLY: {
      // RPL_NAMREPLY <nick> <symbol> <channel> :<names>
      const members = last
        .split(' ')
        .filter((entry) => entry !== '')
        .map((entry) => splitPrefixes(entry, support));
      return { kind: 'names', channel: p[2] ?? '', members };
    }
    case RPL_ENDOFNAMES:
      return { kind: 'names-end', channel: p[1] ?? '' };

    case RPL_CHANNELMODEIS:
      return {
        kind: 'channel-modes',
        channel: p[1] ?? '',
        modeString: p[2] ?? '',
        params: p.slice(3),
      };

    case RPL_BANLIST:
    case RPL_EXCEPTLIST:
    case RPL_INVITELIST:
    case RPL_QUIETLIST: {
      const list = LIST_KINDS.get(numeric) ?? 'ban';
      // Quiet lists carry the mode letter before the mask on some networks.
      const offset = numeric === RPL_QUIETLIST && (p[2] ?? '').length === 1 ? 1 : 0;
      return {
        kind: 'list-entry',
        list,
        channel: p[1] ?? '',
        mask: p[2 + offset] ?? '',
        setBy: p[3 + offset],
        at: toDate(p[4 + offset]),
      };
    }

    case RPL_ENDOFBANLIST:
    case RPL_ENDOFEXCEPTLIST:
    case RPL_ENDOFINVITELIST:
    case RPL_ENDOFQUIETLIST:
      return { kind: 'list-end', list: LIST_KINDS.get(numeric) ?? 'ban', channel: p[1] ?? '' };

    case RPL_LIST:
      return {
        kind: 'channel-list-entry',
        channel: p[1] ?? '',
        members: Number.parseInt(p[2] ?? '0', 10) || 0,
        topic: p[3] ?? '',
      };
    case RPL_LISTEND:
      return { kind: 'channel-list-end' };

    case RPL_WHOISUSER:
    case RPL_WHOISSERVER:
    case RPL_WHOISOPERATOR:
    case RPL_WHOWASUSER:
    case RPL_WHOISIDLE:
    case RPL_WHOISCHANNELS:
    case RPL_WHOISACCOUNT:
    case RPL_WHOISACTUALLY:
    case RPL_WHOISBOT:
    case RPL_WHOISSECURE:
      return { kind: 'whois', numeric, nick: p[1] ?? '', params: p.slice(1) };

    case RPL_ENDOFWHOIS:
    case RPL_ENDOFWHOWAS:
      return { kind: 'whois-end', nick: p[1] ?? '' };

    case RPL_WHOREPLY: {
      // <client> <channel> <user> <host> <server> <nick> <flags> :<hops> <real>
      const flags = p[6] ?? '';
      const advertised = support.prefixes.map((entry) => entry.prefix);
      const trailing = p[7] ?? '';
      // The trailing parameter is "<hopcount> <realname>".
      const space = trailing.indexOf(' ');

      return {
        kind: 'who-reply',
        channel: p[1] ?? '',
        username: p[2] ?? '',
        host: p[3] ?? '',
        server: p[4] ?? '',
        nick: p[5] ?? '',
        away: flags.startsWith('G'),
        oper: flags.includes('*'),
        bot: flags.includes('B'),
        prefixes: flags
          .split('')
          .filter((char) => advertised.includes(char))
          .join(''),
        realname: space === -1 ? '' : trailing.slice(space + 1),
      };
    }

    case RPL_WHOSPCRPL:
      return { kind: 'whox-reply', fields: p.slice(1) };

    case RPL_ENDOFWHO:
      return { kind: 'who-end', target: p[1] ?? '' };

    case RPL_LISTSTART:
      return { kind: 'channel-list-start' };

    case RPL_CREATIONTIME:
      return { kind: 'channel-created', channel: p[1] ?? '', at: toDate(p[2]) };

    case RPL_INVITING:
      // Parameter order varies between ircds; the channel is the one that
      // starts with a channel type character.
      return isChannel(p[1] ?? '', support)
        ? { kind: 'inviting', channel: p[1] ?? '', nick: p[2] ?? '' }
        : { kind: 'inviting', channel: p[2] ?? '', nick: p[1] ?? '' };

    case RPL_MONLIST:
      return { kind: 'monitor-list', targets: last.split(',').filter((t) => t !== '') };

    case RPL_ENDOFMONLIST:
      return { kind: 'monitor-list-end' };

    case RPL_LOGGEDOUT:
      return { kind: 'logged-out' };

    case ERR_SASLALREADY:
      return { kind: 'sasl-already-authenticated' };

    case RPL_AWAY:
      return { kind: 'away', nick: p[1] ?? '', reason: last };
    case RPL_NOWAWAY:
      return { kind: 'away-state', away: true };
    case RPL_UNAWAY:
      return { kind: 'away-state', away: false };

    case RPL_SASLSUCCESS:
      return { kind: 'sasl-success', account: undefined };
    case RPL_LOGGEDIN:
      return { kind: 'sasl-success', account: p[2] };
    case RPL_SASLMECHS:
      return {
        kind: 'sasl-mechanisms',
        mechanisms: (p[1] ?? '').split(',').filter((name) => name !== ''),
      };

    case RPL_MONONLINE:
      return { kind: 'monitor', online: true, targets: last.split(',').filter((t) => t !== '') };
    case RPL_MONOFFLINE:
      return { kind: 'monitor', online: false, targets: last.split(',').filter((t) => t !== '') };

    // WATCH names one nick per line, in `<nick> <user> <host> <signon>` form.
    case RPL_LOGON:
    case RPL_NOWON:
    case RPL_NOWISAWAY:
      return { kind: 'monitor', online: true, targets: p[1] === undefined ? [] : [p[1]] };
    case RPL_LOGOFF:
    case RPL_NOWOFF:
      return { kind: 'monitor', online: false, targets: p[1] === undefined ? [] : [p[1]] };
    case RPL_WATCHLIST:
      // The list reply carries the whole list on one line, space-separated.
      return { kind: 'monitor-list', targets: last.split(' ').filter((t) => t !== '') };
    case RPL_ENDOFWATCHLIST:
      return { kind: 'monitor-list-end' };
    case RPL_WATCHOFF:
      return { kind: 'monitor-removed', targets: p[1] === undefined ? [] : [p[1]] };
    case RPL_WATCHSTAT:
      // "You have N and are on M WATCH entries" — a count, not a membership
      // change, so it belongs in the server tab rather than the Friends panel.
      return { kind: 'server-info', text: last };

    default: {
      if (NUMERICS.get(numeric)?.disposition === 'error') {
        return { kind: 'error', numeric, report: describeError(numeric, p), params: p };
      }
      return { kind: 'unhandled', numeric, params: p };
    }
  }
}

/** Numerics that mean registration has completed. */
export const REGISTRATION_COMPLETE: ReadonlySet<string> = new Set([RPL_ENDOFMOTD, ERR_NOMOTD]);

/** Numerics that mean the chosen nick was refused during registration. */
export const NICK_UNAVAILABLE: ReadonlySet<string> = new Set([
  ERR_NICKNAMEINUSE,
  ERR_NICKCOLLISION,
  ERR_UNAVAILRESOURCE,
  ERR_ERRONEUSNICKNAME,
]);
