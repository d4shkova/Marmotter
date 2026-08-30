/**
 * The desktop shell's DCC file monitor.
 *
 * The bridge itself is shared with Android and lives in
 * `@marmotter/platform-tauri`; what a desktop adds to it is the two things a
 * phone does not have. A folder picker, so downloads go wherever the user keeps
 * their files rather than inside the app; and a file manager to open on a saved
 * file afterwards.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { createDcc } from '@marmotter/platform-tauri';
import type { DccCapability } from '@marmotter/ui';

export function createDesktopDcc(): DccCapability {
  return createDcc({
    async chooseFolder(): Promise<string | undefined> {
      const chosen = await open({
        directory: true,
        multiple: false,
        title: 'Choose a download folder',
      });
      // The dialog resolves to null on cancel, or a path; the folder mode never
      // returns an array here because `multiple` is false.
      return typeof chosen === 'string' ? chosen : undefined;
    },
    revealFiles: true,
  });
}
