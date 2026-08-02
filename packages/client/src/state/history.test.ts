import { describe, expect, it } from 'vitest';
import { channelOf, feed, registeredSession } from './harness.js';
import {
  backfillJoinedChannels,
  newestRef,
  oldestRef,
  requestBackfill,
  requestMissed,
  requestOlder,
} from './history.js';

const ISUPPORT =
  'PREFIX=(ohv)@%+ CHANTYPES=# CASEMAPPING=rfc1459 CHATHISTORY=50 MSGREFTYPES=timestamp,msgid';

/** A session on a network that offers history, already in a channel. */
const joined = () =>
  feed(registeredSession({ isupport: ISUPPORT }), [
    ':marmot!~m@host JOIN #test',
    ':irc.test 353 marmot = #test :marmot jonquil',
    ':irc.test 366 marmot #test :End of /NAMES list.',
  ]);

const withMessages = () =>
  feed(joined(), [
    '@msgid=m5;time=2026-08-02T09:05:00.000Z :jonquil!~j@host PRIVMSG #test :fifth',
    '@msgid=m6;time=2026-08-02T09:06:00.000Z :jonquil!~j@host PRIVMSG #test :sixth',
  ]);

/** A page of history, as the server would send it. */
const page = (reference: string, entries: readonly { id: string; at: string }[]) => [
  `:irc.test BATCH +${reference} chathistory #test`,
  ...entries.map(
    (entry) =>
      `@batch=${reference};msgid=${entry.id};time=${entry.at} :jonquil!~j@host PRIVMSG #test :line ${entry.id}`,
  ),
  `:irc.test BATCH -${reference}`,
];

describe('asking for history', () => {
  it('asks for the newest page on a fresh channel', () => {
    const result = requestBackfill(joined().state, '#test');
    expect(result.ok && result.send).toEqual(['CHATHISTORY LATEST #test * 50']);
  });

  it('marks the request in flight so a second does not go out over it', () => {
    const first = requestBackfill(joined().state, '#test');
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(requestOlder(first.state, '#test')).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('pages backwards from the oldest message loaded', () => {
    const result = requestOlder(withMessages().state, '#test');
    expect(result.ok && result.send).toEqual(['CHATHISTORY BEFORE #test msgid=m5 50']);
  });

  it('pages backwards by timestamp when the network sends no msgid', () => {
    const session = feed(joined(), [
      '@time=2026-08-02T09:05:00.000Z :jonquil!~j@host PRIVMSG #test :no msgid',
    ]);
    const result = requestOlder(session.state, '#test');
    // A derived id is ours, not the server's, so it is never sent back.
    expect(result.ok && result.send).toEqual([
      'CHATHISTORY BEFORE #test timestamp=2026-08-02T09:05:00.000Z 50',
    ]);
  });

  it('asks for the newest page when there is nothing to page back from', () => {
    const result = requestOlder(joined().state, '#test');
    expect(result.ok && result.send).toEqual(['CHATHISTORY LATEST #test * 50']);
  });

  it('asks for what was missed, from the newest message loaded', () => {
    const result = requestMissed(withMessages().state, '#test');
    expect(result.ok && result.send).toEqual(['CHATHISTORY AFTER #test msgid=m6 50']);
  });

  it('has nothing to catch up from in an empty channel', () => {
    expect(requestMissed(joined().state, '#test')).toEqual({ ok: false, reason: 'no-anchor' });
  });

  it('clamps the page to what the network will serve', () => {
    const result = requestBackfill(joined().state, '#test', 500);
    expect(result.ok && result.send).toEqual(['CHATHISTORY LATEST #test * 50']);
  });

  it('asks for nothing on a network with no history', () => {
    const plain = feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);
    expect(requestBackfill(plain.state, '#test')).toEqual({ ok: false, reason: 'unsupported' });
    expect(requestOlder(plain.state, '#test')).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('asks for nothing for a conversation that does not exist', () => {
    expect(requestBackfill(joined().state, '#nowhere')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('backfills every joined channel at once', () => {
    const session = feed(joined(), [
      ':marmot!~m@host JOIN #other',
      ':irc.test 366 marmot #other :End of /NAMES list.',
    ]);
    const result = backfillJoinedChannels(session.state);
    expect(result.send).toEqual([
      'CHATHISTORY LATEST #test * 50',
      'CHATHISTORY LATEST #other * 50',
    ]);
  });

  it('leaves parted channels alone', () => {
    const session = feed(joined(), [':marmot!~m@host PART #test :bye']);
    expect(backfillJoinedChannels(session.state).send).toEqual([]);
  });
});

describe('reading a page back', () => {
  const request = (target = '#test', limit?: number) => {
    const result = requestBackfill(withMessages().state, target, limit);
    if (!result.ok) {
      throw new Error(`request refused: ${result.reason}`);
    }
    return { ...withMessages(), state: result.state };
  };

  it('clears the in-flight marker when the batch closes', () => {
    const session = feed(request(), page('h1', [{ id: 'm4', at: '2026-08-02T09:04:00.000Z' }]));
    expect(channelOf(session, '#test').historyPending).toBeUndefined();
  });

  it('treats a short page as the start of the conversation', () => {
    const session = feed(request(), page('h1', [{ id: 'm4', at: '2026-08-02T09:04:00.000Z' }]));
    expect(channelOf(session, '#test').historyComplete).toBe(true);
    expect(channelOf(session, '#test').historyGap).toBe(false);
  });

  it('treats a full page as more remaining', () => {
    const entries = Array.from({ length: 3 }, (_, index) => ({
      id: `h${index}`,
      at: `2026-08-02T08:0${index}:00.000Z`,
    }));
    const session = feed(request('#test', 3), page('h1', entries));
    expect(channelOf(session, '#test').historyComplete).toBe(false);
  });

  it('reports a hole when a full page still lands clear of what is shown', () => {
    // The page filled up and every message in it is older than our oldest live
    // message, so there is more in between that has not been fetched. The two
    // do not meet and the interface must not imply they do.
    const session = feed(
      request('#test', 2),
      page('h1', [
        { id: 'h0', at: '2026-08-02T07:00:00.000Z' },
        { id: 'h1', at: '2026-08-02T07:01:00.000Z' },
      ]),
    );
    expect(channelOf(session, '#test').historyGap).toBe(true);
    // A hole is not the start of the conversation.
    expect(channelOf(session, '#test').historyComplete).toBe(false);
  });

  it('reports no hole when a short page lands clear of what is shown', () => {
    // The server gave everything it had. There is nothing to load in between,
    // so offering to is worse than saying nothing.
    const session = feed(request(), page('h1', [{ id: 'h0', at: '2026-08-02T07:00:00.000Z' }]));
    expect(channelOf(session, '#test').historyGap).toBe(false);
    expect(channelOf(session, '#test').historyComplete).toBe(true);
  });

  it('reports no hole when the page overlaps what is already shown', () => {
    const session = feed(
      request(),
      page('h1', [
        { id: 'm4', at: '2026-08-02T09:04:00.000Z' },
        { id: 'm5', at: '2026-08-02T09:05:00.000Z' },
      ]),
    );
    expect(channelOf(session, '#test').historyGap).toBe(false);
  });

  it('never reports a hole for a page taken from before the oldest message', () => {
    const older = requestOlder(withMessages().state, '#test');
    expect(older.ok).toBe(true);
    if (!older.ok) {
      return;
    }
    const session = feed(
      { ...withMessages(), state: older.state },
      page('h1', [{ id: 'h0', at: '2026-08-02T07:00:00.000Z' }]),
    );
    // A BEFORE page meets the buffer by construction, however old it is.
    expect(channelOf(session, '#test').historyGap).toBe(false);
  });

  it('reports a hole when a catch-up filled its whole page', () => {
    const missed = requestMissed(withMessages().state, '#test', 2);
    expect(missed.ok).toBe(true);
    if (!missed.ok) {
      return;
    }
    const session = feed(
      { ...withMessages(), state: missed.state },
      page('h1', [
        { id: 'm7', at: '2026-08-02T09:07:00.000Z' },
        { id: 'm8', at: '2026-08-02T09:08:00.000Z' },
      ]),
    );
    expect(channelOf(session, '#test').historyGap).toBe(true);
  });

  it('reports no hole when a catch-up came back short', () => {
    const missed = requestMissed(withMessages().state, '#test', 5);
    expect(missed.ok).toBe(true);
    if (!missed.ok) {
      return;
    }
    const session = feed(
      { ...withMessages(), state: missed.state },
      page('h1', [{ id: 'm7', at: '2026-08-02T09:07:00.000Z' }]),
    );
    expect(channelOf(session, '#test').historyGap).toBe(false);
  });

  it('accepts history nobody asked for without drawing conclusions from it', () => {
    // Some servers push scrollback on join. It is real history, but it says
    // nothing about what else the server holds.
    const session = feed(
      withMessages(),
      page('h1', [{ id: 'h0', at: '2026-08-02T07:00:00.000Z' }]),
    );
    const channel = channelOf(session, '#test');
    expect(channel.historyComplete).toBe(false);
    expect(channel.historyGap).toBe(false);
    expect(channel.messages.some((message) => message.id === 'h0')).toBe(true);
  });

  it('reads the draft batch type the same as the ratified one', () => {
    const session = feed(request(), [
      ':irc.test BATCH +h1 draft/chathistory #test',
      '@batch=h1;msgid=m4;time=2026-08-02T09:04:00.000Z :jonquil!~j@host PRIVMSG #test :older',
      ':irc.test BATCH -h1',
    ]);
    expect(channelOf(session, '#test').historyComplete).toBe(true);
  });

  it('leaves an unrelated batch alone', () => {
    const session = feed(request(), [
      ':irc.test BATCH +sp netsplit irc.a irc.b',
      '@batch=sp :jonquil!~j@host QUIT :*.net *.split',
      ':irc.test BATCH -sp',
    ]);
    // The history request is still in flight; a netsplit says nothing about it.
    expect(channelOf(session, '#test').historyPending).not.toBeUndefined();
  });

  it('ignores a close for a batch that never opened', () => {
    const session = feed(request(), [':irc.test BATCH -never']);
    expect(channelOf(session, '#test').historyPending).not.toBeUndefined();
  });

  it('ignores a malformed batch reference', () => {
    const session = feed(request(), [':irc.test BATCH +', ':irc.test BATCH x']);
    expect(session.state.batches.size).toBe(0);
  });
});

describe('choosing a reference', () => {
  it('uses a msgid when the server gave one', () => {
    expect(oldestRef(channelOf(withMessages(), '#test'))).toEqual({
      kind: 'msgid',
      id: 'm5',
    });
    expect(newestRef(channelOf(withMessages(), '#test'))).toEqual({
      kind: 'msgid',
      id: 'm6',
    });
  });

  it('has no reference for an empty conversation', () => {
    expect(oldestRef(channelOf(joined(), '#test'))).toBeUndefined();
    expect(newestRef(channelOf(joined(), '#test'))).toBeUndefined();
  });
});
