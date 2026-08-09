/**
 * The DCC file monitor's platform boundary.
 *
 * Opening a socket to a stranger's address and writing bytes to disk is I/O the
 * browser cannot do and the shell must, so — like the transport and the
 * notifier — it is injected rather than imported. Desktop supplies a Tauri
 * backed implementation; web supplies nothing, and the whole feature is absent
 * there, which is correct: a browser tab has no folder to write to and no way
 * to open an arbitrary TCP connection.
 */

/** What the shell needs to fetch one advertised file. */
export interface DccDownloadRequest {
  readonly host: string;
  readonly port: number;
  /** The advertised size, where known, so the transfer can stop at it. */
  readonly size?: number;
  /** The advertised name. The shell sanitises it again before writing. */
  readonly filename: string;
  /** The folder chosen in settings. */
  readonly folder: string;
}

/** Progress of a transfer in flight: bytes received, and the total if known. */
export type DccProgress = (received: number, total: number | undefined) => void;

/**
 * A download in flight, with a way to stop it.
 *
 * `done` settles the way the old promise did — the saved path, or a rejection
 * with a message fit to show. `cancel` asks the shell to abort the transfer;
 * `done` then rejects, so a cancelled download and a failed one arrive through
 * the same path and the caller decides which it was.
 */
export interface DccTransfer {
  readonly done: Promise<string>;
  /** Aborts the transfer. Safe to call after it has already finished. */
  cancel(): void;
}

/** The platform capabilities the file monitor depends on. */
export interface DccCapability {
  /**
   * Opens a folder picker, resolving to the chosen path, or undefined if the
   * user cancelled.
   */
  chooseDownloadFolder(): Promise<string | undefined>;
  /**
   * Starts downloading an advertised file, returning a handle to it.
   *
   * `onProgress` is called as bytes arrive, so a row can show a bar rather than
   * a spinner. The handle's `done` resolves to the path it was written to, or
   * rejects with a message fit to show the user on any failure — a refused
   * connection, a size over the cap, a folder that cannot be written to, or a
   * cancellation.
   */
  download(request: DccDownloadRequest, onProgress?: DccProgress): DccTransfer;
  /**
   * Opens the platform's file manager on a downloaded file, selecting it.
   *
   * Optional: a platform that has no file manager to open — or no meaningful
   * notion of "reveal" — simply omits it, and the button that calls it is not
   * shown. Rejects with a message fit to show the user when the reveal fails.
   */
  revealFile?(path: string): Promise<void>;
}

/** A byte count as a short human-readable string, e.g. "1.4 MB". */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) {
    return 'Unknown size';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** How long ago something arrived, as a short relative string. */
export function formatAge(receivedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - receivedAt) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}
