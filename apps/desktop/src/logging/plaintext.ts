/**
 * The plaintext log store.
 *
 * HexChat's layout, one file per conversation under a folder per network, so
 * the tools somebody already uses on their old logs keep working on these. The
 * format, the file names, the parsing and the searching are all in
 * `@marmotter/client`; what is here is the sequencing of file operations
 * around them.
 *
 * Searching means reading files and filtering lines, which is slower than the
 * SQLite store and honestly so: the format's whole point is that it is text on
 * disk rather than a database. Files are read one at a time and the search
 * stops once it has enough hits.
 */

import { fileFor, formatLine, groupByFile, parseLine, selectMatching } from '@marmotter/client';
import type { LogQuery, LogRecord, LogStore } from '@marmotter/shared';

export interface LogFileInfo {
  /** Path relative to the log folder, with forward slashes. */
  readonly name: string;
  readonly bytes: number;
  readonly modifiedMs: number;
}

/** The file operations the platform supplies. Nothing here touches a disk itself. */
export interface LogFileSystem {
  append(root: string, name: string, text: string): Promise<void>;
  read(root: string, name: string): Promise<string>;
  list(root: string): Promise<readonly LogFileInfo[]>;
  write(root: string, name: string, text: string): Promise<void>;
  remove(root: string, name: string): Promise<void>;
  reveal(root: string): Promise<void>;
  /** Writes an export to an absolute path outside the log folder. */
  writeAbsolute(path: string, text: string): Promise<void>;
}

export interface PlaintextLogStoreOptions {
  readonly root: string;
  readonly fs: LogFileSystem;
  /**
   * Which network a folder belongs to.
   *
   * The files are named after networks rather than their IDs, because a log
   * folder has to make sense to somebody reading it without the app. Search
   * results still carry the ID where the caller can supply one; a folder from
   * a network that has since been removed reports an empty ID rather than a
   * guess.
   */
  readonly networkIdFor: (networkName: string) => string;
}

/** Splits a relative log path back into the network and conversation it holds. */
export function contextOf(name: string): { network: string; target: string } | undefined {
  const match = /^(.+)\/(.+)\.log$/.exec(name);
  if (match === null) {
    return undefined;
  }
  const network = match[1] ?? '';
  const conversation = match[2] ?? '';
  // A network's own file is named after the network, and holds its notices,
  // which belong to no conversation.
  return { network, target: conversation === network ? '' : conversation };
}

export function createPlaintextLogStore(options: PlaintextLogStoreOptions): LogStore {
  const { root, fs } = options;

  /** Every record a file holds, parsed back out of it. */
  const recordsIn = async (file: LogFileInfo): Promise<readonly LogRecord[]> => {
    const context = contextOf(file.name);
    if (context === undefined) {
      return [];
    }
    const text = await fs.read(root, file.name);
    // The file's own modification time is the reference for the year, since the
    // format carries none. A line stamped after it belongs to the year before.
    const reference = new Date(file.modifiedMs === 0 ? Date.now() : file.modifiedMs);
    const parsed: LogRecord[] = [];
    for (const line of text.split('\n')) {
      if (line === '') {
        continue;
      }
      const record = parseLine(line, {
        networkId: options.networkIdFor(context.network),
        networkName: context.network,
        target: context.target,
        reference,
      });
      if (record !== undefined) {
        parsed.push(record);
      }
    }
    return parsed;
  };

  /** Every record in the folder, for a search or an export. */
  const allRecords = async (query: LogQuery): Promise<readonly LogRecord[]> => {
    const files = await fs.list(root);
    const collected: LogRecord[] = [];
    for (const file of files) {
      // Skip a file the query could not match on its name alone, so a search
      // scoped to one conversation does not read every other one.
      const context = contextOf(file.name);
      if (context === undefined) {
        continue;
      }
      if (query.target !== undefined && context.target !== query.target) {
        continue;
      }
      if (
        query.networkId !== undefined &&
        options.networkIdFor(context.network) !== query.networkId
      ) {
        continue;
      }
      collected.push(...(await recordsIn(file)));
    }
    return collected;
  };

  return {
    async append(records) {
      if (records.length === 0) {
        return;
      }
      // One append per file rather than per line: a busy channel is several
      // lines a second, and a file handle each would be the client's slowest
      // path by a wide margin.
      for (const [name, group] of groupByFile(records)) {
        const text = `${group.map(formatLine).join('\n')}\n`;
        await fs.append(root, name, text);
      }
    },

    async search(query) {
      return selectMatching(await allRecords(query), query);
    },

    async purge(before, networkId) {
      const files = await fs.list(root);
      let removed = 0;
      for (const file of files) {
        const context = contextOf(file.name);
        if (context === undefined) {
          continue;
        }
        if (networkId !== undefined && options.networkIdFor(context.network) !== networkId) {
          continue;
        }
        const records = await recordsIn(file);
        const keep = records.filter((record) => record.at.getTime() >= before.getTime());
        if (keep.length === records.length) {
          continue;
        }
        removed += records.length - keep.length;
        // A file with nothing left goes, rather than staying as an empty file
        // that looks like a conversation somebody had.
        if (keep.length === 0) {
          await fs.remove(root, file.name);
        } else {
          await fs.write(root, file.name, `${keep.map(formatLine).join('\n')}\n`);
        }
      }
      return removed;
    },

    async export(query, path) {
      const hits = selectMatching(await allRecords(query), query);
      // Oldest first in the file: an export is read as a transcript, and a
      // transcript runs forwards even though a search result list does not.
      const ordered = [...hits].sort((left, right) => left.at.getTime() - right.at.getTime());
      const text = ordered.map(formatLine).join('\n');
      await fs.writeAbsolute(path, text === '' ? '' : `${text}\n`);
      return path;
    },

    async location() {
      const files = await fs.list(root);
      return { path: root, bytes: files.reduce((total, file) => total + file.bytes, 0) };
    },

    async reveal() {
      await fs.reveal(root);
    },

    async clear() {
      const files = await fs.list(root);
      let removed = 0;
      for (const file of files) {
        removed += (await recordsIn(file)).length;
        await fs.remove(root, file.name);
      }
      return removed;
    },
  };
}

/** Exposed for the export path, which writes lines in the same shape. */
export { fileFor, formatLine };
