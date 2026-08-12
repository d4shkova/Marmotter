/**
 * The logging boundary.
 *
 * The same shape as `Transport`: an interface the rest of the app depends on,
 * with the platform supplying an implementation. Desktop passes one backed by
 * SQLite or plaintext files. **Web passes nothing at all**, and that absence is
 * the guarantee rather than a policy check — a browser build has no
 * implementation to reach, so there is no path by which message content could
 * be written anywhere. CLAUDE.md makes that non-negotiable, and a runtime
 * `if (platform === 'web')` would be a promise rather than a structure.
 *
 * The store is deliberately dumb. It writes what it is given and returns what
 * it is asked for; every decision about *whether* a message is logged, how long
 * it is kept, and what a line looks like on disk is made by the pure functions
 * in `@marmotter/client`, where it can be tested without touching a disk.
 */

/** One logged line. */
export interface LogRecord {
  /** Stable ID — the `msgid` tag where the server sends one. Used to dedupe. */
  readonly id: string;
  readonly networkId: string;
  /** The network's display name, so a log read later names itself. */
  readonly networkName: string;
  /** Channel or nick. Empty for a server notice, which belongs to no conversation. */
  readonly target: string;
  readonly at: Date;
  /** The message kind, as `@marmotter/client` spells it. */
  readonly kind: string;
  /** Who said it. Empty where the server itself did. */
  readonly nick: string;
  readonly text: string;
}

/** What to look for when searching the logs. */
export interface LogQuery {
  /** The words to find. Empty matches everything in range. */
  readonly text: string;
  /** Narrow to one network. Absent searches all of them. */
  readonly networkId?: string;
  /** Narrow to one conversation. Absent searches all of them. */
  readonly target?: string;
  readonly from?: Date;
  readonly to?: Date;
  /** How many hits to return. Always set, so a search cannot exhaust memory. */
  readonly limit: number;
}

/** Where the logs live, for the settings screen to show and open. */
export interface LogLocation {
  /** The folder, as the platform spells it. */
  readonly path: string;
  /** Total bytes on disk, so "how much is this costing me" has an answer. */
  readonly bytes: number;
}

export interface LogStore {
  /**
   * Writes records.
   *
   * Batched by the caller rather than called per message: a busy channel is
   * several lines a second and a write each would be the client's slowest path.
   * Re-appending a record whose ID is already stored is a no-op, so a retry
   * after a failed flush cannot double up.
   */
  append(records: readonly LogRecord[]): Promise<void>;

  /** Matching lines, newest first. */
  search(query: LogQuery): Promise<readonly LogRecord[]>;

  /**
   * Deletes everything older than `before`, and reports how many lines went.
   *
   * Scoped to one network when `networkId` is given, which is what makes a
   * per-network retention override enforceable.
   */
  purge(before: Date, networkId?: string): Promise<number>;

  /** Writes the matching lines to a file the user chose, and returns its path. */
  export(query: LogQuery, path: string): Promise<string>;

  location(): Promise<LogLocation>;

  /** Shows the log folder in the platform's file manager. */
  reveal(): Promise<void>;

  /** Deletes everything, for somebody who wants it all gone now. */
  clear(): Promise<number>;
}
