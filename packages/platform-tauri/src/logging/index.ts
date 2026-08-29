/**
 * The log store the desktop and Android shells share.
 *
 * Picks the format the policy asks for and hands back a `LogStore`. The web
 * build has no counterpart to this file, deliberately: there is no browser
 * implementation to import, so there is no path by which message content could
 * be written anywhere in that build. See `packages/shared/src/logging.ts`.
 */

import { invoke } from '@tauri-apps/api/core';
import { formatLine } from '@marmotter/client';
import type { LogStore, LoggingPolicy } from '@marmotter/shared';
import { type LogFileInfo, createPlaintextLogStore } from './plaintext.js';
import { createSqliteLogStore } from './sqlite.js';

interface RustLogFile {
  readonly name: string;
  readonly bytes: number;
  readonly modified_ms: number;
}

/** The Rust side, which owns the file handles and nothing else. */
const files = {
  async defaultDir(): Promise<string> {
    return invoke<string>('log_default_dir');
  },
  async append(root: string, name: string, text: string): Promise<void> {
    await invoke('log_append', { root, name, text });
  },
  async read(root: string, name: string): Promise<string> {
    return invoke<string>('log_read', { root, name });
  },
  async list(root: string): Promise<readonly LogFileInfo[]> {
    const listed = await invoke<RustLogFile[]>('log_list', { root });
    return listed.map((file) => ({
      name: file.name,
      bytes: file.bytes,
      modifiedMs: file.modified_ms,
    }));
  },
  async write(root: string, name: string, text: string): Promise<void> {
    await invoke('log_write', { root, name, text });
  },
  async remove(root: string, name: string): Promise<void> {
    await invoke('log_delete', { root, name });
  },
  async reveal(root: string): Promise<void> {
    await invoke('log_reveal', { root });
  },
  /**
   * Writes an export, which the user placed outside the log folder.
   *
   * The folder-relative commands refuse a path that climbs out of the log
   * folder, which is exactly right for a channel name and exactly wrong for a
   * file somebody chose in a save dialog. So an export is written with the
   * chosen file's own folder as the root and its name as the name.
   */
  async writeAbsolute(path: string, text: string): Promise<void> {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const root = cut <= 0 ? path : path.slice(0, cut);
    const name = cut < 0 ? path : path.slice(cut + 1);
    await invoke('log_write', { root, name, text });
  },
};

/** The same file operations with the folder-opening one taken off. */
const { reveal: _reveal, ...withoutReveal } = files;

export interface LogStoreOptions {
  readonly policy: LoggingPolicy;
  /** Maps a network's display name back to its ID, for plaintext search hits. */
  readonly networkIdFor: (networkName: string) => string;
  /**
   * Whether this platform can show the log folder in a file manager.
   *
   * True on desktop. False on Android, where the logs sit in the app's own
   * storage — not a folder any file manager will open, and not a `log_reveal`
   * command that shell registers. The store leaves `reveal` off when this is
   * false and the settings screen hides the button rather than offering one
   * that does nothing.
   */
  readonly revealFolder?: boolean;
}

/**
 * Where logs go when the policy names no folder.
 *
 * `<app data>/logs` for plaintext, and a single database file beside it for
 * SQLite. Resolved through Rust because only the shell knows what the app data
 * directory is on this platform.
 */
export async function defaultLogFolder(): Promise<string> {
  return files.defaultDir();
}

/** Builds the store the policy asks for. */
export async function createLogStore(options: LogStoreOptions): Promise<LogStore> {
  const root = options.policy.path ?? (await defaultLogFolder());
  const revealable = options.revealFolder ?? true;

  if (options.policy.format === 'plaintext') {
    return createPlaintextLogStore({
      root,
      // The key is left off rather than set to undefined: with
      // `exactOptionalPropertyTypes` those are not the same thing, and only the
      // absent one reads as "this platform cannot do that".
      fs: revealable ? files : withoutReveal,
      networkIdFor: options.networkIdFor,
    });
  }

  return createSqliteLogStore({
    // tauri-plugin-sql resolves a bare filename inside the app data directory,
    // which is where a database with no folder chosen belongs.
    path: options.policy.path === undefined ? 'marmotter-logs.db' : `${root}/marmotter-logs.db`,
    writeFile: files.writeAbsolute,
    ...(revealable
      ? {
          reveal: async (path: string) => {
            const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
            await files.reveal(cut <= 0 ? await defaultLogFolder() : path.slice(0, cut));
          },
        }
      : {}),
    formatLine,
  });
}

export { createPlaintextLogStore, createSqliteLogStore };
