import { describe, expect, it } from 'vitest';
import type { ReduceContext } from './reduce.js';
import { feed, registeredSession } from './harness.js';

const context = (overrides: Partial<ReduceContext> = {}): ReduceContext => ({
  altNicks: [],
  wantsSasl: false,
  now: () => new Date('2026-08-03T05:00:00.000Z'),
  ...overrides,
});

/** Only the XDCC offers, dropping the registration effects the harness carries. */
const xdccEffects = (line: string) =>
  feed(registeredSession(), [line], context()).effects.filter(
    (effect) => effect.kind === 'xdcc-offer',
  );

describe('an XDCC advertisement', () => {
  it('raises an offer effect for the file monitor', () => {
    const line =
      ':[EWG]Totoro!bot@host PRIVMSG #packlist :#70 1x [2.2G] Avatar - S01E12 - The Storm.mkv';
    expect(xdccEffects(line)).toEqual([
      {
        kind: 'xdcc-offer',
        from: '[EWG]Totoro',
        target: '#packlist',
        pack: {
          pack: 70,
          gets: 1,
          sizeText: '2.2G',
          sizeBytes: Math.round(2.2 * 1024 ** 3),
          filename: 'Avatar - S01E12 - The Storm.mkv',
        },
      },
    ]);
  });

  it('still shows the advertisement as ordinary channel text', () => {
    const line = ':bot!b@host PRIVMSG #packlist :#5 0x [1M] thing.bin';
    const { state } = feed(registeredSession(), [line], context());
    expect(state.channels.get('#packlist')?.messages.at(-1)?.text).toBe('#5 0x [1M] thing.bin');
  });

  it('catches a pack advertised as a NOTICE, which many bots use', () => {
    const line = ':bot!b@host NOTICE #packlist :#5 0x [1M] thing.bin';
    expect(xdccEffects(line)[0]).toMatchObject({
      kind: 'xdcc-offer',
      from: 'bot',
      target: '#packlist',
      pack: { pack: 5, filename: 'thing.bin' },
    });
  });

  it('catches a pack a bot answers privately, filed under the bot', () => {
    // `!list` and `@find` replies often arrive as a private message from the bot.
    const line = ':bot!b@host PRIVMSG marmot :#5 0x [1M] thing.bin';
    expect(xdccEffects(line)[0]).toMatchObject({
      kind: 'xdcc-offer',
      from: 'bot',
      target: 'bot',
      pack: { pack: 5 },
    });
  });

  it('ignores ordinary chatter that is not a pack line', () => {
    const line = ':someone!s@host PRIVMSG #packlist :has anyone got #70?';
    expect(xdccEffects(line)).toEqual([]);
  });
});
