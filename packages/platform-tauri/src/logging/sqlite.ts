/**
 * The SQLite log store.
 *
 * One table plus an FTS5 index over the message text, which is what makes
 * "find every time somebody mentioned marmots, across every network, in two
 * years of logs" answer instantly rather than by reading every file.
 *
 * The schema and every query are here in TypeScript rather than in Rust, per
 * CLAUDE.md's choice of `tauri-plugin-sql`: Rust owns the file handle, and the
 * decisions stay where the rest of the client's decisions are.
 *
 * The database is opened lazily. Somebody who never switches logging on never
 * gets a database file at all — not an empty one, none — which is the
 * difference between "off by default" and "on but writing nothing".
 */

import Database from '@tauri-apps/plugin-sql';
import type { LogLocation, LogQuery, LogRecord, LogStore } from '@marmotter/shared';

/**
 * The schema.
 *
 * `id` is the message's own ID — the `msgid` tag where the server sends one —
 * and it is the primary key, so re-appending after a failed flush cannot double
 * a line up. `at_ms` is an integer rather than a date string because every
 * range query and the retention purge compare on it.
 *
 * The FTS table is external-content: it indexes `text` without storing a second
 * copy of it, and the triggers keep the two in step. Storing the messages twice
 * to make them searchable would be a strange thing to do to somebody's disk.
 */
const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS messages (
     id           TEXT PRIMARY KEY,
     network_id   TEXT NOT NULL,
     network_name TEXT NOT NULL,
     target       TEXT NOT NULL,
     at_ms        INTEGER NOT NULL,
     kind         TEXT NOT NULL,
     nick         TEXT NOT NULL,
     text         TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS messages_at ON messages (at_ms)`,
  `CREATE INDEX IF NOT EXISTS messages_where ON messages (network_id, target, at_ms)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
     USING fts5(text, content='messages', content_rowid='rowid')`,
  `CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
     INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
     INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
   END`,
];

/** How many records go into one INSERT. Keeps a backfill off one huge statement. */
const BATCH = 200;

interface Row {
  readonly id: string;
  readonly network_id: string;
  readonly network_name: string;
  readonly target: string;
  readonly at_ms: number;
  readonly kind: string;
  readonly nick: string;
  readonly text: string;
}

const toRecord = (row: Row): LogRecord => ({
  id: row.id,
  networkId: row.network_id,
  networkName: row.network_name,
  target: row.target,
  at: new Date(row.at_ms),
  kind: row.kind,
  nick: row.nick,
  text: row.text,
});

/**
 * A search phrase FTS5 will accept.
 *
 * FTS5's query language treats `-`, `*`, `:` and quotes as syntax, and a person
 * searching for `foo-bar` means the text, not an operator. Every term is quoted
 * and its own quotes doubled, which turns the whole thing back into a literal
 * phrase search — the behaviour somebody typing into a search box expects.
 */
export function ftsQuery(text: string): string {
  const terms = text
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term !== '');
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ');
}

/**
 * Builds the WHERE clause and its bindings for a query.
 *
 * Separated out because it is the part worth testing: an off-by-one on a date
 * bound silently returns the wrong window, and a missing bind placeholder is
 * how a search box becomes an injection.
 */
export function whereFor(query: LogQuery): { clause: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (query.networkId !== undefined) {
    clauses.push('m.network_id = $' + (binds.length + 1));
    binds.push(query.networkId);
  }
  if (query.target !== undefined) {
    clauses.push('m.target = $' + (binds.length + 1));
    binds.push(query.target);
  }
  if (query.from !== undefined) {
    clauses.push('m.at_ms >= $' + (binds.length + 1));
    binds.push(query.from.getTime());
  }
  if (query.to !== undefined) {
    clauses.push('m.at_ms <= $' + (binds.length + 1));
    binds.push(query.to.getTime());
  }
  return { clause: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`, binds };
}

export interface SqliteLogStoreOptions {
  /** Where the database file goes. Absolute, from the settings or app data. */
  readonly path: string;
  /** Writes the export file. Supplied so this module still does no file I/O. */
  readonly writeFile: (path: string, text: string) => Promise<void>;
  /** Shows the folder. Absent on a platform with no file manager to show it. */
  readonly reveal?: (path: string) => Promise<void>;
  /** Formats a record for the export file, so an export reads like a log. */
  readonly formatLine: (record: LogRecord) => string;
}

/** The SQLite-backed store. */
export function createSqliteLogStore(options: SqliteLogStoreOptions): LogStore {
  let opened: Promise<Database> | undefined;

  const db = async (): Promise<Database> => {
    // Opened once, on the first write or read. Assigning the promise rather
    // than awaiting first means two calls racing at startup share one open
    // rather than creating the schema twice.
    opened ??= (async () => {
      const database = await Database.load(`sqlite:${options.path}`);
      for (const statement of SCHEMA) {
        await database.execute(statement);
      }
      return database;
    })();
    return opened;
  };

  return {
    async append(records) {
      if (records.length === 0) {
        return;
      }
      const database = await db();
      for (let start = 0; start < records.length; start += BATCH) {
        const chunk = records.slice(start, start + BATCH);
        const values = chunk
          .map((_, index) => {
            const base = index * 8;
            return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${
              base + 6
            },$${base + 7},$${base + 8})`;
          })
          .join(',');
        const binds = chunk.flatMap((record) => [
          record.id,
          record.networkId,
          record.networkName,
          record.target,
          record.at.getTime(),
          record.kind,
          record.nick,
          record.text,
        ]);
        // OR IGNORE, not OR REPLACE: a line already written is already right,
        // and replacing it would churn the FTS index for nothing.
        await database.execute(
          `INSERT OR IGNORE INTO messages
             (id, network_id, network_name, target, at_ms, kind, nick, text)
           VALUES ${values}`,
          binds,
        );
      }
    },

    async search(query) {
      const database = await db();
      const { clause, binds } = whereFor(query);
      const match = ftsQuery(query.text);

      // With no words to find this is a browse of a date range, which the FTS
      // index cannot help with and does not need to.
      const sql =
        match === ''
          ? `SELECT m.* FROM messages m ${clause}
             ORDER BY m.at_ms DESC LIMIT $${binds.length + 1}`
          : `SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
             ${clause === '' ? 'WHERE' : `${clause} AND`} messages_fts MATCH $${binds.length + 1}
             ORDER BY m.at_ms DESC LIMIT $${binds.length + 2}`;

      const rows = await database.select<Row[]>(
        sql,
        match === '' ? [...binds, query.limit] : [...binds, match, query.limit],
      );
      return rows.map(toRecord);
    },

    async purge(before, networkId) {
      const database = await db();
      const scoped = networkId === undefined ? '' : ' AND network_id = $2';
      const binds = networkId === undefined ? [before.getTime()] : [before.getTime(), networkId];
      const result = await database.execute(
        `DELETE FROM messages WHERE at_ms < $1${scoped}`,
        binds,
      );
      return result.rowsAffected;
    },

    async export(query, path) {
      const database = await db();
      const { clause, binds } = whereFor(query);
      const rows = await database.select<Row[]>(
        `SELECT m.* FROM messages m ${clause} ORDER BY m.at_ms ASC LIMIT $${binds.length + 1}`,
        [...binds, query.limit],
      );
      const text = rows.map((row) => options.formatLine(toRecord(row))).join('\n');
      await options.writeFile(path, text === '' ? '' : `${text}\n`);
      return path;
    },

    async location() {
      const database = await db();
      // `page_count * page_size` is the file's own size as SQLite sees it,
      // which is the number somebody wants when they ask what this costs.
      const rows = await database.select<{ bytes: number }[]>(
        `SELECT (SELECT * FROM pragma_page_count()) * (SELECT * FROM pragma_page_size()) AS bytes`,
      );
      return { path: options.path, bytes: rows[0]?.bytes ?? 0 };
    },

    // Offered only where the platform can actually open the folder, so the
    // settings screen can tell the difference and hide the button.
    ...(options.reveal === undefined
      ? {}
      : {
          async reveal() {
            await options.reveal?.(options.path);
          },
        }),

    async clear() {
      const database = await db();
      const result = await database.execute('DELETE FROM messages');
      // VACUUM after emptying, or the file keeps the space it had. Somebody who
      // just deleted every message expects the disk to reflect it.
      await database.execute('VACUUM');
      return result.rowsAffected;
    },
  };
}

/** The location a store reports when nothing has been written yet. */
export const emptyLocation = (path: string): LogLocation => ({ path, bytes: 0 });
