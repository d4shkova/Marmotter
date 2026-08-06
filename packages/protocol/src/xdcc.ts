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
