/**
 * Saving and opening a settings file, through the desktop's own dialogs.
 *
 * The settings export works on every platform by copying its text, which is the
 * only thing a phone and a browser tab can both do. A desktop can do better: it
 * has a save dialog and an open dialog, and somebody moving their configuration
 * between two machines would rather hand over a file than a clipboard.
 *
 * So this is the extra, not the feature. The reading and writing come from
 * `@marmotter/platform-tauri`; what is here is the two dialogs, which is the
 * part Android has no equivalent of.
 */

import { open as openDialog, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@marmotter/platform-tauri';
import type { ConfigFileAccess } from '@marmotter/ui';

const FILTERS = [{ name: 'Marmotter settings', extensions: ['json'] }];

export function createConfigFile(): ConfigFileAccess {
  return {
    async save(suggestedName: string, text: string): Promise<string | undefined> {
      const chosen = await save({
        title: 'Export your settings',
        defaultPath: suggestedName,
        filters: FILTERS,
      });
      if (chosen === null) {
        return undefined;
      }
      await writeTextFile(chosen, text);
      return chosen;
    },

    async open(): Promise<string | undefined> {
      const chosen = await openDialog({
        title: 'Open a settings file',
        multiple: false,
        directory: false,
        filters: FILTERS,
      });
      // Cancelling resolves to null; the single-file mode never returns an
      // array here because `multiple` is false.
      return typeof chosen === 'string' ? await readTextFile(chosen) : undefined;
    },
  };
}
