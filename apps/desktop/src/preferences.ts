/**
 * Settings that outlive a launch, on desktop.
 *
 * One JSON file, read whole and written whole. Rust owns the file; the shape is
 * decided here, which is the same split the log store and the transport follow.
 *
 * Nothing read from this file is trusted as-is. It is a file on somebody's own
 * disk, editable by hand and by anything else running as them, so what comes
 * back is checked field by field — a malformed one starts over with blanks
 * rather than putting `undefined` where the shell expects a string.
 */

import { invoke } from '@tauri-apps/api/core';
import { EMPTY_IDENTITY, type PreferenceStore, type StoredPreferences } from '@marmotter/shared';

/** A string field, or an empty one if the file did not have a usable value. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function parse(raw: string): StoredPreferences | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A file that is not JSON is treated as no file: better a first run than a
    // crash on every launch until somebody deletes it by hand.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const identity = (parsed as { identity?: unknown }).identity;
  const fields = typeof identity === 'object' && identity !== null ? identity : {};
  return {
    identity: {
      ...EMPTY_IDENTITY,
      nick: text((fields as Record<string, unknown>)['nick']),
      altNick: text((fields as Record<string, unknown>)['altNick']),
      thirdNick: text((fields as Record<string, unknown>)['thirdNick']),
      realname: text((fields as Record<string, unknown>)['realname']),
      email: text((fields as Record<string, unknown>)['email']),
    },
  };
}

export function createDesktopPreferences(): PreferenceStore {
  return {
    async load() {
      const raw = await invoke<string | null>('prefs_read');
      return raw === null ? undefined : parse(raw);
    },
    async save(preferences) {
      await invoke('prefs_write', { contents: JSON.stringify(preferences, null, 2) });
    },
  };
}

export { parse as parsePreferences };
