/**
 * The shape of a single IRC message, after parsing and before serialization.
 */

/**
 * A message source, split into its `nick!user@host` parts.
 *
 * Servers send a bare server name as the source too, in which case only `nick`
 * is populated — the protocol gives no way to tell a server name from a nick by
 * syntax alone, so callers decide from context.
 */
export interface Source {
  /** The source exactly as it appeared, without the leading colon. */
  readonly raw: string;
  readonly nick: string;
  /** Empty when the source carried no `!user` part. */
  readonly user: string;
  /** Empty when the source carried no `@host` part. */
  readonly host: string;
}

/**
 * IRCv3 message tags.
 *
 * A `Map` rather than an object: tag names come from the network, and a tag
 * called `__proto__` or `constructor` must not be able to reach an object
 * prototype. Insertion order is preserved so serialization is stable.
 */
export type Tags = ReadonlyMap<string, string>;

export interface IrcMessage {
  readonly tags: Tags;
  /** Absent when the message arrived without a source prefix. */
  readonly source: Source | undefined;
  /**
   * The verb, uppercased. Numeric replies are the three-digit string, zero
   * padded, exactly as received — `001`, not `1`.
   */
  readonly command: string;
  /**
   * The verb as it appeared on the wire, present only when it differed from
   * `command`. Serialization prefers it so a parse/serialize round trip is
   * byte-exact.
   */
  readonly rawCommand: string | undefined;
  readonly params: readonly string[];
}

/** The fields a caller must supply to build an outgoing message. */
export interface OutgoingMessage {
  readonly tags?: Tags;
  readonly source?: Source | undefined;
  readonly command: string;
  readonly rawCommand?: string | undefined;
  readonly params?: readonly string[];
}

const NO_TAGS: Tags = new Map();

/** Builds a message with the optional fields defaulted. */
export function message(init: OutgoingMessage): IrcMessage {
  return {
    tags: init.tags ?? NO_TAGS,
    source: init.source,
    command: init.command,
    rawCommand: init.rawCommand,
    params: init.params ?? [],
  };
}

/** Uppercases ASCII only. Command verbs are ASCII by definition. */
export function upperAscii(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += code >= 0x61 && code <= 0x7a ? String.fromCharCode(code - 0x20) : value[i];
  }
  return out;
}

/** Whether a message carries the given verb, compared case-insensitively. */
export function isCommand(msg: IrcMessage, verb: string): boolean {
  return msg.command === upperAscii(verb);
}

/** Whether a verb is a three-digit numeric reply. */
export function isNumeric(command: string): boolean {
  return (
    command.length === 3 &&
    command.charCodeAt(0) >= 0x30 &&
    command.charCodeAt(0) <= 0x39 &&
    command.charCodeAt(1) >= 0x30 &&
    command.charCodeAt(1) <= 0x39 &&
    command.charCodeAt(2) >= 0x30 &&
    command.charCodeAt(2) <= 0x39
  );
}

/** Reads a positional parameter, or the empty string when it is absent. */
export function param(msg: IrcMessage, index: number): string {
  return msg.params[index] ?? '';
}
