/**
 * Where a password lives between being typed and being sent.
 *
 * CLAUDE.md is explicit about this: profile state never holds a secret, only a
 * `SecretRef` pointing at one. On desktop that reference resolves against the OS
 * keychain and on web against an in-memory session store — but the keychain
 * arrives with profile persistence, and until then nothing in this client
 * outlives the process anyway. A profile that dies with the window has no
 * business writing its password anywhere that does not.
 *
 * So this is the in-memory store, used on every platform for now. When a
 * platform gains a real one it is passed to `Marmotter` as `resolveSecret` and
 * consulted first; this stays as the fallback for anything it does not hold.
 *
 * A `Map` in module scope rather than React state on purpose. Nothing here may
 * end up in a render tree, a devtools snapshot, or a serialized store — and a
 * secret in Zustand is one `JSON.stringify` away from all three.
 */

import type { SecretRef } from '@marmotter/shared';

const store = new Map<string, string>();

let counter = 0;

/** Keeps a secret and hands back the reference that stands in for it. */
export function putSecret(value: string): SecretRef {
  counter += 1;
  const id = `secret:${counter}:${Math.random().toString(36).slice(2)}`;
  store.set(id, value);
  return { kind: 'secret-ref', id };
}

/** Replaces what a reference points at, keeping the reference itself valid. */
export function replaceSecret(ref: SecretRef, value: string): SecretRef {
  store.set(ref.id, value);
  return ref;
}

/** The secret a reference stands for, or undefined once it has been forgotten. */
export function readSecret(ref: SecretRef): string | undefined {
  return store.get(ref.id);
}

/** Whether anything is stored for a reference. */
export function hasSecret(ref: SecretRef | undefined): boolean {
  return ref !== undefined && store.has(ref.id);
}

/** Forgets one, for a profile that has been removed or had its auth changed. */
export function forgetSecret(ref: SecretRef | undefined): void {
  if (ref !== undefined) {
    store.delete(ref.id);
  }
}

/** Forgets everything. For tests, and for signing out of the whole client. */
export function forgetAllSecrets(): void {
  store.clear();
}
