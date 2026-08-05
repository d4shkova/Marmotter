/**
 * The desktop app's DCC file-monitor bridge.
 *
 * Like the transport, this is one of the few files that knows Tauri exists. The
 * folder picker comes from the dialog plugin; the download itself is a Rust
 * command that opens the socket and writes the file. The web build has neither
 * and passes no `dcc` capability at all, so the file monitor is simply absent
 * there.
 */

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { DccCapability, DccDownloadRequest } from '@marmotter/ui';

export function createDesktopDcc(): DccCapability {
  return {
    async chooseDownloadFolder(): Promise<string | undefined> {
      const chosen = await open({
        directory: true,
        multiple: false,
        title: 'Choose a download folder',
      });
      // The dialog resolves to null on cancel, or a path; the folder mode never
      // returns an array here because `multiple` is false.
      return typeof chosen === 'string' ? chosen : undefined;
    },

    download(request: DccDownloadRequest): Promise<string> {
      return invoke<string>('dcc_download_file', {
        request: {
          host: request.host,
          port: request.port,
          size: request.size ?? null,
          filename: request.filename,
          folder: request.folder,
        },
      });
    },
  };
}
