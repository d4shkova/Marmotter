import { describe, expect, it } from 'vitest';
import type { ReduceContext } from './reduce.js';
import { feed, registeredSession } from './harness.js';

const DELIM = '\u0001';

const context = (overrides: Partial<ReduceContext> = {}): ReduceContext => ({
  altNicks: [],
  wantsSasl: false,
  now: () => new Date('2026-08-03T05:00:00.000Z'),
  ...overrides,
});

/** A `DCC SEND` arriving as a CTCP in a PRIVMSG. */
const dccSend = (params: string, target = 'marmot'): string =>
  `:tamsin!~t@host.example PRIVMSG ${target} :${DELIM}DCC SEND ${params}${DELIM}`;

/** Only the offers, dropping the registration effects the harness carries in. */
const dccEffects = (line: string, target = 'marmot') =>
  feed(registeredSession(), [dccSend(line, target)], context()).effects.filter(
    (effect) => effect.kind === 'dcc-offer',
  );

describe('a DCC offer', () => {
  it('raises an effect the session can hand to the file monitor', () => {
    // 3232235777 = 192.168.1.1
    expect(dccEffects('holiday.jpg 3232235777 5000 204800')).toEqual([
      {
        kind: 'dcc-offer',
        from: 'tamsin',
        target: 'tamsin',
        send: {
          filename: 'holiday.jpg',
          host: '192.168.1.1',
          port: 5000,
          size: 204800,
          passive: false,
          secure: false,
          turbo: false,
        },
      },
    ]);
  });

  it('files it as a plain-words notice, never as a message', () => {
    const { state } = feed(
      registeredSession(),
      [dccSend('holiday.jpg 3232235777 5000 1')],
      context(),
    );
    expect(state.queries.get('tamsin')?.messages ?? []).toEqual([]);
    expect(state.serverNotices.at(-1)?.text).toBe(
      'tamsin offered you the file “holiday.jpg”. Open the file monitor to download it.',
    );
  });

  it('never answers a DCC as a CTCP reply', () => {
    const { sent } = feed(
      registeredSession(),
      [dccSend('holiday.jpg 3232235777 5000 1')],
      context(),
    );
    expect(sent).toEqual([]);
  });

  it('marks a passive offer as one it cannot fetch', () => {
    const { state } = feed(
      registeredSession(),
      [dccSend('file.bin 3232235777 0 4096 998877')],
      context(),
    );
    expect(dccEffects('file.bin 3232235777 0 4096 998877')[0]).toMatchObject({
      kind: 'dcc-offer',
      send: { passive: true, token: '998877' },
    });
    expect(state.serverNotices.at(-1)?.text).toContain("can't fetch it");
  });

  it('files it in the channel it arrived in', () => {
    expect(dccEffects('shared.zip 3232235777 5000 1', '#marmotter')[0]).toMatchObject({
      kind: 'dcc-offer',
      target: '#marmotter',
    });
  });

  it('leaves a malformed DCC line as an ordinary unhandled CTCP', () => {
    const { state } = feed(
      registeredSession(),
      [`:tamsin!~t@host.example PRIVMSG marmot :${DELIM}DCC SEND broken${DELIM}`],
      context(),
    );
    expect(
      feed(
        registeredSession(),
        [`:tamsin!~t@host.example PRIVMSG marmot :${DELIM}DCC SEND broken${DELIM}`],
        context(),
      ).effects.filter((effect) => effect.kind === 'dcc-offer'),
    ).toEqual([]);
    // Falls through to the generic CTCP notice rather than the DCC one.
    expect(state.serverNotices.at(-1)?.text).toContain('an automated request');
  });
});
