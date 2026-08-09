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
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { DccCapability, DccDownloadRequest, DccProgress } from '@marmotter/ui';

const PROGRESS_EVENT = 'marmotter://dcc-progress';

interface ProgressPayload {
  readonly id: string;
  readonly received: number;
  readonly total: number | null;
}

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

    async download(request: DccDownloadRequest, onProgress?: DccProgress): Promise<string> {
      // A per-transfer id ties the Rust side's progress events back to this
      // call, so two downloads at once do not drive each other's bars.
      const transferId = crypto.randomUUID();

      let unlisten = (): void => {};
      if (onProgress !== undefined) {
        unlisten = await listen<ProgressPayload>(PROGRESS_EVENT, (event) => {
          if (event.payload.id === transferId) {
            onProgress(event.payload.received, event.payload.total ?? undefined);
          }
        });
      }

      try {
        return await invoke<string>('dcc_download_file', {
          request: {
            host: request.host,
            port: request.port,
            size: request.size ?? null,
            filename: request.filename,
            folder: request.folder,
            transferId,
          },
        });
      } finally {
        unlisten();
      }
    },

    async revealFile(path: string): Promise<void> {
      // A thin Rust command that hands the path to the platform's file manager
      // and asks it to select the file. Kept in Rust rather than the shell
      // plugin so it can pick the right selecting-open per OS.
      await invoke('dcc_reveal_file', { path });
    },
  };
}
