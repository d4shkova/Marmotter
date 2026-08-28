/**
 * Passwords, in the platform's own keychain.
 *
 * The write side of what `resolveSecret` reads. Rust owns the keychain; this
 * decides what is filed under which key, which is the same split the log store
 * and the transport follow.
 *
 * Every call can legitimately fail — a Linux session with no Secret Service has
 * no keychain at all, and an Android device with no screen lock has no hardware
 * keystore to unlock — and none of those failures are fatal. A password that
 * cannot be saved means a client that asks for it next time, which is worse
 * than remembering it and far better than refusing to run.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SecretRef, SecretStore } from '@marmotter/shared';

export function createSecrets(): SecretStore {
  /** Asked once and remembered: probing writes to the keychain to find out. */
  let probed: Promise<boolean> | undefined;

  return {
    async available() {
      probed ??= invoke<boolean>('secret_available').catch(() => false);
      return probed;
    },

    async save(ref: SecretRef, value: string) {
      await invoke('secret_set', { key: ref.id, value });
    },

    async read(ref: SecretRef) {
      const value = await invoke<string | null>('secret_get', { key: ref.id });
      return value ?? undefined;
    },

    async forget(ref: SecretRef) {
      await invoke('secret_delete', { key: ref.id });
    },
  };
}
