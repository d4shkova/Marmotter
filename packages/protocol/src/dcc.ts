/**
 * DCC offer parsing.
 *
 * DCC ("Direct Client-to-Client") negotiates a file transfer over IRC, but the
 * bytes never touch the IRC server: the sender advertises an address and port
 * in a CTCP message, and the receiver opens a second, direct TCP connection to
 * fetch the file. This module does only the pure part — turning the advertised
 * `DCC SEND` line into a structured offer. Opening the socket and writing the
 * file is I/O, so it lives in the Rust transport crate, never here.
 *
 * Nothing is acted on automatically. A parsed offer is surfaced to the file
 * monitor, which the user has to have switched on, and a download only ever
 * happens because they clicked one. Sending files, DCC CHAT, and reverse
 * transfers we would have to listen for are all out of scope: this is a passive
 * receiver.
 */

import type { CtcpMessage } from './ctcp.js';

/** A file somebody has advertised over `DCC SEND`. */
export interface DccSend {
  /** The advertised name, already stripped of any surrounding quotes. */
  readonly filename: string;
  /** The host to connect to, as a dotted IPv4 or a bracketless IPv6 string. */
  readonly host: string;
  /** The TCP port to connect to. Zero for a passive (reverse) offer. */
  readonly port: number;
  /** File size in bytes, where the sender advertised one. */
  readonly size?: number;
  /**
   * The token from a passive (reverse) offer, where present.
   *
   * A passive offer asks us to open the listening socket instead of the sender,
   * which is out of scope for a receive-only monitor. It is parsed so the
   * offer can be shown and clearly marked as one we cannot fetch, rather than
   * silently dropped.
   */
  readonly token?: string;
  /** Whether this is a passive (reverse) offer, which cannot be downloaded. */
  readonly passive: boolean;
  /**
   * Whether the transfer itself is TLS, from an `SSEND` offer.
   *
   * The socket is a TLS connection rather than a plain one, so a receiver that
   * dials it in the clear connects, sends nothing the sender recognises, and
   * both ends sit there until the sender's timeout — which looks exactly like a
   * firewall and is not one. It is carried here so the downloader can bring up
   * the handshake instead of guessing from the port.
   */
  readonly secure: boolean;
  /**
   * Whether the sender is in "turbo" mode, from a `TSEND` offer.
   *
   * Turbo means the sender streams without waiting for the four-byte
   * acknowledgements ordinary DCC expects, and does not read its socket at all.
   * Acknowledging anyway is not merely wasted: the unread bytes fill the send
   * buffer and the write blocks, stalling a transfer that was working.
   */
  readonly turbo: boolean;
}

/**
 * The `DCC` subcommands that advertise a file, and what each one means.
 *
 * `SEND` is the ordinary one. The letters in front of it are the two variants
 * clients have added since: `S` for a TLS socket, `T` for "turbo", where the
 * sender streams without waiting to be acknowledged. Both change how the
 * receiving socket has to be driven, so they are read here rather than
 * flattened into "it is a send" — which is what made a secure offer look like
 * an unreachable one.
 */
const SEND_SUBCOMMANDS: ReadonlyMap<string, { secure: boolean; turbo: boolean }> = new Map([
  ['SEND', { secure: false, turbo: false }],
  ['SSEND', { secure: true, turbo: false }],
  ['TSEND', { secure: false, turbo: true }],
  ['TSSEND', { secure: true, turbo: true }],
  ['STSEND', { secure: true, turbo: true }],
]);

/** The largest value the integer address form can hold: an unsigned 32-bit int. */
const MAX_IPV4_INTEGER = 0xffffffff;

/**
 * The address field, normalised to something a socket can dial.
 *
 * The classic form is an unsigned 32-bit integer in host byte order — the whole
 * reason DCC looks arcane — but modern senders also send a dotted IPv4 or a
 * bracketed IPv6 literal, so all three are accepted. An address that is none of
 * these is rejected rather than guessed at.
 */
function parseAddress(raw: string): string | undefined {
  if (raw === '') {
    return undefined;
  }

  // A bracketed literal is an IPv6 address; keep the inside, drop the brackets.
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1);
  }

  // Anything with a colon is already an IPv6 literal.
  if (raw.includes(':')) {
    return raw;
  }

  // All digits is the integer form, unless it is already a dotted quad.
  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_IPV4_INTEGER) {
      return undefined;
    }
    const a = (value >>> 24) & 0xff;
    const b = (value >>> 16) & 0xff;
    const c = (value >>> 8) & 0xff;
    const d = value & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }

  // A dotted quad passes through unchanged.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    return raw;
  }

  return undefined;
}

/**
 * Splits the parameters after `DCC SEND` into the filename and the rest.
 *
 * The filename comes first and may be wrapped in double quotes when it contains
 * spaces. An unterminated opening quote is treated as running to the end of the
 * field, which is what the few clients that emit them intend.
 */
function splitFilename(rest: string): { filename: string; remainder: string } | undefined {
  if (rest === '') {
    return undefined;
  }

  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1);
    if (close === -1) {
      return { filename: rest.slice(1), remainder: '' };
    }
    return { filename: rest.slice(1, close), remainder: rest.slice(close + 1).trim() };
  }

  const space = rest.indexOf(' ');
  if (space === -1) {
    return { filename: rest, remainder: '' };
  }
  return { filename: rest.slice(0, space), remainder: rest.slice(space + 1).trim() };
}

/**
 * Parses a `DCC SEND` offer, or returns undefined for anything that is not one.
 *
 * Returns undefined — rather than throwing — for a malformed line, a different
 * DCC subcommand (CHAT, RESUME), or a non-DCC CTCP, so the caller can fall back
 * to treating it as an ordinary unhandled CTCP.
 */
export function parseDccSend(ctcp: CtcpMessage): DccSend | undefined {
  if (ctcp.command !== 'DCC') {
    return undefined;
  }

  const space = ctcp.params.indexOf(' ');
  if (space === -1) {
    return undefined;
  }
  const subcommand = ctcp.params.slice(0, space).toUpperCase();
  const variant = SEND_SUBCOMMANDS.get(subcommand);
  if (variant === undefined) {
    return undefined;
  }

  const split = splitFilename(ctcp.params.slice(space + 1).trim());
  if (split === undefined || split.filename === '') {
    return undefined;
  }

  const fields = split.remainder.split(/\s+/).filter((field) => field !== '');
  const [address, portField, sizeField, token] = fields;
  if (address === undefined || portField === undefined) {
    return undefined;
  }

  const host = parseAddress(address);
  if (host === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(portField)) {
    return undefined;
  }
  const port = Number(portField);
  if (!Number.isSafeInteger(port) || port < 0 || port > 0xffff) {
    return undefined;
  }

  let size: number | undefined;
  if (sizeField !== undefined && /^\d+$/.test(sizeField)) {
    const parsed = Number(sizeField);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      size = parsed;
    }
  }

  // A port of zero is a passive offer: the sender wants us to listen, which a
  // receive-only monitor does not do. The token identifies it either way.
  const passive = port === 0;

  return {
    filename: split.filename,
    host,
    port,
    ...(size === undefined ? {} : { size }),
    ...(token === undefined ? {} : { token }),
    passive,
    secure: variant.secure,
    turbo: variant.turbo,
  };
}

/**
 * A filename reduced to something safe to write to disk.
 *
 * The name in a DCC offer is chosen by a stranger, so it is treated as hostile:
 * any directory part is dropped so the file cannot escape the chosen folder,
 * path separators and NULs are removed, and the reserved names `.` and `..` are
 * replaced. The Rust side sanitises again before it writes — this is the first
 * of two checks, not the only one — and also refuses to overwrite.
 */
export function sanitizeDccFilename(name: string): string {
  // Take only the last path component, splitting on both separators so a
  // Windows-style name is handled the same as a POSIX one.
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    // Control characters, NUL and the ones Windows forbids in a name.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '')
    .trim();

  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    return 'download';
  }
  return cleaned;
}

/**
 * The reply that answers a passive (reverse) offer.
 *
 * A passive offer is the sender saying it cannot be connected to — it is behind
 * something — and asking us to open the socket instead. The answer is a `DCC
 * SEND` of our own carrying the same filename, size and token, with our address
 * and the port we are listening on in place of the sender's. The token is what
 * ties it back to the offer, so it is copied verbatim rather than regenerated.
 *
 * Returns the CTCP parameters, to be wrapped by {@link encodeCtcp} and sent as
 * a `PRIVMSG` to the sender.
 */
export function buildPassiveAccept(reply: {
  readonly filename: string;
  readonly host: string;
  readonly port: number;
  readonly size?: number;
  readonly token: string;
}): string {
  // Quoted whenever it could be read as more than one field. A name with a
  // space in it is common and an unquoted one silently truncates the transfer
  // to its first word.
  const name = /[\s"]/.test(reply.filename)
    ? `"${reply.filename.replace(/"/g, '')}"`
    : reply.filename;
  const size = reply.size === undefined ? '' : ` ${reply.size}`;
  return `SEND ${name} ${encodeAddress(reply.host)} ${reply.port}${size} ${reply.token}`;
}

/**
 * An address in the form a DCC offer carries it.
 *
 * IPv4 goes out as the unsigned 32-bit integer every client has always sent,
 * because a receiver written to the original convention will read nothing else.
 * IPv6 has no such convention and goes out as the literal.
 */
function encodeAddress(host: string): string {
  const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (quad === null) {
    return host;
  }
  const parts = quad.slice(1).map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part > 255)) {
    return host;
  }
  // Unsigned: the top bit set must not come out negative.
  return String(
    ((parts[0] ?? 0) * 0x1000000 +
      (parts[1] ?? 0) * 0x10000 +
      (parts[2] ?? 0) * 0x100 +
      (parts[3] ?? 0)) >>>
      0,
  );
}
