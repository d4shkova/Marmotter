/**
 * Where a password lives when it has to outlive the window.
 *
 * The same shape as `Transport` and `LogStore`: an interface the shell depends
 * on, with the platform supplying an implementation. Desktop passes one backed
 * by the OS keychain; **web passes nothing**, and a password typed there lives
 * in memory for the session and dies with the tab — which is the only honest
 * option, since a browser has nowhere to put a secret that a page cannot also
 * read.
 *
 * A `SecretRef` is the key. Profiles are written to disk carrying the key and
 * never the value, and this is the thing that turns a key back into a value.
 */

import type { AuthConfig, AutojoinTarget, SecretRef } from './profile.js';

export interface SecretStore {
  /**
   * Whether this machine actually has somewhere to keep a password.
   *
   * A Linux session with no Secret Service running — a bare window manager, a
   * container, a remote shell — has no keychain. Asked once, so the interface
   * can say so up front rather than letting somebody believe a password was
   * remembered and find out on the next launch that it was not.
   */
  available(): Promise<boolean>;
  save(ref: SecretRef, value: string): Promise<void>;
  read(ref: SecretRef): Promise<string | undefined>;
  forget(ref: SecretRef): Promise<void>;
}

/**
 * Every secret reference a profile holds, for saving or forgetting them all.
 *
 * A channel key is as much a secret as a password: it is the thing that gets
 * somebody into a private channel, and leaving one in a settings file would be
 * the same mistake in smaller print.
 */
export function secretRefsOf(profile: {
  readonly auth?: AuthConfig;
  readonly autojoin: readonly AutojoinTarget[];
}): readonly SecretRef[] {
  const refs: SecretRef[] = [];
  // `sasl-external` signs in with a certificate and carries no password, which
  // is why this reads the field rather than assuming every method has one.
  if (profile.auth !== undefined && 'password' in profile.auth) {
    refs.push(profile.auth.password);
  }
  for (const entry of profile.autojoin) {
    if (entry.key !== undefined) {
      refs.push(entry.key);
    }
  }
  return refs;
}
