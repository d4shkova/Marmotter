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

  it('reads a passive offer, keeping the token the reply has to carry back', () => {
    const { state } = feed(
      registeredSession(),
      [dccSend('file.bin 3232235777 0 4096 998877')],
      context(),
    );
    expect(dccEffects('file.bin 3232235777 0 4096 998877')[0]).toMatchObject({
      kind: 'dcc-offer',
      send: { passive: true, token: '998877' },
    });
    // One sentence whichever way the connection goes: the monitor decides what
    // it can take, and the person receiving a file does not have to know.
    expect(state.serverNotices.at(-1)?.text).toContain('Open the file monitor');
  });

  it('files it in the channel it arrived in', () => {
    expect(dccEffects('shared.zip 3232235777 5000 1', '#marmotter')[0]).toMatchObject({
      kind: 'dcc-offer',
      target: '#marmotter',
    });
  });

  it('says so when a line that claims to be a file cannot be read as one', () => {
    // Not dropped and not filed away as an anonymous CTCP: somebody who asked a
    // bot for a file and got nothing has no way to tell an unanswered request
    // from an answer this client did not understand, and the raw line is what
    // makes the difference reportable.
    const line = `:tamsin!~t@host.example PRIVMSG marmot :${DELIM}DCC SEND broken${DELIM}`;
    const { effects } = feed(registeredSession(), [line], context());
    expect(effects.filter((effect) => effect.kind === 'dcc-offer')).toEqual([]);
    expect(effects.filter((effect) => effect.kind === 'dcc-unreadable')).toEqual([
      { kind: 'dcc-unreadable', from: 'tamsin', target: 'tamsin', params: 'SEND broken' },
    ]);
  });
});

describe('a sender agreeing to continue a file', () => {
  const dccAccept = (params: string): string =>
    `:tamsin!~t@host.example PRIVMSG marmot :${DELIM}DCC ACCEPT ${params}${DELIM}`;

  it('raises the accepted position, and writes nothing into the conversation', () => {
    const { state, effects } = feed(
      registeredSession(),
      [dccAccept('big.bin 5000 1024')],
      context(),
    );
    expect(effects.filter((effect) => effect.kind === 'dcc-accept')).toEqual([
      {
        kind: 'dcc-accept',
        from: 'tamsin',
        accept: { filename: 'big.bin', port: 5000, position: 1024 },
      },
    ]);
    // The row it belongs to says what is happening. A CTCP handshake line in
    // the conversation would be exactly the protocol leakage this client exists
    // to remove.
    expect(state.serverNotices).toHaveLength(0);
  });
});
