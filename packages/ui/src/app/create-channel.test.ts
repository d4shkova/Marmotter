import { describe, expect, it } from 'vitest';
import { createChannelLines } from './CreateChannel.js';

const plain = {
  name: '#marmotter',
  topic: '',
  inviteOnly: false,
  password: '',
  secret: false,
};

describe('making a channel', () => {
  it('is a join, because that is all creating one is', () => {
    expect(createChannelLines(plain)).toEqual(['JOIN #marmotter']);
  });

  it('sets the topic after the join, never before it', () => {
    expect(createChannelLines({ ...plain, topic: 'Building a nicer IRC client' })).toEqual([
      'JOIN #marmotter',
      'TOPIC #marmotter :Building a nicer IRC client',
    ]);
  });

  it('folds the settings into one mode change', () => {
    expect(createChannelLines({ ...plain, inviteOnly: true, secret: true })).toEqual([
      'JOIN #marmotter',
      'MODE #marmotter +is',
    ]);
  });

  // The key goes on the MODE, not the JOIN: a channel nobody is in has no
  // password yet, so joining with one answers a question the server never asked.
  it('sets a password rather than joining with one', () => {
    expect(createChannelLines({ ...plain, password: 'hunter2' })).toEqual([
      'JOIN #marmotter',
      'MODE #marmotter +k hunter2',
    ]);
  });

  it('puts the parameter after the flags that take none', () => {
    expect(createChannelLines({ ...plain, inviteOnly: true, password: 'hunter2' })).toEqual([
      'JOIN #marmotter',
      'MODE #marmotter +ik hunter2',
    ]);
  });

  it('does everything at once in the order a server will accept', () => {
    expect(
      createChannelLines({
        name: '#quiet',
        topic: 'Invitations only',
        inviteOnly: true,
        password: 'hunter2',
        secret: true,
      }),
    ).toEqual(['JOIN #quiet', 'MODE #quiet +isk hunter2', 'TOPIC #quiet :Invitations only']);
  });
});
