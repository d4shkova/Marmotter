import { type Message, type NetworkState, initialNetworkState } from '@marmotter/client';
import { DEFAULT_ISUPPORT, applyISupport, makeSource } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import { buildNotification, shouldNotify } from './notify.js';

const support = applyISupport(DEFAULT_ISUPPORT, ['CHANTYPES=#', 'CASEMAPPING=rfc1459']);

const network: NetworkState = {
  ...initialNetworkState('libera', 'Libera.Chat', 'marmot'),
  phase: 'registered',
  support,
};

const message = (nick: string, text: string, extra: Partial<Message> = {}): Message => ({
  id: `${nick}-${text}`,
  kind: 'privmsg',
  at: new Date(0),
  fromServerTime: true,
  source: makeSource(nick, `~${nick[0]}`, 'host.example'),
  target: '#marmotter',
  text,
  account: undefined,
  replyTo: undefined,
  pending: false,
  tags: new Map(),
  ...extra,
});

const decide = (
  msg: Message,
  overrides: { target?: string | undefined; watching?: boolean; enabled?: boolean } = {},
) =>
  shouldNotify({
    message: msg,
    network,
    ref: { networkId: 'libera', target: overrides.target ?? '#marmotter' },
    watching: overrides.watching ?? false,
    enabled: overrides.enabled ?? true,
    isHighlight: (text) => /\bmarmot\b/i.test(text),
  });

describe('what is worth interrupting for', () => {
  it('notifies for a mention in a channel', () => {
    expect(decide(message('tamsin', 'marmot: are you there?'))).toBe('highlight');
  });

  it('notifies for a private message whether or not it names you', () => {
    expect(decide(message('tamsin', 'hello'), { target: 'tamsin' })).toBe('private-message');
  });

  it('says nothing for ordinary channel traffic', () => {
    expect(decide(message('tamsin', 'the build finished'))).toBeUndefined();
  });

  it('says nothing while you are looking straight at the conversation', () => {
    expect(decide(message('tamsin', 'marmot: hi'), { watching: true })).toBeUndefined();
  });

  it('says nothing when notifications are turned off', () => {
    expect(decide(message('tamsin', 'marmot: hi'), { enabled: false })).toBeUndefined();
  });

  // `echo-message` returns what we just sent. Being notified about your own
  // message is the clearest possible bug, and casemapping is how the check has
  // to be spelled — `Marmot` is the same person as `marmot`.
  it('never notifies for our own message coming back through echo-message', () => {
    expect(decide(message('Marmot', 'marmot: talking to myself'))).toBeUndefined();
  });

  it('says nothing for a message still waiting to be acknowledged', () => {
    expect(decide(message('tamsin', 'marmot: hi', { pending: true }))).toBeUndefined();
  });

  it('says nothing about joins, parts and mode changes', () => {
    expect(decide(message('tamsin', 'marmot joined', { kind: 'join' }))).toBeUndefined();
  });

  it('names the person and the place, and never shows a raw line', () => {
    const built = buildNotification('highlight', message('tamsin', 'marmot: ping'), network, {
      networkId: 'libera',
      target: '#marmotter',
    });
    expect(built.title).toBe('tamsin mentioned you in #marmotter');
    expect(built.body).toBe('marmot: ping');
  });

  it('truncates a long message rather than handing the OS a wall of text', () => {
    const built = buildNotification(
      'private-message',
      message('tamsin', 'x'.repeat(400)),
      network,
      { networkId: 'libera', target: 'tamsin' },
    );
    expect(built.title).toBe('tamsin messaged you');
    expect(built.body).toHaveLength(160);
    expect(built.body.endsWith('…')).toBe(true);
  });
});
