import {
  type ChannelState,
  type Message,
  type NetworkState,
  emptyChannel,
  initialNetworkState,
} from '@marmotter/client';
import { makeSource } from '@marmotter/protocol';
import { defaultLoggingPolicy, type LoggingPolicy } from '@marmotter/shared';
import { describe, expect, it } from 'vitest';
import { collectNewRecords } from './logging.js';

const on: LoggingPolicy = {
  ...defaultLoggingPolicy,
  enabled: true,
  scope: { channels: true, privateMessages: true, serverNotices: false },
};

const message = (id: string, text: string, overrides: Partial<Message> = {}): Message => ({
  id,
  kind: 'privmsg',
  at: new Date('2026-08-12T14:30:05Z'),
  fromServerTime: true,
  source: makeSource('tamsin', '~t', 'host'),
  target: '#marmotter',
  text,
  account: undefined,
  replyTo: undefined,
  pending: false,
  tags: new Map(),
  ...overrides,
});

const channel = (name: string, messages: Message[]): ChannelState => ({
  ...emptyChannel(name),
  joined: true,
  messages,
});

const network = (messages: Message[]): NetworkState => ({
  ...initialNetworkState('n1', 'Libera.Chat', 'me'),
  channels: new Map([['#marmotter', channel('#marmotter', messages)]]),
});

const collect = (
  networks: readonly NetworkState[],
  written: Map<string, string>,
  policy: LoggingPolicy = on,
) =>
  collectNewRecords(
    networks,
    { policyFor: () => policy, isChannelTarget: (_id, target) => target.startsWith('#') },
    written,
  );

describe('deciding what has not been written yet', () => {
  it('writes nothing on first sight of a conversation', () => {
    // A `chathistory` backfill is the server handing over what was said before
    // logging was switched on. Writing it would be inventing a log the user
    // never kept.
    const written = new Map<string, string>();
    const records = collect([network([message('a', 'first'), message('b', 'second')])], written);

    expect(records).toEqual([]);
    expect(written.get('n1 #marmotter')).toBe('b');
  });

  it('writes what arrives after that', () => {
    const written = new Map<string, string>();
    collect([network([message('a', 'first')])], written);

    const records = collect([network([message('a', 'first'), message('b', 'second')])], written);
    expect(records.map((entry) => entry.text)).toEqual(['second']);
  });

  it('writes every line of a burst, not just the newest', () => {
    // The notification path watches only the tail of the buffer, which is right
    // for notifying and would silently drop lines here.
    const written = new Map<string, string>();
    collect([network([message('a', 'first')])], written);

    const records = collect(
      [network([message('a', 'first'), message('b', '2'), message('c', '3'), message('d', '4')])],
      written,
    );
    expect(records.map((entry) => entry.text)).toEqual(['2', '3', '4']);
  });

  it('writes nothing twice when nothing has changed', () => {
    const written = new Map<string, string>();
    const state = [network([message('a', 'first'), message('b', 'second')])];
    collect(state, written);
    collect(state, written);

    expect(collect(state, written)).toEqual([]);
  });

  it('writes what is still there when the buffer has been trimmed past our mark', () => {
    // The buffer is capped, so the last line written can scroll out of it. The
    // alternative to resuming at the start is skipping everything still in it.
    const written = new Map<string, string>();
    collect([network([message('a', 'first')])], written);

    const records = collect([network([message('c', 'third'), message('d', 'fourth')])], written);
    expect(records.map((entry) => entry.text)).toEqual(['third', 'fourth']);
  });

  it('keeps its place while logging is off, so switching it on does not write the backlog', () => {
    // Somebody switching logging on means from now, not retrospectively — and
    // the buffer holds what was said before they did.
    const written = new Map<string, string>();
    const off = { ...on, enabled: false };
    collect([network([message('a', 'first')])], written, off);
    collect([network([message('a', 'first'), message('b', 'second')])], written, off);

    const records = collect(
      [network([message('a', 'first'), message('b', 'second'), message('c', 'third')])],
      written,
      on,
    );
    expect(records.map((entry) => entry.text)).toEqual(['third']);
  });

  it('leaves out what the scope excludes', () => {
    const written = new Map<string, string>();
    const channelsOnly = { ...on, scope: { ...on.scope, privateMessages: false } };
    const state = (messages: Message[]): NetworkState => ({
      ...initialNetworkState('n1', 'Libera.Chat', 'me'),
      channels: new Map([['#marmotter', channel('#marmotter', messages)]]),
      queries: new Map([
        [
          'jonquil',
          channel(
            'jonquil',
            messages.map((entry) => ({ ...entry, target: 'jonquil' })),
          ),
        ],
      ]),
    });

    collect([state([message('a', 'first')])], written, channelsOnly);
    const records = collect(
      [state([message('a', 'first'), message('b', 'second')])],
      written,
      channelsOnly,
    );

    expect(records.map((entry) => entry.target)).toEqual(['#marmotter']);
  });

  it('names the network on every record, so a log says where it came from', () => {
    const written = new Map<string, string>();
    collect([network([message('a', 'first')])], written);
    const records = collect([network([message('a', 'first'), message('b', 'second')])], written);

    expect(records[0]?.networkId).toBe('n1');
    expect(records[0]?.networkName).toBe('Libera.Chat');
  });
});
