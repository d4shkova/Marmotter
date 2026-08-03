/**
 * Deterministic nick colouring.
 *
 * The same person is the same colour in every channel, on every device, across
 * restarts — which is what makes the colour usable as identity rather than
 * decoration. So the hash is a fixed function of the nick and nothing else: no
 * randomness, no assignment order, no palette rotation.
 *
 * The nick is normalised first. On a network where `Tamsin` and `TAMSIN` are
 * the same account, showing them in two colours would say they are two people.
 * Casemapping proper lives in `@marmotter/protocol`; this package must not
 * depend on it, so the caller passes an already-folded nick when it has one and
 * this falls back to the ASCII rules when it does not.
 */

/** How many nick colours the palette defines. */
export const NICK_COLOR_COUNT = 8;

/**
 * FNV-1a, 32-bit.
 *
 * Chosen because it is short, has no dependencies, and spreads short strings
 * well. Nothing here is security-sensitive: the requirement is stability, not
 * unpredictability.
 */
export function hashNick(nick: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < nick.length; index += 1) {
    hash ^= nick.charCodeAt(index);
    // The FNV prime, as 32-bit multiplication that survives JS number
    // precision.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The ASCII casemapping fallback, for callers with no ISUPPORT to hand. */
const normalize = (nick: string): string => nick.toLowerCase();

/** Which of the eight nick colours a nick takes, 1-based. */
export function nickColorIndex(nick: string, folded?: string): number {
  return (hashNick(folded ?? normalize(nick)) % NICK_COLOR_COUNT) + 1;
}

/** The CSS custom property holding a nick's colour. */
export function nickColorVar(nick: string, folded?: string): string {
  return `--nick-${nickColorIndex(nick, folded)}`;
}
