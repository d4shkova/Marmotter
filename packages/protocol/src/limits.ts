/**
 * Wire-format size limits from RFC 1459 / 2812 and IRCv3 `message-tags`.
 *
 * Deliberately dependency-free and global-free: `packages/protocol` compiles
 * against the ES2022 core library only, so byte counting is done by hand rather
 * than through `TextEncoder` or `Buffer`.
 */

/** Maximum bytes of a message including the trailing CRLF. */
export const MAX_MESSAGE_BYTES = 512;

/** Maximum bytes of the tag section, including the leading `@`, per IRCv3. */
export const MAX_CLIENT_TAG_BYTES = 4096;
export const MAX_SERVER_TAG_BYTES = 8191;

/** Bytes consumed by the CRLF terminator every message carries. */
export const CRLF_BYTES = 2;

/**
 * UTF-8 byte length of a JavaScript string.
 *
 * Unpaired surrogates are counted as the 3-byte U+FFFD replacement character,
 * which is how they will be transmitted once encoded.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Whether a line fits the 512-byte message limit once CRLF is appended.
 *
 * The tag section is measured separately by the server, so it is excluded here.
 */
export function fitsMessageLimit(line: string): boolean {
  return utf8ByteLength(line) + CRLF_BYTES <= MAX_MESSAGE_BYTES;
}
