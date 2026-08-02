import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BatchTracker, LabelTracker } from './batch.js';
import { beginNegotiation, handleCapMessage, type CapState } from './caps.js';
import { decodeAction, extractCtcp } from './ctcp.js';
import {
  DEFAULT_ISUPPORT,
  type ISupport,
  applyISupport,
  buildExtban,
  supportsExtban,
} from './isupport.js';
import { NICK_UNAVAILABLE, interpretNumeric } from './numerics.js';
import { parseMessage } from './parse.js';
import { parseStandardReply } from './standard-replies.js';

/**
 * Real session transcripts, replayed through the whole stack.
 *
 * The unit tests prove each piece in isolation; these prove the pieces agree
 * with what three different server implementations actually send. Libera runs
 * solanum, OFTC runs hybrid, and ergo is its own thing with the newest
 * extensions — between them they cover most of what the client will meet.
 */

interface Line {
  readonly direction: 'in' | 'out';
  readonly raw: string;
  readonly number: number;
}

/** Decodes the `\xNN` escapes the fixtures use for control bytes. */
const unescapeBytes = (text: string): string =>
  text.replace(/\\x([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

const load = (name: string): readonly Line[] => {
  const path = fileURLToPath(new URL(`./__fixtures__/transcripts/${name}.txt`, import.meta.url));
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim() !== '' && !line.startsWith('#'))
    .map(({ line, index }) => ({
      direction: line.startsWith('>') ? ('out' as const) : ('in' as const),
      raw: unescapeBytes(line.slice(2)),
      number: index + 1,
    }));
};

interface Replay {
  readonly support: ISupport;
  readonly caps: CapState;
  readonly numericKinds: string[];
  readonly closedBatches: { type: string; count: number }[];
  readonly labeledResponses: string[];
  readonly standardReplies: string[];
  readonly nickRefusals: string[];
  readonly actions: string[];
  readonly channels: Map<string, string[]>;
  readonly listEntries: { list: string; mask: string }[];
}

/** Feeds a whole transcript through the stack the client will use. */
const replay = (lines: readonly Line[], options: { wantsSasl: boolean }): Replay => {
  let support = DEFAULT_ISUPPORT;
  let caps = beginNegotiation().state;
  const batches = new BatchTracker();
  const labels = new LabelTracker();

  const numericKinds: string[] = [];
  const closedBatches: { type: string; count: number }[] = [];
  const labeledResponses: string[] = [];
  const standardReplies: string[] = [];
  const nickRefusals: string[] = [];
  const actions: string[] = [];
  const channels = new Map<string, string[]>();
  const listEntries: { list: string; mask: string }[] = [];

  for (const line of lines) {
    const result = parseMessage(line.raw);
    expect(result.ok, `line ${line.number} failed to parse: ${line.raw}`).toBe(true);
    if (!result.ok) {
      continue;
    }
    const message = result.message;

    // Outgoing lines are checked for parseability only; the server drives state.
    if (line.direction === 'out') {
      const label = message.tags.get('label');
      if (label !== undefined) {
        labels.expect(label);
      }
      continue;
    }

    const event = batches.handle(message);
    const response = labels.handle(event);
    if (response !== undefined) {
      labeledResponses.push(response.label);
    }
    if (event.kind === 'closed') {
      closedBatches.push({ type: event.batch.type, count: event.batch.messages.length });
    }

    if (message.command === 'CAP') {
      caps = handleCapMessage(caps, message, { wantsSasl: options.wantsSasl }).state;
      continue;
    }

    const reply = parseStandardReply(message);
    if (reply !== undefined) {
      standardReplies.push(`${reply.severity}:${reply.code}`);
      continue;
    }

    if (message.command === 'PRIVMSG') {
      const body = message.params[1] ?? '';
      const action = decodeAction(body);
      if (action !== undefined) {
        actions.push(action);
      } else {
        // Any CTCP that is not an ACTION must still decode without throwing.
        extractCtcp(body);
      }
      continue;
    }

    if (!/^\d{3}$/.test(message.command)) {
      continue;
    }

    if (NICK_UNAVAILABLE.has(message.command)) {
      nickRefusals.push(message.command);
    }

    const numeric = interpretNumeric(message, support);
    numericKinds.push(numeric.kind);

    if (numeric.kind === 'isupport') {
      support = applyISupport(support, numeric.tokens);
    } else if (numeric.kind === 'list-entry') {
      listEntries.push({ list: numeric.list, mask: numeric.mask });
    } else if (numeric.kind === 'names') {
      const existing = channels.get(numeric.channel) ?? [];
      channels.set(numeric.channel, [
        ...existing,
        ...numeric.members.map((m) => `${m.prefixes}${m.nick}`),
      ]);
    }
  }

  return {
    support,
    caps,
    numericKinds,
    closedBatches,
    labeledResponses,
    standardReplies,
    nickRefusals,
    actions,
    channels,
    listEntries,
  };
};

describe('Libera.Chat transcript', () => {
  const lines = load('libera');
  const state = replay(lines, { wantsSasl: true });

  it('parses every line', () => {
    expect(lines.length).toBeGreaterThan(30);
  });

  it('negotiates the capabilities the UX depends on', () => {
    for (const cap of ['sasl', 'server-time', 'echo-message', 'multi-prefix', 'extended-join']) {
      expect(state.caps.enabled.has(cap), cap).toBe(true);
    }
  });

  it('reads the network name and limits from ISUPPORT', () => {
    expect(state.support.network).toBe('Libera.Chat');
    expect(state.support.maxNickLength).toBe(16);
    expect(state.support.chanTypes).toBe('#');
    expect(state.support.caseMapping).toBe('rfc1459');
    expect(state.support.modesPerCommand).toBe(4);
    expect(state.support.whox).toBe(true);
    expect(state.support.utf8Only).toBe(true);
  });

  it('reads the prefix and mode groups solanum advertises', () => {
    expect(state.support.prefixes).toEqual([
      { mode: 'o', prefix: '@' },
      { mode: 'v', prefix: '+' },
    ]);
    expect(state.support.chanModes.list).toBe('eIbq');
    expect(state.support.chanModes.parameter).toBe('k');
    expect(state.support.excepts).toBe('e');
    expect(state.support.invex).toBe('I');
  });

  it('reads the member list with prefixes split off', () => {
    expect(state.channels.get('#marmotter')).toEqual([
      '@jonquil',
      '+emilyp',
      'tamsin',
      'd4shkova',
      'rho',
    ]);
  });

  it('collapses the MOTD rather than leaving loose lines', () => {
    expect(state.numericKinds).toContain('motd-start');
    expect(state.numericKinds).toContain('motd-line');
    expect(state.numericKinds).toContain('motd-end');
  });

  it('reads the ACTION as an action, not as message text', () => {
    expect(state.actions).toEqual(['puts the kettle on']);
  });

  it('leaves no numeric unhandled', () => {
    expect(state.numericKinds).not.toContain('unhandled');
  });
});

describe('OFTC transcript', () => {
  const lines = load('oftc');
  const state = replay(lines, { wantsSasl: true });

  it('copes with a server that refuses every capability', () => {
    expect(state.caps.enabled.size).toBe(0);
    expect(state.caps.rejected.size).toBeGreaterThan(0);
    // A network supporting none of these must still be fully usable.
    expect(state.support.network).toBe('OFTC');
  });

  it('surfaces the nick collision', () => {
    expect(state.nickRefusals).toEqual(['433']);
  });

  it('reads hybrid’s half-op prefix, which solanum does not have', () => {
    expect(state.support.prefixes).toEqual([
      { mode: 'o', prefix: '@' },
      { mode: 'h', prefix: '%' },
      { mode: 'v', prefix: '+' },
    ]);
  });

  it('accepts two channel types', () => {
    expect(state.support.chanTypes).toBe('#&');
    expect(state.support.chanLimit.get('#')).toBe(20);
    expect(state.support.chanLimit.get('&')).toBe(20);
  });

  it('splits a member carrying several prefixes', () => {
    expect(state.channels.get('#debian')?.[0]).toBe('@%+opper');
  });

  it('treats a missing MOTD as the end of registration', () => {
    expect(state.numericKinds).toContain('no-motd');
  });

  it('turns the operator-rights error into a sentence', () => {
    // 482 must never reach the message list as a number.
    expect(state.numericKinds).toContain('error');
  });
});

describe('ergo transcript', () => {
  const lines = load('ergo');
  const state = replay(lines, { wantsSasl: true });

  it('handles a multi-line CAP LS', () => {
    expect(state.caps.listComplete).toBe(true);
    expect(state.caps.available.size).toBeGreaterThan(20);
    expect(state.caps.enabled.has('labeled-response')).toBe(true);
    expect(state.caps.enabled.has('draft/chathistory')).toBe(true);
    expect(state.caps.enabled.has('+draft/reply')).toBe(true);
  });

  it('reads the five-role prefix set', () => {
    expect(state.support.prefixes.map((p) => p.prefix).join('')).toBe('~&@%+');
    expect(state.support.caseMapping).toBe('ascii');
  });

  it('groups the chat history backfill into one batch', () => {
    const history = state.closedBatches.find((b) => b.type === 'chathistory');
    expect(history).toEqual({ type: 'chathistory', count: 3 });
  });

  it('correlates every labelled command with its reply', () => {
    // Two batched responses and one single tagged reply.
    expect(state.labeledResponses.sort()).toEqual(['mm1', 'mm2', 'mm3']);
  });

  it('groups the WHO reply into a labeled-response batch', () => {
    const who = state.closedBatches.find((b) => b.type === 'labeled-response');
    expect(who).toEqual({ type: 'labeled-response', count: 2 });
  });

  it('reads the standard replies rather than falling back to numerics', () => {
    expect(state.standardReplies).toEqual([
      'fail:CHANNEL_FULL',
      'warn:CONFIG_OUTDATED',
      'note:TEST_NOTE',
    ]);
  });

  it('reads the member list with every role', () => {
    expect(state.channels.get('#test')).toEqual([
      '~founder',
      '&admin',
      '@op',
      '%halfop',
      '+voice',
      'tester',
    ]);
  });

  it('leaves no numeric unhandled', () => {
    expect(state.numericKinds).not.toContain('unhandled');
  });
});

describe('UnrealIRCd transcript', () => {
  // The software running irc.dashkova.co.uk, so this network is a first-class
  // target rather than something we hope works.
  const lines = load('unrealircd');
  const state = replay(lines, { wantsSasl: true });

  it('reads the network and the five member roles', () => {
    expect(state.support.network).toBe('Dashkova');
    expect(state.support.prefixes.map((p) => p.prefix).join('')).toBe('~&@%+');
    expect(state.support.caseMapping).toBe('ascii');
    expect(state.support.maxNickLength).toBe(30);
    expect(state.support.modesPerCommand).toBe(12);
  });

  it('reads the extended ban prefix, which differs from solanum', () => {
    expect(state.support.extban).toEqual({ prefix: '~', types: 'BGNRSacfjmnqrtz' });
  });

  it('builds an account ban with this network’s prefix', () => {
    // The same scope on Libera would be `$a:spammer`; hardcoding either one
    // would produce a mask the other network reads as a literal nickname.
    expect(buildExtban('a', 'spammer', state.support)).toBe('~a:spammer');
    expect(supportsExtban('a', state.support)).toBe(true);
    expect(supportsExtban('Z', state.support)).toBe(false);
    expect(buildExtban('Z', 'x', state.support)).toBeUndefined();
  });

  it('reads WATCH rather than MONITOR for the notify list', () => {
    expect(state.support.watch).toEqual({ supported: true, limit: 128 });
    expect(state.support.monitor.supported).toBe(false);
  });

  it('reads an extended ban out of the ban list', () => {
    // A ban on an account, not a hostmask — the case the ban builder exists for.
    expect(state.listEntries).toContainEqual({ list: 'ban', mask: '~a:spammer' });
    expect(state.listEntries).toContainEqual({ list: 'ban', mask: '*!*@bad.example' });
  });

  it('reads the member list with every role', () => {
    expect(state.channels.get('#lounge')).toEqual([
      '~d4shkova',
      '&admin',
      '@op',
      '%halfop',
      '+voiced',
      'plain',
    ]);
  });

  it('reads the standard reply', () => {
    expect(state.standardReplies).toEqual(['fail:CHANNEL_FULL']);
  });

  it('leaves no numeric unhandled except ones outside the map', () => {
    // 604 (RPL_NOWON, from WATCH) is not in the numeric table yet; it is
    // reported as `unhandled` rather than leaking as a raw line, which is the
    // contract. Phase 6 adds the WATCH numerics with the Friends panel.
    const unexpected = state.numericKinds.filter((kind) => kind === 'unhandled');
    expect(unexpected).toHaveLength(1);
  });
});

describe('every transcript', () => {
  it.each(['libera', 'oftc', 'ergo', 'unrealircd'])('%s parses with no failures at all', (name) => {
    for (const line of load(name)) {
      const result = parseMessage(line.raw);
      expect(result.ok, `line ${line.number}: ${line.raw}`).toBe(true);
    }
  });

  it.each(['libera', 'oftc', 'ergo', 'unrealircd'])('%s closes every batch it opens', (name) => {
    const tracker = new BatchTracker();
    for (const line of load(name)) {
      if (line.direction !== 'in') {
        continue;
      }
      const result = parseMessage(line.raw);
      if (result.ok) {
        tracker.handle(result.message);
      }
    }
    expect(tracker.openReferences).toEqual([]);
  });
});
