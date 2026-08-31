/**
 * The DCC file monitor's Tauri bridge, shared by both shells.
 *
 * Like the transport, this is one of the few files that knows Tauri exists. The
 * download itself is a Rust command that opens the socket and writes the file;
 * everything above it is the same on a desktop and on a phone, which is why it
 * lives here rather than twice.
 *
 * What is *not* the same is the folder and the file manager, and those are the
 * two reasons the monitor used to be desktop-only. A desktop has a folder
 * picker and something to reveal a saved file in; Android has neither — an app
 * may write inside its own storage without a permission, and every other folder
 * costs one that would let it read the whole device — so there the shell
 * answers with a folder of its own and there is no reveal at all. Both are
 * injected rather than assumed, and the interface hides whatever the platform
 * did not pass rather than drawing a button that fails.
 *
 * The web build has none of it and passes no `dcc` capability, so the file
 * monitor is simply absent there: a browser tab has no folder to write to and
 * no way to open an arbitrary TCP connection.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  DccCapability,
  DccDownloadRequest,
  DccPassiveRequest,
  DccProgress,
  DccTransfer,
} from '@marmotter/ui';

const PROGRESS_EVENT = 'marmotter://dcc-progress';
const LISTENING_EVENT = 'marmotter://dcc-listening';

interface ProgressPayload {
  readonly id: string;
  readonly received: number;
  readonly total: number | null;
}

interface ListeningPayload {
  readonly id: string;
  readonly port: number;
  readonly address: string | null;
}

export interface DccOptions {
  /**
   * Opens the platform's folder picker.
   *
   * Passed by the desktop shell, which has one. Left out on Android, where the
   * shell picks the folder instead — see `defaultFolder`.
   */
  readonly chooseFolder?: () => Promise<string | undefined>;
  /**
   * Whether the platform can open a file manager on a saved file.
   *
   * Desktop can. Android has no file manager that will open an app's own
   * storage, so it passes false and the reveal button is not drawn.
   */
  readonly revealFiles?: boolean;
}

/** The file monitor's platform half, for whichever Tauri shell asked for it. */
export function createDcc(options: DccOptions = {}): DccCapability {
  const { chooseFolder, revealFiles = false } = options;

  return {
    ...(chooseFolder === undefined ? {} : { chooseDownloadFolder: chooseFolder }),

    async defaultDownloadFolder(): Promise<string> {
      return await invoke<string>('dcc_default_dir');
    },

    async resumableBytes(folder: string, filename: string): Promise<number> {
      return await invoke<number>('dcc_resumable_bytes', { folder, filename });
    },

    download(request: DccDownloadRequest, onProgress?: DccProgress): DccTransfer {
      // A per-transfer id ties the Rust side's progress events back to this
      // call, so two downloads at once do not drive each other's bars, and lets
      // a cancel reach the right transfer.
      const transferId = crypto.randomUUID();

      const done = (async (): Promise<string> => {
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
              secure: request.secure ?? false,
              turbo: request.turbo ?? false,
              resumeFrom: request.resumeFrom ?? null,
              transferId,
            },
          });
        } finally {
          unlisten();
        }
      })();

      return {
        done,
        cancel(): void {
          // Best-effort: the Rust side no-ops an id it no longer holds, and the
          // transfer's own rejection is what actually settles the row.
          void invoke('dcc_cancel_download', { transferId }).catch(() => {});
        },
      };
    },

    receivePassive(
      request: DccPassiveRequest,
      onListening: (address: string | undefined, port: number) => void,
      onProgress?: DccProgress,
    ): DccTransfer {
      const transferId = crypto.randomUUID();

      const done = (async (): Promise<string> => {
        const unlisteners: (() => void)[] = [];
        // Subscribed before the command is invoked: the socket is bound early
        // in it, and a listener attached afterwards would miss the one event
        // that says which port to advertise — leaving a transfer nothing will
        // ever connect to.
        unlisteners.push(
          await listen<ListeningPayload>(LISTENING_EVENT, (event) => {
            if (event.payload.id === transferId) {
              onListening(event.payload.address ?? undefined, event.payload.port);
            }
          }),
        );
        if (onProgress !== undefined) {
          unlisteners.push(
            await listen<ProgressPayload>(PROGRESS_EVENT, (event) => {
              if (event.payload.id === transferId) {
                onProgress(event.payload.received, event.payload.total ?? undefined);
              }
            }),
          );
        }

        try {
          return await invoke<string>('dcc_receive_passive', {
            request: {
              host: request.host,
              size: request.size ?? null,
              filename: request.filename,
              folder: request.folder,
              turbo: request.turbo ?? false,
              resumeFrom: request.resumeFrom ?? null,
              transferId,
            },
          });
        } finally {
          for (const unlisten of unlisteners) {
            unlisten();
          }
        }
      })();

      return {
        done,
        cancel(): void {
          void invoke('dcc_cancel_download', { transferId }).catch(() => {});
        },
      };
    },

    ...(revealFiles
      ? {
          async revealFile(path: string): Promise<void> {
            // A thin Rust command that hands the path to the platform's file
            // manager and asks it to select the file. Kept in Rust rather than
            // the shell plugin so it can pick the right selecting-open per OS.
            await invoke('dcc_reveal_file', { path });
          },
        }
      : {}),
  };
}
