import type { LogRecord } from '@marmotter/shared';
import { describe, expect, it } from 'vitest';
import {
  type LogFileInfo,
  type LogFileSystem,
  contextOf,
  createPlaintextLogStore,
} from './plaintext.js';

/**
 * The disk, in memory.
 *
 * The store's job is sequencing file operations around pure functions, so a
 * fake that records those operations is what there is to test. Everything below
 * it — the format, the parsing, the matching — is tested in
 * `packages/client/src/logging`.
 */
function memoryFs(): LogFileSystem & {
  readonly files: Map<string, string>;
  readonly revealed: string[];
} {
  const files = new Map<string, string>();
  const revealed: string[] = [];
  return {
    files,
    revealed,
    async append(_root, name, text) {
      files.set(name, (files.get(name) ?? '') + text);
    },
    async read(_root, name) {
      return files.get(name) ?? '';
    },
    async list(): Promise<readonly LogFileInfo[]> {
      return [...files.entries()].map(([name, text]) => ({
        name,
        bytes: text.length,
        // A fixed, late reference so every stamped line reads as this year.
        modifiedMs: new Date(2026, 11, 31, 23, 59, 59).getTime(),
      }));
    },
    async write(_root, name, text) {
      files.set(name, text);
    },
    async remove(_root, name) {
      files.delete(name);
    },
    async reveal(root) {
      revealed.push(root);
    },
    async writeAbsolute(path, text) {
      files.set(path, text);
    },
  };
}

const record = (overrides: Partial<LogRecord> = {}): LogRecord => ({
  id: 'm1',
  networkId: 'n1',
  networkName: 'Libera.Chat',
  target: '#marmotter',
  at: new Date(2026, 7, 12, 14, 30, 5),
  kind: 'privmsg',
  nick: 'tamsin',
  text: 'morning',
  ...overrides,
});

const store = (fs: LogFileSystem) =>
  createPlaintextLogStore({
    root: '/logs',
    fs,
    networkIdFor: (name) => (name === 'Libera.Chat' ? 'n1' : 'n2'),
  });

describe('where a line goes', () => {
  it('reads a network and a conversation back out of a path', () => {
    expect(contextOf('Libera.Chat/#marmotter.log')).toEqual({
      network: 'Libera.Chat',
      target: '#marmotter',
    });
  });

  it("treats a network's own file as belonging to no conversation", () => {
    expect(contextOf('Libera.Chat/Libera.Chat.log')).toEqual({
      network: 'Libera.Chat',
      target: '',
    });
  });

  it('ignores anything else somebody has put in the folder', () => {
    expect(contextOf('notes.txt')).toBeUndefined();
    expect(contextOf('loose.log')).toBeUndefined();
  });
});

describe('writing', () => {
  it('writes one line per message, under the conversation it belongs to', async () => {
    const fs = memoryFs();
    await store(fs).append([record({ id: 'a' }), record({ id: 'b', text: 'and again' })]);

    expect(fs.files.get('Libera.Chat/#marmotter.log')).toBe(
      'Aug 12 14:30:05 <tamsin>\tmorning\nAug 12 14:30:05 <tamsin>\tand again\n',
    );
  });

  it('opens each file once for a batch, not once per line', async () => {
    // A busy channel is several lines a second. A handle each would be the
    // client's slowest path by a wide margin.
    const fs = memoryFs();
    let appends = 0;
    const counting: LogFileSystem = {
      ...fs,
      append: async (root, name, text) => {
        appends += 1;
        await fs.append(root, name, text);
      },
    };

    await store(counting).append([
      record({ id: 'a' }),
      record({ id: 'b' }),
      record({ id: 'c', target: 'jonquil' }),
    ]);

    expect(appends).toBe(2);
  });

  it('does nothing at all for an empty batch', async () => {
    const fs = memoryFs();
    await store(fs).append([]);
    expect(fs.files.size).toBe(0);
  });
});

describe('searching', () => {
  const seeded = async () => {
    const fs = memoryFs();
    await store(fs).append([
      record({ id: 'a', text: 'a marmot photo', at: new Date(2026, 7, 12, 10, 0, 0) }),
      record({ id: 'b', text: 'something else', at: new Date(2026, 7, 12, 11, 0, 0) }),
      record({
        id: 'c',
        target: 'jonquil',
        text: 'another marmot',
        at: new Date(2026, 7, 12, 12, 0, 0),
      }),
      record({
        id: 'd',
        networkName: 'OFTC',
        text: 'marmot elsewhere',
        at: new Date(2026, 7, 12, 13, 0, 0),
      }),
    ]);
    return fs;
  };

  it('finds a word across every network and conversation', async () => {
    const hits = await store(await seeded()).search({ text: 'marmot', limit: 10 });
    expect(hits.map((hit) => hit.text)).toEqual([
      'marmot elsewhere',
      'another marmot',
      'a marmot photo',
    ]);
  });

  it('narrows to one conversation', async () => {
    const hits = await store(await seeded()).search({
      text: 'marmot',
      target: 'jonquil',
      limit: 10,
    });
    expect(hits.map((hit) => hit.text)).toEqual(['another marmot']);
  });

  it('narrows to one network', async () => {
    const hits = await store(await seeded()).search({ text: 'marmot', networkId: 'n2', limit: 10 });
    expect(hits.map((hit) => hit.text)).toEqual(['marmot elsewhere']);
  });

  it('reads only the files a scoped search could match', async () => {
    // Searching one conversation should not read every other one. On a folder
    // with years of logs in it, that is the difference between instant and not.
    const fs = await seeded();
    const read: string[] = [];
    const watching: LogFileSystem = {
      ...fs,
      read: async (root, name) => {
        read.push(name);
        return fs.read(root, name);
      },
    };

    await store(watching).search({ text: 'marmot', target: 'jonquil', limit: 10 });
    expect(read).toEqual(['Libera.Chat/jonquil.log']);
  });

  it('returns no more than it was asked for', async () => {
    const hits = await store(await seeded()).search({ text: 'marmot', limit: 1 });
    expect(hits).toHaveLength(1);
  });
});

describe('retention', () => {
  const aged = async () => {
    const fs = memoryFs();
    await store(fs).append([
      record({ id: 'old', text: 'last month', at: new Date(2026, 6, 1, 9, 0, 0) }),
      record({ id: 'new', text: 'today', at: new Date(2026, 7, 12, 9, 0, 0) }),
      record({
        id: 'stale',
        target: 'jonquil',
        text: 'ancient',
        at: new Date(2026, 5, 1, 9, 0, 0),
      }),
    ]);
    return fs;
  };

  it('drops the lines that are too old and keeps the rest of the file', async () => {
    const fs = await aged();
    const removed = await store(fs).purge(new Date(2026, 7, 1));

    expect(removed).toBe(2);
    expect(fs.files.get('Libera.Chat/#marmotter.log')).toBe('Aug 12 09:00:00 <tamsin>\ttoday\n');
  });

  it('removes a file with nothing left rather than leaving an empty one', async () => {
    // An empty file looks like a conversation somebody had and said nothing in.
    const fs = await aged();
    await store(fs).purge(new Date(2026, 7, 1));
    expect(fs.files.has('Libera.Chat/jonquil.log')).toBe(false);
  });

  it('leaves a file alone when nothing in it is old enough', async () => {
    const fs = await aged();
    let writes = 0;
    const counting: LogFileSystem = {
      ...fs,
      write: async (root, name, text) => {
        writes += 1;
        await fs.write(root, name, text);
      },
    };

    await store(counting).purge(new Date(2026, 0, 1));
    expect(writes).toBe(0);
  });

  it('purges one network without touching another', async () => {
    const fs = memoryFs();
    await store(fs).append([
      record({ id: 'a', at: new Date(2026, 5, 1) }),
      record({ id: 'b', networkName: 'OFTC', at: new Date(2026, 5, 1) }),
    ]);

    await store(fs).purge(new Date(2026, 7, 1), 'n1');

    expect(fs.files.has('Libera.Chat/#marmotter.log')).toBe(false);
    expect(fs.files.has('OFTC/#marmotter.log')).toBe(true);
  });
});

describe('export, location and clearing', () => {
  it('exports a transcript that runs forwards', async () => {
    // A search result list is newest first; a transcript somebody reads is not.
    const fs = memoryFs();
    await store(fs).append([
      record({ id: 'a', text: 'first', at: new Date(2026, 7, 12, 9, 0, 0) }),
      record({ id: 'b', text: 'second', at: new Date(2026, 7, 12, 10, 0, 0) }),
    ]);

    await store(fs).export({ text: '', limit: 100 }, '/home/tamsin/marmotter.log');

    expect(fs.files.get('/home/tamsin/marmotter.log')).toBe(
      'Aug 12 09:00:00 <tamsin>\tfirst\nAug 12 10:00:00 <tamsin>\tsecond\n',
    );
  });

  it('exports an empty file rather than failing when nothing matches', async () => {
    const fs = memoryFs();
    await store(fs).export({ text: 'nothing here', limit: 100 }, '/home/tamsin/marmotter.log');
    expect(fs.files.get('/home/tamsin/marmotter.log')).toBe('');
  });

  it('reports where the logs are and what they cost', async () => {
    const fs = memoryFs();
    await store(fs).append([record()]);

    const location = await store(fs).location();
    expect(location.path).toBe('/logs');
    expect(location.bytes).toBeGreaterThan(0);
  });

  it('opens the folder rather than a file inside it', async () => {
    const fs = memoryFs();
    await store(fs).reveal?.();
    expect(fs.revealed).toEqual(['/logs']);
  });

  /**
   * Android has no file manager that will open an app's own storage, so its
   * shell supplies no `reveal` and the settings screen hides the button. The
   * store has to leave the method off for that to be visible — a method that
   * resolved without doing anything would draw a button that lies.
   */
  it('offers no way to open the folder where the platform cannot', () => {
    const { reveal: _reveal, ...withoutReveal } = memoryFs();
    expect(store(withoutReveal).reveal).toBeUndefined();
  });

  it('clears everything and says how much went', async () => {
    const fs = memoryFs();
    await store(fs).append([record({ id: 'a' }), record({ id: 'b', target: 'jonquil' })]);

    expect(await store(fs).clear()).toBe(2);
    expect(fs.files.size).toBe(0);
  });
});
