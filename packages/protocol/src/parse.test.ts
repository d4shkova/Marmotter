import { describe, expect, it } from 'vitest';
import msgSplit from './__fixtures__/parser-tests/msg-split.json' with { type: 'json' };
import msgJoin from './__fixtures__/parser-tests/msg-join.json' with { type: 'json' };
import userhostSplit from './__fixtures__/parser-tests/userhost-split.json' with { type: 'json' };
import { parseMessage } from './parse.js';
import { serializeMessage } from './serialize.js';
import { parseSource } from './source.js';
import { message } from './message.js';

interface Atoms {
  tags?: Record<string, string>;
  source?: string;
  verb?: string;
  params?: string[];
}

const parsed = (line: string) => {
  const result = parseMessage(line);
  if (!result.ok) {
    throw new Error(`expected ${JSON.stringify(line)} to parse, got ${result.reason}`);
  }
  return result.message;
};

const serialized = (msg: Parameters<typeof serializeMessage>[0]) => {
  const result = serializeMessage(msg);
  if (!result.ok) {
    throw new Error(`expected serialization to succeed, got ${result.reason}`);
  }
  return result.line;
};

describe('ircdocs msg-split vectors', () => {
  const cases = msgSplit.tests as { input: string; atoms: Atoms }[];

  it('covers the whole upstream file', () => {
    expect(cases.length).toBe(35);
  });

  it.each(cases.map((c) => [c.input, c] as const))('splits %j', (_input, testCase) => {
    const msg = parsed(testCase.input);
    const atoms = testCase.atoms;

    expect(Object.fromEntries(msg.tags)).toEqual(atoms.tags ?? {});
    expect(msg.source?.raw).toBe(atoms.source);
    // Vectors record the verb as sent; `command` is normalised, so compare
    // against the wire form the message round-trips with.
    expect(msg.rawCommand ?? msg.command).toBe(atoms.verb);
    expect(msg.params).toEqual(atoms.params ?? []);
  });
});

describe('ircdocs msg-join vectors', () => {
  const cases = msgJoin.tests as { desc?: string; atoms: Atoms; matches: string[] }[];

  it('covers the whole upstream file', () => {
    expect(cases.length).toBe(18);
  });

  it.each(cases.map((c, i) => [c.desc ?? `case ${i}`, c] as const))(
    'joins %s',
    (_desc, testCase) => {
      const atoms = testCase.atoms;
      const line = serialized(
        message({
          tags: new Map(Object.entries(atoms.tags ?? {})),
          source: atoms.source === undefined ? undefined : parseSource(atoms.source),
          command: atoms.verb ?? '',
          params: atoms.params ?? [],
        }),
      );

      expect(testCase.matches).toContain(line);
    },
  );
});

describe('ircdocs userhost-split vectors', () => {
  const cases = userhostSplit.tests as { source: string; atoms: Partial<Atoms> }[];

  it('covers the whole upstream file', () => {
    expect(cases.length).toBe(7);
  });

  it.each(cases.map((c) => [c.source, c] as const))('splits %j', (_source, testCase) => {
    const source = parseSource(testCase.source);
    const atoms = testCase.atoms as { nick?: string; user?: string; host?: string };

    expect(source.nick).toBe(atoms.nick ?? '');
    expect(source.user).toBe(atoms.user ?? '');
    expect(source.host).toBe(atoms.host ?? '');
  });
});

describe('round trip', () => {
  const lines = (msgSplit.tests as { input: string }[]).map((c) => c.input);

  it.each(lines)('re-serializes %j to a line that parses identically', (input) => {
    const first = parsed(input);
    const line = serialized(first);
    const second = parsed(line);

    expect(Object.fromEntries(second.tags)).toEqual(Object.fromEntries(first.tags));
    expect(second.source?.raw).toBe(first.source?.raw);
    expect(second.command).toBe(first.command);
    expect(second.params).toEqual(first.params);
  });
});

describe('parse failures', () => {
  it.each(['', '   ', '\r\n', '@only=tags', '@only=tags   ', ':source', ':source  '])(
    'reports %j as a typed failure rather than throwing',
    (input) => {
      const result = parseMessage(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(['empty', 'missing-command']).toContain(result.reason);
        expect(result.input).toBe(input);
      }
    },
  );
});

describe('parse details', () => {
  it('strips a trailing CRLF', () => {
    expect(parsed('PING :hello\r\n').params).toEqual(['hello']);
  });

  it('treats runs of spaces between atoms as one separator', () => {
    const msg = parsed(':src   COMMAND   a    b   :c  d');
    expect(msg.command).toBe('COMMAND');
    expect(msg.params).toEqual(['a', 'b', 'c  d']);
  });

  it('keeps an empty trailing parameter', () => {
    expect(parsed('AWAY :').params).toEqual(['']);
  });

  it('does not invent a parameter from a trailing space', () => {
    expect(parsed('MODE #chan +n ').params).toEqual(['#chan', '+n']);
  });

  it('normalises the verb but remembers the wire form', () => {
    const msg = parsed('privmsg #chan :hi');
    expect(msg.command).toBe('PRIVMSG');
    expect(msg.rawCommand).toBe('privmsg');
    // The trailing colon is optional for this parameter, so serialization drops
    // it; the verb keeps its original case.
    expect(serialized(msg)).toBe('privmsg #chan hi');
  });

  it('keeps the trailing colon when the parameter requires it', () => {
    expect(serialized(parsed('privmsg #chan :hi there'))).toBe('privmsg #chan :hi there');
  });

  it('leaves an already-uppercase verb without a wire form override', () => {
    expect(parsed('PRIVMSG #chan :hi').rawCommand).toBeUndefined();
  });

  it('keeps a tab inside a parameter rather than splitting on it', () => {
    expect(parsed('COMMAND a\tb c').params).toEqual(['a\tb', 'c']);
  });
});

describe('serialize failures', () => {
  it('refuses a verb containing a space', () => {
    const result = serializeMessage(message({ command: 'TWO WORDS' }));
    expect(result).toEqual({ ok: false, reason: 'invalid-command' });
  });

  it('refuses an empty verb', () => {
    expect(serializeMessage(message({ command: '' }))).toEqual({
      ok: false,
      reason: 'invalid-command',
    });
  });

  it('refuses a non-final parameter that would not survive a round trip', () => {
    const result = serializeMessage(message({ command: 'FOO', params: ['a b', 'c'] }));
    expect(result).toEqual({ ok: false, reason: 'ambiguous-parameter' });
  });

  it('refuses an empty non-final parameter', () => {
    expect(serializeMessage(message({ command: 'FOO', params: ['', 'c'] }))).toEqual({
      ok: false,
      reason: 'ambiguous-parameter',
    });
  });
});
