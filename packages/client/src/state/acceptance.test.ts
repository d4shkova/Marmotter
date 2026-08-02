import { describe, expect, it } from 'vitest';
import { channelOf, feed, memberNicks, memberOf, registeredSession } from './harness.js';

/**
 * The specific scenarios BUILD_PLAN phase 3 names as acceptance criteria.
 *
 * Each is a real failure mode of IRC clients rather than a synthetic case: a
 * netsplit that drops half a channel, a mass quit, an operator renaming
 * themselves, a mode change racing a NAMES burst, and history overlapping the
 * live buffer.
 */

const joined = () =>
  feed(registeredSession(), [
    ':marmot!~m@host JOIN #test',
    ':irc.test 353 marmot = #test :@jonquil +emilyp tamsin bramble corvid marmot',
    ':irc.test 366 marmot #test :End of /NAMES list.',
  ]);

describe('netsplit and rejoin', () => {
  it('drops everyone the split took, and restores them on rejoin', () => {
    // A netsplit arrives as a batch of quits whose reason is two server names.
    const split = feed(joined(), [
      ':irc.test BATCH +sp netsplit irc.a irc.b',
      '@batch=sp :jonquil!~j@host QUIT :*.net *.split',
      '@batch=sp :emilyp!~e@host QUIT :*.net *.split',
      '@batch=sp :tamsin!~t@host QUIT :*.net *.split',
      ':irc.test BATCH -sp',
    ]);

    expect(memberNicks(split, '#test')).toEqual(['bramble', 'corvid', 'marmot']);

    // The netjoin brings them back, and the server restates their status.
    const rejoined = feed(split, [
      ':irc.test BATCH +nj netjoin irc.a irc.b',
      '@batch=nj :jonquil!~j@host JOIN #test',
      '@batch=nj :emilyp!~e@host JOIN #test',
      '@batch=nj :tamsin!~t@host JOIN #test',
      ':irc.test BATCH -nj',
      ':irc.test MODE #test +ov jonquil emilyp',
    ]);

    expect(memberNicks(rejoined, '#test')).toEqual([
      'bramble',
      'corvid',
      'emilyp',
      'jonquil',
      'marmot',
      'tamsin',
    ]);
    // Status is restored by the server, not assumed from before the split.
    expect(memberOf(rejoined, '#test', 'jonquil').prefixes).toBe('@');
    expect(memberOf(rejoined, '#test', 'emilyp').prefixes).toBe('+');
  });

  it('leaves the channel intact when the split takes nobody we can see', () => {
    const before = memberNicks(joined(), '#test');
    const after = feed(joined(), [':stranger!~s@host QUIT :*.net *.split']);
    expect(memberNicks(after, '#test')).toEqual(before);
  });
});

describe('mass quit', () => {
  it('removes everyone who left and keeps one line each', () => {
    const lines = ['bramble', 'corvid', 'emilyp', 'jonquil', 'tamsin'].map(
      (nick) => `:${nick}!~u@host QUIT :Client Quit`,
    );
    const session = feed(joined(), lines);

    expect(memberNicks(session, '#test')).toEqual(['marmot']);

    const quits = channelOf(session, '#test').messages.filter((message) => message.kind === 'quit');
    expect(quits).toHaveLength(5);
  });

  it('removes someone from every channel they were in at once', () => {
    const session = feed(joined(), [
      ':marmot!~m@host JOIN #other',
      ':irc.test 353 marmot = #other :jonquil marmot',
      ':irc.test 366 marmot #other :End of /NAMES list.',
      ':jonquil!~j@host QUIT :Client Quit',
    ]);

    expect(memberNicks(session, '#test')).not.toContain('jonquil');
    expect(memberNicks(session, '#other')).not.toContain('jonquil');
  });
});

describe('a channel operator changes nick', () => {
  it('keeps their status, account, and away state', () => {
    const session = feed(joined(), [
      ':jonquil!~j@host ACCOUNT jq_account',
      ':jonquil!~j@host AWAY :in a meeting',
      ':jonquil!~j@host NICK jonquil2',
    ]);

    expect(memberNicks(session, '#test')).toContain('jonquil2');
    expect(memberNicks(session, '#test')).not.toContain('jonquil');

    const renamed = memberOf(session, '#test', 'jonquil2');
    // The person did not change, only their name. Losing the prefix here is
    // why operators appear to be demoted by a rename.
    expect(renamed.prefixes).toBe('@');
    expect(renamed.account).toBe('jq_account');
    expect(renamed.away).toBe(true);
  });

  it('renames them in every channel at once', () => {
    const session = feed(joined(), [
      ':marmot!~m@host JOIN #other',
      ':irc.test 353 marmot = #other :@jonquil marmot',
      ':irc.test 366 marmot #other :End of /NAMES list.',
      ':jonquil!~j@host NICK jonquil2',
    ]);

    expect(memberOf(session, '#test', 'jonquil2').prefixes).toBe('@');
    expect(memberOf(session, '#other', 'jonquil2').prefixes).toBe('@');
  });

  it('follows our own rename', () => {
    const session = feed(joined(), [':marmot!~m@host NICK marmot2']);
    expect(session.state.nick).toBe('marmot2');
    expect(memberNicks(session, '#test')).toContain('marmot2');
  });

  it('still recognises us as ourselves after renaming', () => {
    const session = feed(joined(), [
      ':marmot!~m@host NICK marmot2',
      ':marmot2!~m@host PART #test :leaving',
    ]);
    // A part by our new nick is our own part, so the channel empties.
    expect(channelOf(session, '#test').joined).toBe(false);
  });
});

describe('a mode change while the member list is loading', () => {
  it('survives the rest of the NAMES burst', () => {
    const session = feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :marmot jonquil',
      // Lands between two 353s.
      ':irc.test MODE #test +o jonquil',
      ':irc.test 353 marmot = #test :tamsin bramble',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);

    expect(memberOf(session, '#test', 'jonquil').prefixes).toBe('@');
    expect(memberNicks(session, '#test')).toEqual(['bramble', 'jonquil', 'marmot', 'tamsin']);
  });

  it('survives a channel mode change during the burst', () => {
    const session = feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :marmot',
      ':irc.test MODE #test +mnt',
      ':irc.test 353 marmot = #test :jonquil',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);

    const channel = channelOf(session, '#test');
    expect([...channel.modes.flags].sort()).toEqual(['m', 'n', 't']);
    expect(memberNicks(session, '#test')).toEqual(['jonquil', 'marmot']);
  });

  it('applies a mode for someone the burst has not mentioned yet', () => {
    const session = feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :marmot',
      // The server ops somebody we have not seen in the list yet.
      ':irc.test MODE #test +o tamsin',
      ':irc.test 353 marmot = #test :tamsin',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);

    expect(memberOf(session, '#test', 'tamsin').prefixes).toBe('@');
  });
});

describe('chathistory overlapping the live buffer', () => {
  const live = () =>
    feed(joined(), [
      '@msgid=m3;time=2026-08-02T09:03:00.000Z :jonquil!~j@host PRIVMSG #test :third',
      '@msgid=m4;time=2026-08-02T09:04:00.000Z :emilyp!~e@host PRIVMSG #test :fourth',
    ]);

  it('backfills without duplicating what is already there', () => {
    // The history batch overlaps: m3 and m4 are already in the buffer.
    const session = feed(live(), [
      ':irc.test BATCH +hist chathistory #test',
      '@batch=hist;msgid=m1;time=2026-08-02T09:01:00.000Z :jonquil!~j@host PRIVMSG #test :first',
      '@batch=hist;msgid=m2;time=2026-08-02T09:02:00.000Z :emilyp!~e@host PRIVMSG #test :second',
      '@batch=hist;msgid=m3;time=2026-08-02T09:03:00.000Z :jonquil!~j@host PRIVMSG #test :third',
      '@batch=hist;msgid=m4;time=2026-08-02T09:04:00.000Z :emilyp!~e@host PRIVMSG #test :fourth',
      ':irc.test BATCH -hist',
    ]);

    const texts = channelOf(session, '#test')
      .messages.filter((message) => message.kind === 'privmsg')
      .map((message) => message.text);

    expect(texts).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('orders backfilled messages by their server time, not arrival order', () => {
    const session = feed(live(), [
      ':irc.test BATCH +hist chathistory #test',
      '@batch=hist;msgid=m0;time=2026-08-02T09:00:00.000Z :bramble!~b@host PRIVMSG #test :zeroth',
      ':irc.test BATCH -hist',
    ]);

    const texts = channelOf(session, '#test')
      .messages.filter((message) => message.kind === 'privmsg')
      .map((message) => message.text);

    // Arrived last, belongs first.
    expect(texts).toEqual(['zeroth', 'third', 'fourth']);
  });

  it('deduplicates on a network with no msgid, using the derived id', () => {
    const session = feed(joined(), [
      '@time=2026-08-02T09:05:00.000Z :jonquil!~j@host PRIVMSG #test :no msgid here',
      ':irc.test BATCH +hist chathistory #test',
      '@batch=hist;time=2026-08-02T09:05:00.000Z :jonquil!~j@host PRIVMSG #test :no msgid here',
      ':irc.test BATCH -hist',
    ]);

    const matching = channelOf(session, '#test').messages.filter(
      (message) => message.text === 'no msgid here',
    );
    expect(matching).toHaveLength(1);
  });
});

describe('our own messages', () => {
  it('reconciles an echo against the optimistic line', () => {
    // Phase 5 renders the optimistic copy; here the echo arrives and must not
    // become a second line.
    const session = feed(joined(), [
      '@msgid=e1;time=2026-08-02T09:06:00.000Z :marmot!~m@host PRIVMSG #test :from me',
      '@msgid=e1;time=2026-08-02T09:06:00.000Z :marmot!~m@host PRIVMSG #test :from me',
    ]);

    const mine = channelOf(session, '#test').messages.filter(
      (message) => message.text === 'from me',
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.pending).toBe(false);
  });
});
