/**
 * RPL_ISUPPORT (005) parsing.
 *
 * This is how a server tells the client what it actually supports. Marmotter
 * adapts to it rather than hardcoding assumptions: prefix characters, which
 * modes take parameters, how many targets a command accepts, and what counts as
 * a channel all come from here.
 *
 * Tokens arrive across several 005 lines and accumulate. A token prefixed with
 * `-` is a negation, resetting that token to its default.
 */

import { type CaseMapping, DEFAULT_CASEMAPPING, parseCaseMapping } from './casemapping.js';

/** One `PREFIX` entry: a channel mode letter and the nick prefix it grants. */
export interface PrefixEntry {
  /** Mode letter, e.g. `o`. */
  readonly mode: string;
  /** Prefix character, e.g. `@`. */
  readonly prefix: string;
}

/**
 * `CHANMODES`, grouped by how each mode behaves.
 *
 * The four groups are positional in the token and decide parameter handling,
 * which the mode parser depends on.
 */
export interface ChanModes {
  /** Type A: list modes. Always take a parameter. Bans, excepts, invex. */
  readonly list: string;
  /** Type B: always take a parameter. Channel key. */
  readonly parameter: string;
  /** Type C: take a parameter when set, none when unset. Member limit. */
  readonly parameterWhenSet: string;
  /** Type D: never take a parameter. Simple flags. */
  readonly flag: string;
}

export interface ISupport {
  /** Every token as received, for the raw log and the decoder. */
  readonly raw: ReadonlyMap<string, string>;

  readonly network: string | undefined;
  readonly caseMapping: CaseMapping;
  /** Characters that introduce a channel name, e.g. `#&`. */
  readonly chanTypes: string;
  readonly chanModes: ChanModes;
  /** Ordered most privileged first, as the server lists them. */
  readonly prefixes: readonly PrefixEntry[];
  /** Maximum mode changes per MODE command. Undefined means unlimited. */
  readonly modesPerCommand: number | undefined;
  /** Per-command target limits from `TARGMAX`. Undefined value means unlimited. */
  readonly targetMax: ReadonlyMap<string, number | undefined>;
  /** Join limits per channel-type prefix from `CHANLIMIT`. */
  readonly chanLimit: ReadonlyMap<string, number | undefined>;
  /** List-mode entry limits from `MAXLIST`. */
  readonly maxList: ReadonlyMap<string, number>;
  /** Mode letters usable as a `STATUSMSG` target prefix. */
  readonly statusMsg: string;
  /** MONITOR list limit. Undefined value means unlimited; absent means unsupported. */
  readonly monitor: { readonly supported: boolean; readonly limit: number | undefined };
  /**
   * WATCH list limit, the older notify mechanism.
   *
   * UnrealIRCd and several other ircds offer WATCH where Libera offers MONITOR.
   * The Friends panel prefers MONITOR and falls back to WATCH before it falls
   * back to polling WHOIS.
   */
  readonly watch: { readonly supported: boolean; readonly limit: number | undefined };
  /**
   * Extended ban syntax, from `EXTBAN=<prefix>,<letters>`.
   *
   * Extbans are how a ban targets something other than a hostmask — an account,
   * a realname, a country. The prefix differs by ircd (`~` on UnrealIRCd, `$`
   * on solanum), so the ban builder must read it here rather than hardcode one.
   */
  readonly extban: { readonly prefix: string; readonly types: string } | undefined;
  /**
   * `CHATHISTORY=<max>`, the largest number of messages one request may ask
   * for. Undefined means the server does not offer history at all; a value of
   * 0 means it offers it with no fixed ceiling.
   */
  readonly chatHistory: number | undefined;
  /**
   * `MSGREFTYPES`, the message reference types the server accepts, in its own
   * order of preference.
   *
   * A server that only accepts `timestamp` cannot be paginated by `msgid`, and
   * asking it to would silently return the wrong page.
   */
  readonly msgRefTypes: readonly string[];
  readonly whox: boolean;
  readonly utf8Only: boolean;
  readonly maxNickLength: number | undefined;
  readonly maxChannelLength: number | undefined;
  readonly maxTopicLength: number | undefined;
  readonly maxAwayLength: number | undefined;
  readonly maxKickLength: number | undefined;
  readonly excepts: string | undefined;
  readonly invex: string | undefined;
  readonly safeList: boolean;
  /** Search extensions the server accepts on `LIST`. */
  readonly elist: string;
}

/**
 * Defaults for a server that advertises nothing.
 *
 * These are the historical values every ircd predating ISUPPORT behaved as, so a
 * network sending no 005 at all still works.
 */
export const DEFAULT_ISUPPORT: ISupport = {
  raw: new Map(),
  network: undefined,
  caseMapping: DEFAULT_CASEMAPPING,
  chanTypes: '#&',
  chanModes: { list: 'b', parameter: 'k', parameterWhenSet: 'l', flag: 'imnpst' },
  prefixes: [
    { mode: 'o', prefix: '@' },
    { mode: 'v', prefix: '+' },
  ],
  modesPerCommand: 3,
  targetMax: new Map(),
  chanLimit: new Map(),
  maxList: new Map(),
  statusMsg: '',
  monitor: { supported: false, limit: undefined },
  watch: { supported: false, limit: undefined },
  extban: undefined,
  chatHistory: undefined,
  // The spec's default when the token is absent but the capability is offered.
  msgRefTypes: ['timestamp', 'msgid'],
  whox: false,
  utf8Only: false,
  maxNickLength: undefined,
  maxChannelLength: undefined,
  maxTopicLength: undefined,
  maxAwayLength: undefined,
  maxKickLength: undefined,
  excepts: undefined,
  invex: undefined,
  safeList: false,
  elist: '',
};

/** Undoes the value escaping ISUPPORT uses for spaces and backslashes. */
export function unescapeISupportValue(value: string): string {
  if (!value.includes('\\x')) {
    return value;
  }
  return value.replace(/\\x([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

const parseInteger = (value: string): number | undefined => {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

/**
 * Parses `PREFIX=(ohv)@%+`.
 *
 * A malformed token, or the explicit empty value some servers send to mean "no
 * prefixes at all", yields an empty list rather than a throw.
 */
export function parsePrefix(value: string): readonly PrefixEntry[] {
  const match = /^\(([^)]*)\)(.*)$/.exec(value);
  if (!match) {
    return [];
  }
  const modes = match[1] ?? '';
  const prefixes = match[2] ?? '';

  const entries: PrefixEntry[] = [];
  for (let i = 0; i < Math.min(modes.length, prefixes.length); i += 1) {
    entries.push({ mode: modes[i] ?? '', prefix: prefixes[i] ?? '' });
  }
  return entries;
}

/** Parses `CHANMODES=beI,k,l,imnpst`. Missing groups come back empty. */
export function parseChanModes(value: string): ChanModes {
  const groups = value.split(',');
  return {
    list: groups[0] ?? '',
    parameter: groups[1] ?? '',
    parameterWhenSet: groups[2] ?? '',
    flag: groups[3] ?? '',
  };
}

/**
 * Parses the `PREFIX:limit` list shape shared by `TARGMAX`, `CHANLIMIT`, and
 * `MAXLIST`. A missing limit means unlimited.
 */
function parseLimitList(value: string): Map<string, number | undefined> {
  const limits = new Map<string, number | undefined>();
  for (const entry of value.split(',')) {
    if (entry === '') {
      continue;
    }
    const colon = entry.indexOf(':');
    const keys = colon === -1 ? entry : entry.slice(0, colon);
    const limit = colon === -1 ? undefined : parseInteger(entry.slice(colon + 1));

    // CHANLIMIT and MAXLIST group several prefixes or modes under one limit.
    if (keys === '') {
      continue;
    }
    for (const key of keys.split('')) {
      limits.set(key, limit);
    }
  }
  return limits;
}

/** TARGMAX keys are command names, not single characters. */
function parseTargMax(value: string): Map<string, number | undefined> {
  const limits = new Map<string, number | undefined>();
  for (const entry of value.split(',')) {
    if (entry === '') {
      continue;
    }
    const colon = entry.indexOf(':');
    const command = (colon === -1 ? entry : entry.slice(0, colon)).toUpperCase();
    if (command === '') {
      continue;
    }
    limits.set(command, colon === -1 ? undefined : parseInteger(entry.slice(colon + 1)));
  }
  return limits;
}

/**
 * Applies the tokens from one 005 line on top of what is already known.
 *
 * The parameters are the 005 params with the leading nick and the trailing
 * "are supported by this server" text removed.
 */
export function applyISupport(current: ISupport, tokens: readonly string[]): ISupport {
  const raw = new Map(current.raw);
  const next: Record<string, string | undefined> = {};

  for (const token of tokens) {
    if (token === '') {
      continue;
    }
    if (token.startsWith('-')) {
      const name = token.slice(1).toUpperCase();
      raw.delete(name);
      next[name] = undefined;
      continue;
    }
    const equals = token.indexOf('=');
    const name = (equals === -1 ? token : token.slice(0, equals)).toUpperCase();
    const value = equals === -1 ? '' : unescapeISupportValue(token.slice(equals + 1));
    raw.set(name, value);
    next[name] = value;
  }

  // A token present in this batch is applied; one absent is left as it was; one
  // negated returns to its default.
  const read = (name: string): { present: boolean; value: string | undefined } =>
    name in next ? { present: true, value: next[name] } : { present: false, value: undefined };

  const pick = <T>(name: string, parse: (value: string) => T, fallback: T, keep: T): T => {
    const { present, value } = read(name);
    if (!present) {
      return keep;
    }
    return value === undefined ? fallback : parse(value);
  };

  const maxList = pick(
    'MAXLIST',
    (value) => {
      const parsed = new Map<string, number>();
      for (const [key, limit] of parseLimitList(value)) {
        if (limit !== undefined) {
          parsed.set(key, limit);
        }
      }
      return parsed as ReadonlyMap<string, number>;
    },
    DEFAULT_ISUPPORT.maxList,
    current.maxList,
  );

  const watch = pick(
    'WATCH',
    (value) => ({ supported: true, limit: parseInteger(value) }),
    DEFAULT_ISUPPORT.watch,
    current.watch,
  );

  const extban = pick(
    'EXTBAN',
    (value) => {
      // `EXTBAN=~,abc`. The prefix may be empty, which means the letters are
      // used without one.
      const comma = value.indexOf(',');
      return comma === -1
        ? { prefix: '', types: value }
        : { prefix: value.slice(0, comma), types: value.slice(comma + 1) };
    },
    DEFAULT_ISUPPORT.extban,
    current.extban,
  );

  const monitor = pick(
    'MONITOR',
    (value) => ({ supported: true, limit: parseInteger(value) }),
    DEFAULT_ISUPPORT.monitor,
    current.monitor,
  );

  // Servers that predate ratification still advertise `draft/CHATHISTORY`, and
  // a few send both. The unprefixed token is applied second so it wins.
  const draftChatHistory = pick(
    'DRAFT/CHATHISTORY',
    parseInteger,
    DEFAULT_ISUPPORT.chatHistory,
    current.chatHistory,
  );
  const chatHistory = pick(
    'CHATHISTORY',
    parseInteger,
    DEFAULT_ISUPPORT.chatHistory,
    draftChatHistory,
  );

  return {
    raw,
    network: pick('NETWORK', (value) => value, undefined, current.network),
    caseMapping: pick(
      'CASEMAPPING',
      parseCaseMapping,
      DEFAULT_ISUPPORT.caseMapping,
      current.caseMapping,
    ),
    chanTypes: pick('CHANTYPES', (value) => value, DEFAULT_ISUPPORT.chanTypes, current.chanTypes),
    chanModes: pick('CHANMODES', parseChanModes, DEFAULT_ISUPPORT.chanModes, current.chanModes),
    prefixes: pick('PREFIX', parsePrefix, DEFAULT_ISUPPORT.prefixes, current.prefixes),
    modesPerCommand: pick(
      'MODES',
      // `MODES` with no value means unlimited.
      (value) => (value === '' ? undefined : parseInteger(value)),
      DEFAULT_ISUPPORT.modesPerCommand,
      current.modesPerCommand,
    ),
    targetMax: pick('TARGMAX', parseTargMax, DEFAULT_ISUPPORT.targetMax, current.targetMax),
    chanLimit: pick('CHANLIMIT', parseLimitList, DEFAULT_ISUPPORT.chanLimit, current.chanLimit),
    maxList,
    statusMsg: pick('STATUSMSG', (value) => value, DEFAULT_ISUPPORT.statusMsg, current.statusMsg),
    monitor,
    watch,
    extban,
    chatHistory,
    msgRefTypes: pick(
      'MSGREFTYPES',
      (value) =>
        value
          .split(',')
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => entry !== ''),
      DEFAULT_ISUPPORT.msgRefTypes,
      current.msgRefTypes,
    ),
    whox: pick('WHOX', () => true, false, current.whox),
    utf8Only: pick('UTF8ONLY', () => true, false, current.utf8Only),
    maxNickLength: pick('NICKLEN', parseInteger, undefined, current.maxNickLength),
    maxChannelLength: pick('CHANNELLEN', parseInteger, undefined, current.maxChannelLength),
    maxTopicLength: pick('TOPICLEN', parseInteger, undefined, current.maxTopicLength),
    maxAwayLength: pick('AWAYLEN', parseInteger, undefined, current.maxAwayLength),
    maxKickLength: pick('KICKLEN', parseInteger, undefined, current.maxKickLength),
    excepts: pick('EXCEPTS', (value) => (value === '' ? 'e' : value), undefined, current.excepts),
    invex: pick('INVEX', (value) => (value === '' ? 'I' : value), undefined, current.invex),
    safeList: pick('SAFELIST', () => true, false, current.safeList),
    elist: pick('ELIST', (value) => value.toUpperCase(), DEFAULT_ISUPPORT.elist, current.elist),
  };
}

/** Whether a target names a channel under this server's `CHANTYPES`. */
export function isChannel(target: string, support: ISupport): boolean {
  const first = target[0];
  return first !== undefined && support.chanTypes.includes(first);
}

/** The prefix character granted by a mode letter, if that mode grants one. */
export function prefixForMode(mode: string, support: ISupport): string | undefined {
  return support.prefixes.find((entry) => entry.mode === mode)?.prefix;
}

/** The mode letter behind a prefix character, if the server advertises it. */
export function modeForPrefix(prefix: string, support: ISupport): string | undefined {
  return support.prefixes.find((entry) => entry.prefix === prefix)?.mode;
}

/**
 * Rank of a prefix, higher being more privileged, or -1 when unknown.
 *
 * The member list sorts on this rather than on a hardcoded `@%+` order, because
 * networks add owner and admin prefixes in their own order.
 */
export function prefixRank(prefix: string, support: ISupport): number {
  const index = support.prefixes.findIndex((entry) => entry.prefix === prefix);
  return index === -1 ? -1 : support.prefixes.length - 1 - index;
}

/**
 * Whether the server supports a given extended ban type.
 *
 * The ban builder offers the account and realname scopes only where the network
 * can actually enforce them.
 */
export function supportsExtban(type: string, support: ISupport): boolean {
  return support.extban !== undefined && support.extban.types.includes(type);
}

/**
 * Builds an extended ban mask, e.g. `~a:account` or `$a:account`.
 *
 * Returns undefined when the network does not advertise the type, so a caller
 * cannot accidentally send a mask this server will read as a literal nickname.
 */
export function buildExtban(type: string, value: string, support: ISupport): string | undefined {
  if (support.extban === undefined || !support.extban.types.includes(type)) {
    return undefined;
  }
  return `${support.extban.prefix}${type}:${value}`;
}

/** Strips any advertised status prefixes from the front of a nick. */
export function splitPrefixes(
  nick: string,
  support: ISupport,
): { readonly prefixes: string; readonly nick: string } {
  const all = support.prefixes.map((entry) => entry.prefix);
  let i = 0;
  while (i < nick.length) {
    const char = nick[i];
    if (char === undefined || !all.includes(char)) {
      break;
    }
    i += 1;
  }
  return { prefixes: nick.slice(0, i), nick: nick.slice(i) };
}
