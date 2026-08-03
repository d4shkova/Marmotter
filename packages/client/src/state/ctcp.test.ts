import { DEFAULT_CTCP_POLICY } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import type { ReduceContext } from './reduce.js';
import { feed, registeredSession } from './harness.js';

const DELIM = '\u0001';
const request = (command: string, params = ''): string =>
  `:tamsin!~t@host.example PRIVMSG marmot :${DELIM}${command}${params === '' ? '' : ` ${params}`}${DELIM}`;

const context = (overrides: Partial<ReduceContext> = {}): ReduceContext => ({
  altNicks: [],
  wantsSasl: false,
  now: () => new Date('2026-08-03T05:00:00.000Z'),
  ...overrides,
});

const answersTo = (line: string, ctx = context()) => feed(registeredSession(), [line], ctx).sent;

describe('answering automated requests', () => {
  it('says what client this is', () => {
    expect(answersTo(request('VERSION'))).toEqual([
      `NOTICE tamsin :${DELIM}VERSION Marmotter${DELIM}`,
    ]);
  });

  // The payload is the asker's, not ours: they time the round trip against
  // whatever they sent. Answering with anything else breaks the measurement.
  it('echoes a round-trip check unchanged', () => {
    expect(answersTo(request('PING', '1754196000'))).toEqual([
      `NOTICE tamsin :${DELIM}PING 1754196000${DELIM}`,
    ]);
  });

  it('answers the clock as an instant rather than a formatted local time', () => {
    expect(answersTo(request('TIME'))).toEqual([
      `NOTICE tamsin :${DELIM}TIME 2026-08-03T05:00:00.000Z${DELIM}`,
    ]);
  });

  it('answers nothing at all when the answer is switched off', () => {
    const ctx = context({ ctcp: { ...DEFAULT_CTCP_POLICY, version: false } });
    expect(answersTo(request('VERSION'), ctx)).toEqual([]);
  });

  // Advertising a request that is switched off invites one this client then
  // ignores, which reads as broken rather than private.
  it('lists only the answers that are switched on', () => {
    const ctx = context({ ctcp: { ...DEFAULT_CTCP_POLICY, time: false, ping: false } });
    expect(answersTo(request('CLIENTINFO'), ctx)).toEqual([
      `NOTICE tamsin :${DELIM}CLIENTINFO ACTION VERSION CLIENTINFO${DELIM}`,
    ]);
  });

  it('leaves a request it does not implement unanswered', () => {
    expect(answersTo(request('USERINFO'))).toEqual([]);
  });

  it('uses the version string the profile set, when it set one', () => {
    const ctx = context({ ctcp: { ...DEFAULT_CTCP_POLICY, versionText: 'Something else' } });
    expect(answersTo(request('VERSION'), ctx)).toEqual([
      `NOTICE tamsin :${DELIM}VERSION Something else${DELIM}`,
    ]);
  });

  it('never answers a CTCP reply, which would be an endless exchange', () => {
    const reply = `:tamsin!~t@host.example NOTICE marmot :${DELIM}VERSION HexChat${DELIM}`;
    expect(answersTo(reply)).toEqual([]);
  });
});

describe('what a request looks like in the interface', () => {
  const noticesFor = (line: string) => feed(registeredSession(), [line], context()).state;

  // CLAUDE.md: a CTCP is surfaced as a quiet notice, never as a message.
  it('files a request as a notice, not as conversation', () => {
    const state = noticesFor(request('VERSION'));
    expect(state.queries.get('tamsin')?.messages ?? []).toEqual([]);
    expect(state.serverNotices.at(-1)?.text).toBe(
      'tamsin asked for what client you use. Marmotter answered.',
    );
  });

  it('says so when it did not answer', () => {
    const state = feed(registeredSession(), [request('VERSION')], {
      ...context(),
      ctcp: { ...DEFAULT_CTCP_POLICY, version: false },
    }).state;
    expect(state.serverNotices.at(-1)?.text).toBe(
      'tamsin asked for what client you use. Marmotter did not answer.',
    );
  });

  it('names what was asked in plain English, never as a raw token', () => {
    const state = noticesFor(request('TIME'));
    expect(state.serverNotices.at(-1)?.text).toContain('your clock');
    expect(state.serverNotices.at(-1)?.text).not.toContain('TIME');
  });

  it('files somebody answering us as a notice too', () => {
    const state = noticesFor(
      `:tamsin!~t@host.example NOTICE marmot :${DELIM}VERSION HexChat${DELIM}`,
    );
    expect(state.serverNotices.at(-1)?.text).toBe('tamsin answered: what client you use');
  });

  it('leaves an ACTION alone, because that one is conversation', () => {
    const state = noticesFor(
      `:tamsin!~t@host.example PRIVMSG marmot :${DELIM}ACTION waves${DELIM}`,
    );
    expect(state.queries.get('tamsin')?.messages.at(-1)?.kind).toBe('action');
    expect(state.queries.get('tamsin')?.messages.at(-1)?.text).toBe('waves');
  });
});
