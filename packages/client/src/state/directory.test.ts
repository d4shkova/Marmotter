import { describe, expect, it } from 'vitest';
import { CHANNEL_LIST_LIMIT } from './types.js';
import { feed, registeredSession } from './harness.js';

const listReply = [
  ':irc.example.org 321 marmot Channel :Users  Name',
  ':irc.example.org 322 marmot #marmotter 42 :Building a nicer IRC client',
  ':irc.example.org 322 marmot #ircv3 118 :The working group',
  ':irc.example.org 322 marmot #quiet 3 :',
  ':irc.example.org 323 marmot :End of /LIST',
];

describe('the channel directory', () => {
  it('collects the listing instead of leaving numerics in the message list', () => {
    const session = feed(registeredSession(), listReply);
    const directory = session.state.directory;

    expect(directory.entries).toEqual([
      { channel: '#marmotter', members: 42, topic: 'Building a nicer IRC client' },
      { channel: '#ircv3', members: 118, topic: 'The working group' },
      { channel: '#quiet', members: 3, topic: '' },
    ]);
    expect(directory.complete).toBe(true);
    expect(directory.loading).toBe(false);
  });

  it('is loading between the first row and the end, so the browser can say so', () => {
    const partial = feed(registeredSession(), listReply.slice(0, -1));
    expect(partial.state.directory.loading).toBe(true);
    expect(partial.state.directory.complete).toBe(false);
  });

  // Not every ircd sends 321, and a listing that only started on the start
  // numeric would leave those networks with a directory nobody had opened.
  it('opens the listing on the first row when the server sends no start', () => {
    const session = feed(registeredSession(), listReply.slice(1, -1));
    expect(session.state.directory.entries).toHaveLength(3);
    expect(session.state.directory.loading).toBe(true);
  });

  it('replaces a finished listing rather than appending a second one to it', () => {
    const first = feed(registeredSession(), listReply);
    const second = feed(first, [':irc.example.org 322 marmot #new 7 :Something else']);

    expect(second.state.directory.entries).toEqual([
      { channel: '#new', members: 7, topic: 'Something else' },
    ]);
    expect(second.state.directory.complete).toBe(false);
  });

  it('stops at the limit and says it did, rather than growing without bound', () => {
    const rows = Array.from(
      { length: CHANNEL_LIST_LIMIT + 5 },
      (_, index) => `:irc.example.org 322 marmot #c${index} 1 :topic`,
    );
    const session = feed(registeredSession(), [...rows, ':irc.example.org 323 marmot :End']);

    expect(session.state.directory.entries).toHaveLength(CHANNEL_LIST_LIMIT);
    expect(session.state.directory.truncated).toBe(true);
    expect(session.state.directory.complete).toBe(true);
  });
});
