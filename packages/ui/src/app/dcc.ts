/**
 * The DCC file monitor's platform boundary.
 *
 * Opening a socket to a stranger's address and writing bytes to disk is I/O the
 * browser cannot do and the shell must, so — like the transport and the
 * notifier — it is injected rather than imported. Both Tauri shells supply a
 * backed implementation; web supplies nothing, and the whole feature is absent
 * there, which is correct: a browser tab has no folder to write to and no way
 * to open an arbitrary TCP connection.
 *
 * Three of the four members are optional, and each absence is a platform saying
 * it cannot do that rather than a caller forgetting to pass it. A shell with no
 * folder picker names the folder itself; a shell with no file manager has no
 * reveal. The interface hides what was not passed, which is the same rule the
 * logging settings follow — a control that quietly does nothing is worse than
 * no control.
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
  /**
   * Whether the transfer's socket is TLS, from an `SSEND` offer.
   *
   * Carried all the way down because it changes how the socket is opened, and
   * nothing below can infer it: dialled in the clear, a secure offer connects
   * and then simply never says anything, which reads as a firewall.
   */
  readonly secure?: boolean;
  /** Whether the sender streams without waiting to be acknowledged (`TSEND`). */
  readonly turbo?: boolean;
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
   *
   * Optional: Android has no folder picker worth offering, because an app may
   * write inside its own storage without a permission and anywhere else costs
   * one that would let it read the whole device. A platform that leaves this
   * out supplies {@link defaultDownloadFolder} instead, and the settings screen
   * shows the path rather than a button.
   */
  chooseDownloadFolder?(): Promise<string | undefined>;
  /**
   * Where files go when the platform picks the folder rather than the user.
   *
   * Resolved once, the first time the monitor needs somewhere to write, and
   * kept in settings from then on like any chosen folder. Rejects where the
   * shell has nowhere it may write, which leaves downloads blocked and says so
   * rather than failing per file.
   */
  defaultDownloadFolder?(): Promise<string>;
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
