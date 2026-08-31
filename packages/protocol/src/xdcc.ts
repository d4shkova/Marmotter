/**
 * XDCC pack-announcement parsing.
 *
 * On file-serving networks a bot sits in a channel and advertises its catalogue
 * as ordinary channel messages, one per file:
 *
 *   #70 1x [2.2G] Avatar The Last Airbender - S01E12 - The Storm.mkv
 *    │   │   │     └ filename
 *    │   │   └ size
 *    │   └ how many times it has been sent ("gets")
 *    └ pack number
 *
 * These are not `DCC SEND` — nothing transfers yet. A file is fetched by asking
 * the bot for a pack (`XDCC SEND #70`), at which point it replies with a real
 * `DCC SEND` that `dcc.ts` decodes and the downloader fetches. This module does
 * only the pure part: turning an advertised line into a structured pack, so the
 * file monitor can list what a channel is offering before anything is requested.
 */

/** A file a bot has advertised over XDCC. */
export interface XdccPack {
  /** The pack number used to request it, e.g. 70 for `XDCC SEND #70`. */
  readonly pack: number;
  /** How many times the bot reports having sent it. */
  readonly gets: number;
  /** The advertised size, verbatim, e.g. `2.2G`. */
  readonly sizeText: string;
  /** The advertised size in bytes, where it could be parsed. */
  readonly sizeBytes?: number;
  readonly filename: string;
}

// #<pack> <gets>x [<size>] <filename>. The size is the first bracketed group;
// a filename may itself contain brackets (packs often do), so the rest of the
// line is taken verbatim once the size has been read.
const ANNOUNCE = /^\s*#(\d+)\s+([\d,]+)x\s+\[\s*([^\]]*?)\s*\]\s+(\S.*?)\s*$/;

// mIRC formatting: colour (\x03NN,NN), hex colour (\x04RRGGBB), and the toggles
// for bold, italic, underline, strikethrough, reverse, monospace and reset.
// Serving bots routinely colour their pack lines, which would otherwise push a
// control character in front of the leading `#` and defeat the match.
// eslint-disable-next-line no-control-regex
const FORMATTING = /\x03\d{0,2}(?:,\d{1,2})?|\x04[0-9A-Fa-f]{6}(?:,[0-9A-Fa-f]{6})?|[\x00-\x1f]/g;

/** Strips mIRC colour and formatting codes, leaving the plain text. */
function stripFormatting(text: string): string {
  return text.replace(FORMATTING, '');
}

const SIZE = /^([\d.]+)\s*([KMGT])?B?$/i;

const UNIT_BYTES: Readonly<Record<string, number>> = {
  '': 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
};

/**
 * Parses a human-readable size like `2.2G` or `383K` into bytes.
 *
 * Returns undefined for anything it cannot read, so a strange size never turns
 * into a wildly wrong number that would then sort or cap incorrectly. Uses
 * binary units (1024), which is what the serving software counts in.
 */
export function parseHumanSize(text: string): number | undefined {
  const match = SIZE.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const unit = (match[2] ?? '').toUpperCase();
  const multiplier = UNIT_BYTES[unit];
  if (multiplier === undefined) {
    return undefined;
  }
  return Math.round(value * multiplier);
}

/**
 * Parses an XDCC pack announcement, or returns undefined for anything that is
 * not one.
 *
 * Deliberately strict about the leading `#<n> <n>x [<size>]` shape: channel
 * chatter that merely mentions a `#123` must not be mistaken for an offer.
 */
export function parseXdccAnnounce(text: string): XdccPack | undefined {
  const match = ANNOUNCE.exec(stripFormatting(text));
  if (match === null) {
    return undefined;
  }

  const pack = Number(match[1]);
  const gets = Number((match[2] ?? '').replace(/,/g, ''));
  const sizeText = match[3] ?? '';
  const filename = match[4] ?? '';

  if (!Number.isSafeInteger(pack) || !Number.isSafeInteger(gets) || filename === '') {
    return undefined;
  }

  const sizeBytes = parseHumanSize(sizeText);

  return {
    pack,
    gets,
    sizeText,
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    filename,
  };
}

/**
 * What a serving bot said back about a pack we asked for.
 *
 * `XDCC SEND` is fire-and-forget: the bot answers with an ordinary NOTICE, and
 * whether that notice says "you are fourth in the queue" or "you are not in one
 * of my channels" is the difference between waiting and never being sent
 * anything. Without reading them a requested pack is a spinner that either
 * turns into a file or stays a spinner forever, which is exactly the experience
 * this client exists to remove.
 */
export type XdccResponseKind =
  /** The request was accepted and put in a queue; nothing transfers yet. */
  | 'queued'
  /** The bot is about to open the transfer. A `DCC SEND` follows. */
  | 'sending'
  /**
   * The bot has opened its socket and is waiting for us to connect to it.
   *
   * Distinct from `sending` because it is the bot saying the offer is on the
   * table and unanswered — the state a transfer sits in while nothing is
   * happening, and the one that ends in a timeout if nothing does.
   */
  | 'awaiting-connection'
  /** The request was turned down. See {@link XdccResponse.reason}. */
  | 'denied'
  /** A queued request was taken out of the queue, by us or by the bot. */
  | 'dequeued';

/** Why a bot turned a request down, in the terms the interface explains it in. */
export type XdccDenialReason =
  /** The bot only serves people in one of its channels. */
  | 'not-in-channel'
  /** Every send slot and every queue place is taken. */
  | 'slots-full'
  /** We have already asked for this pack, or asked for as many as it allows. */
  | 'already-queued'
  /** We already have as many transfers running as the bot permits. */
  | 'transfer-limit'
  /** There is no such pack number. */
  | 'no-such-pack'
  /** The bot is not accepting requests at the moment. */
  | 'closed'
  /**
   * The bot gave up waiting for us to connect to the transfer it opened.
   *
   * Not a refusal at all, which is why it is worth telling apart from one: the
   * bot did everything right and the connection never arrived, so the thing to
   * look at is what sits between the two machines.
   */
  | 'dcc-timeout'
  /** Refused, for a reason we do not have a specific translation for. */
  | 'other';

/** A serving bot's answer to an `XDCC SEND`. */
export interface XdccResponse {
  readonly kind: XdccResponseKind;
  /** The pack the notice is about, where it named one. */
  readonly pack?: number;
  /** Our place in the queue, where the bot gave one. */
  readonly position?: number;
  /** How long the bot says the wait is, verbatim, e.g. `10m`. */
  readonly waitText?: string;
  /** Why the request was refused. Present only when `kind` is `denied`. */
  readonly reason?: XdccDenialReason;
  /** The notice itself, stripped of formatting and its leading `**` marker. */
  readonly text: string;
}

/** The `**`, `*` or `-` marker iroffer-style bots put in front of every notice. */
const NOTICE_MARKER = /^\s*[*-]+\s*/;

/** `pack 123`, `item #123`, or a bare `#123` — whichever the notice used. */
const PACK_IN_TEXT = /(?:\b(?:pack|item)\s*#?(\d+))|#(\d+)/i;

/** `in position 4`, `queue position 4`, `you are 4th`. */
const QUEUE_POSITION = /(?:in |queue )?position\s*#?(\d+)|\byou are\s+(\d+)(?:st|nd|rd|th)\b/i;

/** `Estimated wait: 10m`, `estimated time remaining 2h 5m`. */
const QUEUE_WAIT = /estimated\s+(?:wait|time)(?:\s+remaining)?\s*[:\s]\s*([^.,;]+)/i;

/**
 * The denial phrases, in the order they are tried.
 *
 * Order is load-bearing rather than incidental: several of these co-occur in
 * one notice and the more specific reading has to win. "Closing Connection: You
 * must be on a known channel" is a channel problem, not a bot that has shut its
 * doors, and "You already have that item queued" is a refusal even though it
 * says queued.
 */
const DENIALS: readonly (readonly [XdccDenialReason, RegExp])[] = [
  ['dcc-timeout', /dcc\s+timeout|transfer\s+timed?\s*out/i],
  [
    'already-queued',
    /already\s+(?:have\s+(?:that|this)\s+\w+\s+)?queued|already\s+requested|already\s+queued\s+for/i,
  ],
  [
    'not-in-channel',
    /(?:known|listed|my)\s+channel|must\s+be\s+(?:on|in)\b[^.]*channel|join\b[^.]*channel\b[^.]*(?:first|before)/i,
  ],
  [
    'no-such-pack',
    /invalid\s+pack|no\s+such\s+pack|unknown\s+pack|pack\s+number[^.]*(?:invalid|does\s*n[o']?t\s+exist)/i,
  ],
  [
    'transfer-limit',
    /transfer\s+(?:limit|already\s+running)|(?:only\s+have|already\s+have|can\s+only\s+have)\s+\d*\s*transfers?|too\s+many\s+transfers?|one\s+transfer\s+at\s+a\s+time/i,
  ],
  [
    'slots-full',
    /(?:all|no)\b[^.]*slots?\b[^.]*(?:full|available|free)|queue(?:s)?\s+(?:is|are)\s+full|main\s+queue\s+is\s+full/i,
  ],
  [
    'closed',
    /no\s+new\s+connections|not\s+accepting|bot\s+owner\s+has\s+requested|closing\s+connection/i,
  ],
  ['other', /\bdenied\b|\brefused\b|\bnot\s+allowed\b/i],
];

const SENDING = /sending\s+you\b|starting\s+(?:the\s+)?transfer|transfer\s+starting/i;
const AWAITING = /you\s+have\s+a\s+dcc\s+pending|set\s+your\s+client\s+to\s+receive/i;
const QUEUED =
  /(?:added\s+you|placed\s+you|you\s+(?:are|were)\s+added)\b[^.]*queue|queue[^.]*position|position[^.]*queue/i;
const DEQUEUED =
  /removed\s+you\s+from\b[^.]*queue|removed\s+from\s+the\s+queue|(?:your\s+)?queue(?:d)?\s+(?:request|entry)\s+(?:was\s+)?(?:removed|cancell?ed)/i;

function packIn(text: string): number | undefined {
  const match = PACK_IN_TEXT.exec(text);
  if (match === null) {
    return undefined;
  }
  const pack = Number(match[1] ?? match[2]);
  return Number.isSafeInteger(pack) ? pack : undefined;
}

/**
 * Reads a serving bot's answer to an `XDCC SEND`, or returns undefined for
 * anything that is not one.
 *
 * Deliberately conservative: a notice that matches none of the known shapes is
 * not guessed at, because a wrong reading would move a row to a state the bot
 * never put it in. It is meant to be consulted only for notices from a bot we
 * have an outstanding request to — an ordinary NOTICE from anyone else is none
 * of its business, and the caller enforces that rather than this module trying
 * to infer it.
 */
export function parseXdccResponse(text: string): XdccResponse | undefined {
  const clean = stripFormatting(text).replace(NOTICE_MARKER, '').trim();
  if (clean === '') {
    return undefined;
  }

  const pack = packIn(clean);
  const withPack = pack === undefined ? {} : { pack };

  if (DEQUEUED.test(clean)) {
    return { kind: 'dequeued', ...withPack, text: clean };
  }

  // Refusals are read before the queue and send confirmations: "You already
  // have that item queued" and "All slots full" both contain the vocabulary of
  // an acceptance while being the opposite of one. The one exception is a bot
  // that says both — "All slots full, added you to the main queue in position
  // 4" is an acceptance — so a stated queue position outranks the refusal.
  const position = QUEUE_POSITION.exec(clean);
  const queuedWithPosition = position !== null && QUEUED.test(clean);

  if (!queuedWithPosition) {
    for (const [reason, pattern] of DENIALS) {
      if (pattern.test(clean)) {
        return { kind: 'denied', reason, ...withPack, text: clean };
      }
    }
  }

  // Read before the send confirmation: a reminder that a transfer is sitting
  // there unanswered often says "sending" somewhere in the same breath, and the
  // two mean quite different things to a row that is waiting.
  if (AWAITING.test(clean)) {
    return { kind: 'awaiting-connection', ...withPack, text: clean };
  }

  if (SENDING.test(clean)) {
    return { kind: 'sending', ...withPack, text: clean };
  }

  if (position !== null || QUEUED.test(clean)) {
    const place = Number(position?.[1] ?? position?.[2]);
    const wait = QUEUE_WAIT.exec(clean);
    return {
      kind: 'queued',
      ...withPack,
      ...(Number.isSafeInteger(place) && place > 0 ? { position: place } : {}),
      ...(wait === null ? {} : { waitText: (wait[1] ?? '').trim() }),
      text: clean,
    };
  }

  return undefined;
}

/**
 * A pack request written out the way the search sites and the wikis write it.
 *
 * Every XDCC index on the web hands a person the same two things — an
 * `irc://` link to the network and channel, and a literal `/msg Bot xdcc send
 * #123` to paste — so those two strings, and not a pack number typed into a
 * form, are what people actually arrive holding.
 */
export interface XdccRequest {
  /** The bot to ask. */
  readonly nick: string;
  readonly pack: number;
  /** The server named by an accompanying `irc://` link, where there was one. */
  readonly host?: string;
  readonly port?: number;
  /** Whether the link asked for TLS (`ircs://`, or the `,needssl` flag). */
  readonly tls?: boolean;
  /** The channel named by the link, with its `#` — bots serve only their own. */
  readonly channel?: string;
}

// irc://host[:port]/[#]channel[,flags] and the ircs:// TLS form. The channel is
// optional: a link to a network with no channel is still worth reading for the
// host. `%23` is the escaped `#` these links usually carry.
const IRC_URL = /\b(ircs?):\/\/([^\s/:,]+)(?::(\d+))?(?:\/([^\s,]*))?((?:,[^\s,]+)*)/i;

// [/]msg|ctcp|privmsg <nick> xdcc send #<pack>, and the bare `<nick> xdcc send
// #<pack>` that people paste just as often. `xdcc` may be `cdcc` on some bots.
const SEND_REQUEST =
  /(?:^|\s)(?:\/?(?:msg|privmsg|ctcp|query)\s+)?([^\s#&,:]+)\s+[xc]dcc\s+send\s+#?(\d+)/i;

/**
 * Reads a pasted XDCC request — an `irc://` link, a `/msg bot xdcc send #123`
 * line, or the two together — into something the file monitor can act on.
 *
 * Returns undefined unless a bot and a pack number could both be read, since
 * without those there is nothing to ask for. The link's host and channel are
 * extra: they say where the request belongs, so a paste can be matched against
 * the networks already connected rather than assuming the one on screen.
 */
export function parseXdccRequest(text: string): XdccRequest | undefined {
  const clean = stripFormatting(text).trim();
  const send = SEND_REQUEST.exec(clean);
  if (send === null) {
    return undefined;
  }

  const nick = send[1] ?? '';
  const pack = Number(send[2]);
  if (nick === '' || !Number.isSafeInteger(pack)) {
    return undefined;
  }

  const url = IRC_URL.exec(clean);
  if (url === null) {
    return { nick, pack };
  }

  const scheme = (url[1] ?? '').toLowerCase();
  const host = url[2] ?? '';
  const portText = url[3];
  const path = decodeURIComponent(url[4] ?? '').trim();
  const flags = (url[5] ?? '').toLowerCase();
  const tls = scheme === 'ircs' || flags.includes('needssl') || flags.includes('needtls');
  const port = portText === undefined ? undefined : Number(portText);
  // A path of `,isnick` names a person rather than a channel; anything else is
  // a channel, whether or not the link bothered with the `#`.
  const channel = path === '' || flags.includes('isnick') ? undefined : addChannelPrefix(path);

  return {
    nick,
    pack,
    ...(host === '' ? {} : { host }),
    ...(port !== undefined && Number.isSafeInteger(port) && port > 0 && port <= 0xffff
      ? { port }
      : {}),
    ...(tls ? { tls } : {}),
    ...(channel === undefined ? {} : { channel }),
  };
}

/** Adds the `#` an `irc://` link is allowed to leave off its channel. */
function addChannelPrefix(name: string): string {
  return /^[#&!+]/.test(name) ? name : `#${name}`;
}
