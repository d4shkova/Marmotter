/**
 * The channels a network joins on its own.
 *
 * The list has always been in the profile and has always been sent after
 * registration — it simply had nowhere to be typed. These are the two shapes it
 * is edited through: a line of text in the network form, and a toggle on a
 * channel already open in the sidebar.
 *
 * A channel joined with a key keeps it. The key is a `SecretRef` living in the
 * keychain, and neither editing route can see the secret itself, so both are
 * careful to carry the reference across rather than rebuild the entry without
 * it — retyping the channel name must not silently drop its password.
 */

import type { CaseMapping } from '@marmotter/protocol';
import { fold } from '@marmotter/protocol';
import type { AutojoinTarget } from '@marmotter/shared';

/**
 * Reads a typed list of channels.
 *
 * Commas and whitespace both separate, because both are what people type and
 * neither is valid inside a channel name. Duplicates collapse under the
 * network's own casemapping, so `#Marmotter` typed twice is one entry rather
 * than two joins of the same room.
 *
 * Existing entries are matched by name and carried through whole, which is what
 * keeps a channel's saved key attached to it across an edit.
 */
export function parseAutojoin(
  text: string,
  existing: readonly AutojoinTarget[] = [],
  mapping: CaseMapping = 'rfc1459',
): AutojoinTarget[] {
  const keyed = new Map(existing.map((entry) => [fold(entry.target, mapping), entry]));
  const seen = new Set<string>();
  const parsed: AutojoinTarget[] = [];

  for (const name of text.split(/[\s,]+/)) {
    if (name === '') {
      continue;
    }
    const key = fold(name, mapping);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    // The saved entry where there is one, so its key survives; otherwise the
    // name as typed, since that is all there is to go on.
    parsed.push(keyed.get(key) ?? { target: name });
  }

  return parsed;
}

/** Writes the list back out for the text field, in the order it is stored. */
export function formatAutojoin(targets: readonly AutojoinTarget[]): string {
  return targets.map((entry) => entry.target).join(', ');
}

/** Whether a channel is on the list. */
export function isAutojoined(
  targets: readonly AutojoinTarget[],
  target: string,
  mapping: CaseMapping = 'rfc1459',
): boolean {
  const key = fold(target, mapping);
  return targets.some((entry) => fold(entry.target, mapping) === key);
}

/**
 * Adds a channel to the list, or takes it off.
 *
 * Returns the same array when nothing changed, so a caller can skip writing a
 * profile back for a toggle that was already in the state asked for.
 */
export function toggleAutojoin(
  targets: readonly AutojoinTarget[],
  target: string,
  mapping: CaseMapping = 'rfc1459',
): AutojoinTarget[] {
  const key = fold(target, mapping);
  const without = targets.filter((entry) => fold(entry.target, mapping) !== key);

  // Removing: the filter already did it.
  if (without.length !== targets.length) {
    return without;
  }
  // Adding: at the end, so the order somebody typed is the order they keep.
  return [...targets, { target }];
}
