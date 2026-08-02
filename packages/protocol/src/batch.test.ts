import { describe, expect, it } from 'vitest';
import { BatchTracker, LabelGenerator, LabelTracker } from './batch.js';
import { parseMessage } from './parse.js';

const msg = (line: string) => {
  const result = parseMessage(line);
  if (!result.ok) {
    throw new Error(`fixture failed to parse: ${line}`);
  }
  return result.message;
};

const feed = (tracker: BatchTracker, ...lines: string[]) =>
  lines.map((l) => tracker.handle(msg(l)));

describe('BatchTracker', () => {
  it('passes ordinary messages straight through', () => {
    const tracker = new BatchTracker();
    const [event] = feed(tracker, ':nick PRIVMSG #c :hello');
    expect(event?.kind).toBe('message');
    expect(tracker.hasOpenBatches).toBe(false);
  });

  it('collects a batch and reports it on close', () => {
    const tracker = new BatchTracker();
    const events = feed(
      tracker,
      ':srv BATCH +ref netsplit irc.a irc.b',
      '@batch=ref :one!u@h QUIT :*.net *.split',
      '@batch=ref :two!u@h QUIT :*.net *.split',
      ':srv BATCH -ref',
    );

    expect(events[0]?.kind).toBe('opened');
    expect(events[1]?.kind).toBe('batched');
    expect(events[3]?.kind).toBe('closed');

    const closed = events[3];
    if (closed?.kind !== 'closed') {
      throw new Error('expected a closed event');
    }
    expect(closed.batch.type).toBe('netsplit');
    expect(closed.batch.params).toEqual(['irc.a', 'irc.b']);
    expect(closed.batch.messages).toHaveLength(2);
    expect(tracker.hasOpenBatches).toBe(false);
  });

  it('exposes an open batch while it is filling', () => {
    const tracker = new BatchTracker();
    feed(tracker, ':srv BATCH +ref chathistory #c', '@batch=ref :a PRIVMSG #c :one');

    expect(tracker.openReferences).toEqual(['ref']);
    expect(tracker.get('ref')?.messages).toHaveLength(1);
    expect(tracker.get('missing')).toBeUndefined();
  });

  it('nests batches, so an inner batch does not escape the outer one', () => {
    const tracker = new BatchTracker();
    const events = feed(
      tracker,
      ':srv BATCH +outer chathistory #c',
      '@batch=outer :srv BATCH +inner labeled-response',
      '@batch=inner :a PRIVMSG #c :nested',
      '@batch=outer :srv BATCH -inner',
      ':srv BATCH -outer',
    );

    const inner = events[3];
    if (inner?.kind !== 'closed') {
      throw new Error('expected the inner batch to close');
    }
    expect(inner.batch.parent).toBe('outer');
    expect(inner.batch.messages).toHaveLength(1);

    const outer = events[4];
    if (outer?.kind !== 'closed') {
      throw new Error('expected the outer batch to close');
    }
    // The inner batch's open, its close, and nothing lost.
    expect(outer.batch.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('treats a message tagged with an unknown batch as ordinary', () => {
    const tracker = new BatchTracker();
    const [event] = feed(tracker, '@batch=ghost :a PRIVMSG #c :hello');
    // Losing grouping is better than losing the message.
    expect(event?.kind).toBe('message');
  });

  it('ignores a close for a batch that never opened', () => {
    const tracker = new BatchTracker();
    const [event] = feed(tracker, ':srv BATCH -ghost');
    expect(event?.kind).toBe('message');
  });

  it('ignores a malformed BATCH command', () => {
    const tracker = new BatchTracker();
    expect(feed(tracker, ':srv BATCH')[0]?.kind).toBe('message');
    expect(feed(tracker, ':srv BATCH +')[0]?.kind).toBe('message');
    expect(feed(tracker, ':srv BATCH ref')[0]?.kind).toBe('message');
  });

  it('drops open batches on reset, so a reconnect starts clean', () => {
    const tracker = new BatchTracker();
    feed(tracker, ':srv BATCH +ref chathistory #c');
    expect(tracker.hasOpenBatches).toBe(true);

    tracker.reset();
    expect(tracker.hasOpenBatches).toBe(false);
  });

  it('does not hand out a mutable view of a batch', () => {
    const tracker = new BatchTracker();
    feed(tracker, ':srv BATCH +ref chathistory #c', '@batch=ref :a PRIVMSG #c :one');

    const snapshot = tracker.get('ref');
    feed(tracker, '@batch=ref :a PRIVMSG #c :two');
    expect(snapshot?.messages).toHaveLength(1);
  });
});

describe('LabelGenerator', () => {
  it('produces distinct labels', () => {
    const generator = new LabelGenerator();
    const labels = [generator.next(), generator.next(), generator.next()];
    expect(new Set(labels).size).toBe(3);
  });

  it('honours a custom prefix', () => {
    expect(new LabelGenerator('x').next().startsWith('x')).toBe(true);
  });
});

describe('LabelTracker', () => {
  it('correlates a single tagged reply', () => {
    const batches = new BatchTracker();
    const labels = new LabelTracker();
    labels.expect('mm1');

    const response = labels.handle(batches.handle(msg('@label=mm1 :srv 001 me :Welcome')));
    expect(response).toEqual({
      label: 'mm1',
      kind: 'messages',
      messages: [expect.objectContaining({ command: '001' })],
    });
    expect(labels.outstanding).toEqual([]);
  });

  it('correlates a labeled-response batch', () => {
    const batches = new BatchTracker();
    const labels = new LabelTracker();
    labels.expect('mm2');

    const events = [
      '@label=mm2 :srv BATCH +ref labeled-response',
      '@batch=ref :srv 352 me #c u h srv nick H :0 real',
      '@batch=ref :srv 315 me #c :End of /WHO',
      ':srv BATCH -ref',
    ].map((line) => labels.handle(batches.handle(msg(line))));

    expect(events[0]).toBeUndefined();
    const response = events[3];
    expect(response?.kind).toBe('messages');
    if (response?.kind === 'messages') {
      expect(response.messages).toHaveLength(2);
      expect(response.label).toBe('mm2');
    }
  });

  it('correlates an empty ACK', () => {
    const batches = new BatchTracker();
    const labels = new LabelTracker();
    labels.expect('mm3');

    expect(labels.handle(batches.handle(msg('@label=mm3 :srv ACK')))).toEqual({
      label: 'mm3',
      kind: 'ack',
    });
  });

  it('ignores a label it is not waiting for', () => {
    const batches = new BatchTracker();
    const labels = new LabelTracker();
    expect(labels.handle(batches.handle(msg('@label=stray :srv 001 me :hi')))).toBeUndefined();
  });

  it('ignores untagged messages', () => {
    const batches = new BatchTracker();
    const labels = new LabelTracker();
    labels.expect('mm4');
    expect(labels.handle(batches.handle(msg(':srv 001 me :hi')))).toBeUndefined();
    expect(labels.outstanding).toEqual(['mm4']);
  });

  it('keeps two in-flight commands apart', () => {
    const batches = new BatchTracker();
    const labels = new LabelTracker();
    labels.expect('a');
    labels.expect('b');

    const second = labels.handle(batches.handle(msg('@label=b :srv ACK')));
    expect(second?.label).toBe('b');
    expect(labels.outstanding).toEqual(['a']);
  });

  it('drops outstanding labels on reset', () => {
    const labels = new LabelTracker();
    labels.expect('a');
    labels.reset();
    expect(labels.outstanding).toEqual([]);
  });
});
