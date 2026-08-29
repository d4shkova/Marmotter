/**
 * One text file, at a path the user chose in a platform dialog.
 *
 * For the settings export and import, which is the only thing in the client
 * that writes outside a folder the shell owns. The dialog itself is not here:
 * `tauri-plugin-dialog` is a desktop dependency and this package is shared with
 * Android, which has no such dialog and moves settings by copying the text
 * instead. So the app supplies the path and this does the reading and writing.
 *
 * The Rust side is `crates/marmotter-shell/src/textfile.rs`, registered on
 * desktop alone.
 */

import { invoke } from '@tauri-apps/api/core';

/** The file's contents. Rejects with a sentence fit to show on any failure. */
export async function readTextFile(path: string): Promise<string> {
  return await invoke<string>('text_file_read', { path });
}

/** Replaces the file's contents. The dialog has already asked about that. */
export async function writeTextFile(path: string, text: string): Promise<void> {
  await invoke('text_file_write', { path, text });
}
