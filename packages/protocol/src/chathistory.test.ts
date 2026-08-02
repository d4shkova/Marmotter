import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HISTORY_PAGE,
  LATEST,
  chatHistoryLine,
  clampHistoryPage,
  formatHistoryTimestamp,
  formatMessageRef,
  historyTargetsLine,
  latestHistoryLine,
  maxHistoryPage,
  missedHistoryLine,
  olderHistoryLine,
  supportsChatHistory,
} from './chathistory.js';
import { DEFAULT_ISUPPORT, type ISupport, applyISupport } from './isupport.js';

const withTokens = (...tokens: string[]): ISupport => applyISupport(DEFAULT_ISUPPORT, tokens);

const server = withTokens('CHATHISTORY=50');

describe('ISUPPORT parsing', () => {
  it('reads CHATHISTORY', () => {
    expect(server.chatHistory).toBe(50);
    expect(supportsChatHistory(server)).toBe(true);
  });

  it('treats the draft token as the same thing', () => {
    expect(withTokens('draft/CHATHISTORY=25').chatHistory).toBe(25);
  });

  it('lets the ratified token win when a server sends both', () => {
    expect(withTokens('draft/CHATHISTORY=25', 'CHATHISTORY=100').chatHistory).toBe(100);
    // Order within the line must not change the answer.
    expect(withTokens('CHATHISTORY=100', 'draft/CHATHISTORY=25').chatHistory).toBe(100);
  });

  it('reports no history when the token is absent', () => {
    expect(DEFAULT_ISUPPORT.chatHistory).toBeUndefined();
    expect(supportsChatHistory(DEFAULT_ISUPPORT)).toBe(false);
  });

  it('forgets history when the token is negated', () => {
    const later = applyISupport(server, ['-CHATHISTORY']);
    expect(supportsChatHistory(later)).toBe(false);
  });

  it('keeps the value when a later 005 line does not mention it', () => {
    expect(applyISupport(server, ['NETWORK=TestNet']).chatHistory).toBe(50);
  });

  it('ignores a non-numeric limit rather than guessing one', () => {
    expect(withTokens('CHATHISTORY=lots').chatHistory).toBeUndefined();
  });

  it('reads MSGREFTYPES in the order the server states', () => {
    expect(withTokens('MSGREFTYPES=msgid,timestamp').msgRefTypes).toEqual(['msgid', 'timestamp']);
  });

  it('defaults to both reference types', () => {
    expect(DEFAULT_ISUPPORT.msgRefTypes).toEqual(['timestamp', 'msgid']);
  });

  it('reads an empty MSGREFTYPES as accepting neither', () => {
    expect(withTokens('MSGREFTYPES=').msgRefTypes).toEqual([]);
  });
});

describe('page sizes', () => {
  it('clamps a request to what the server will serve', () => {
    expect(clampHistoryPage(500, server)).toBe(50);
    expect(clampHistoryPage(10, server)).toBe(10);
  });

  it('treats CHATHISTORY=0 as no stated ceiling', () => {
    const unlimited = withTokens('CHATHISTORY=0');
    expect(maxHistoryPage(unlimited)).toBe(DEFAULT_HISTORY_PAGE);
    expect(clampHistoryPage(500, unlimited)).toBe(DEFAULT_HISTORY_PAGE);
  });

  it('falls back to the default for a nonsensical request', () => {
    expect(clampHistoryPage(0, server)).toBe(50);
    expect(clampHistoryPage(-5, server)).toBe(50);
    expect(clampHistoryPage(Number.NaN, server)).toBe(50);
  });

  it('never asks for a fractional page', () => {
    expect(clampHistoryPage(10.7, server)).toBe(10);
  });
});

describe('message references', () => {
  const at = new Date('2026-08-02T09:00:00.000Z');

  it('formats a timestamp in UTC with milliseconds', () => {
    expect(formatHistoryTimestamp(at)).toBe('2026-08-02T09:00:00.000Z');
    expect(formatMessageRef({ kind: 'timestamp', at }, server)).toBe(
      'timestamp=2026-08-02T09:00:00.000Z',
    );
  });

  it('formats a msgid', () => {
    expect(formatMessageRef({ kind: 'msgid', id: 'abc' }, server)).toBe('msgid=abc');
  });

  it('formats the open-ended selector', () => {
    expect(formatMessageRef(LATEST, server)).toBe('*');
  });

  it('refuses a reference type the server does not accept', () => {
    const timestampOnly = withTokens('CHATHISTORY=50', 'MSGREFTYPES=timestamp');
    expect(formatMessageRef({ kind: 'msgid', id: 'abc' }, timestampOnly)).toBeUndefined();
    expect(formatMessageRef({ kind: 'timestamp', at }, timestampOnly)).toBe(
      'timestamp=2026-08-02T09:00:00.000Z',
    );
  });

  it('still allows the open-ended selector when no reference type is accepted', () => {
    expect(formatMessageRef(LATEST, withTokens('CHATHISTORY=50', 'MSGREFTYPES='))).toBe('*');
  });
});

describe('building requests', () => {
  const at = new Date('2026-08-02T09:00:00.000Z');

  it('asks for the newest page on join', () => {
    expect(latestHistoryLine('#test', server)).toEqual({
      ok: true,
      line: 'CHATHISTORY LATEST #test * 50',
      limit: 50,
    });
  });

  it('honours an explicit page size', () => {
    expect(latestHistoryLine('#test', server, 20)).toEqual({
      ok: true,
      line: 'CHATHISTORY LATEST #test * 20',
      limit: 20,
    });
  });

  it('pages backwards from a known message', () => {
    expect(olderHistoryLine('#test', { kind: 'msgid', id: 'm1' }, server, 25)).toEqual({
      ok: true,
      line: 'CHATHISTORY BEFORE #test msgid=m1 25',
      limit: 25,
    });
  });

  it('pages backwards by timestamp when that is all the server takes', () => {
    const timestampOnly = withTokens('CHATHISTORY=50', 'MSGREFTYPES=timestamp');
    expect(olderHistoryLine('#test', { kind: 'timestamp', at }, timestampOnly)).toEqual({
      ok: true,
      line: 'CHATHISTORY BEFORE #test timestamp=2026-08-02T09:00:00.000Z 50',
      limit: 50,
    });
  });

  it('asks for what was missed while disconnected', () => {
    expect(missedHistoryLine('#test', { kind: 'msgid', id: 'm9' }, server)).toEqual({
      ok: true,
      line: 'CHATHISTORY AFTER #test msgid=m9 50',
      limit: 50,
    });
    expect(missedHistoryLine('#test', { kind: 'msgid', id: 'm9' }, server, 5).ok).toBe(true);
  });

  it('builds a bounded range', () => {
    const result = chatHistoryLine(
      {
        subcommand: 'BETWEEN',
        target: '#test',
        from: { kind: 'msgid', id: 'm1' },
        to: { kind: 'msgid', id: 'm9' },
        limit: 10,
      },
      server,
    );
    expect(result).toEqual({
      ok: true,
      line: 'CHATHISTORY BETWEEN #test msgid=m1 msgid=m9 10',
      limit: 10,
    });
  });

  it('leaves a range open-ended when no end is given', () => {
    const result = chatHistoryLine(
      { subcommand: 'BETWEEN', target: '#test', from: { kind: 'msgid', id: 'm1' } },
      server,
    );
    expect(result).toEqual({
      ok: true,
      line: 'CHATHISTORY BETWEEN #test msgid=m1 * 50',
      limit: 50,
    });
  });

  it('centres a page on a message', () => {
    const result = chatHistoryLine(
      { subcommand: 'AROUND', target: '#test', from: { kind: 'msgid', id: 'm5' } },
      server,
    );
    expect(result.ok && result.line).toBe('CHATHISTORY AROUND #test msgid=m5 50');
  });

  it('refuses to build anything for a server with no history', () => {
    expect(latestHistoryLine('#test', DEFAULT_ISUPPORT)).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('refuses a selector the server cannot read', () => {
    const timestampOnly = withTokens('CHATHISTORY=50', 'MSGREFTYPES=timestamp');
    expect(olderHistoryLine('#test', { kind: 'msgid', id: 'm1' }, timestampOnly)).toEqual({
      ok: false,
      reason: 'unsupported-ref-type',
    });
  });

  it('refuses a range whose far end the server cannot read', () => {
    const timestampOnly = withTokens('CHATHISTORY=50', 'MSGREFTYPES=timestamp');
    expect(
      chatHistoryLine(
        {
          subcommand: 'BETWEEN',
          target: '#test',
          from: { kind: 'timestamp', at },
          to: { kind: 'msgid', id: 'm9' },
        },
        timestampOnly,
      ),
    ).toEqual({ ok: false, reason: 'unsupported-ref-type' });
  });
});

describe('TARGETS', () => {
  const after = new Date('2026-08-01T00:00:00.000Z');
  const before = new Date('2026-08-02T00:00:00.000Z');

  it('asks which conversations were active in a window', () => {
    expect(historyTargetsLine(after, before, server)).toEqual({
      ok: true,
      line: 'CHATHISTORY TARGETS timestamp=2026-08-01T00:00:00.000Z timestamp=2026-08-02T00:00:00.000Z 50',
      limit: 50,
    });
  });

  it('honours an explicit limit', () => {
    expect(historyTargetsLine(after, before, server, 5).ok && true).toBe(true);
    const result = historyTargetsLine(after, before, server, 5);
    expect(result.ok && result.limit).toBe(5);
  });

  it('is unavailable without history', () => {
    expect(historyTargetsLine(after, before, DEFAULT_ISUPPORT)).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('is unavailable when the server takes no timestamps', () => {
    const noTimestamps = withTokens('CHATHISTORY=50', 'MSGREFTYPES=msgid');
    expect(historyTargetsLine(after, before, noTimestamps)).toEqual({
      ok: false,
      reason: 'unsupported-ref-type',
    });
  });
});
