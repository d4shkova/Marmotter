/**
 * Settings that outlive a launch.
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
import {
  EMPTY_IDENTITY,
  type PreferenceStore,
  type StoredPreferences,
  readStoredNetworks,
  writeStoredNetwork,
} from '@marmotter/shared';

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
  const settings = (parsed as { settings?: unknown }).settings;
  return {
    // Validated field by field in `@marmotter/shared`, which drops a profile it
    // cannot use rather than restoring a row that can only fail at connect time.
    networks: readStoredNetworks((parsed as { networks?: unknown }).networks),
    // Carried through as it was written. The shell owns this shape and
    // validates it — see `packages/ui/src/app/stored-settings.ts`.
    ...(typeof settings === 'object' && settings !== null && !Array.isArray(settings)
      ? { settings: settings as Record<string, unknown> }
      : {}),
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

export function createPreferences(): PreferenceStore {
  return {
    async load() {
      const raw = await invoke<string | null>('prefs_read');
      return raw === null ? undefined : parse(raw);
    },
    async save(preferences) {
      // Written through the profile serializer rather than by spreading, so a
      // field added to `NetworkProfile` later is never persisted without
      // somebody deciding it should be — which is how a secret reaches a file.
      const contents = JSON.stringify(
        {
          identity: preferences.identity,
          networks: preferences.networks.map(writeStoredNetwork),
          ...(preferences.settings === undefined ? {} : { settings: preferences.settings }),
        },
        null,
        2,
      );
      await invoke('prefs_write', { contents });
    },
  };
}

export { parse as parsePreferences };
