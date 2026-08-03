import {
  type ChannelState,
  type Member,
  type NetworkState,
  emptyChannel,
  initialNetworkState,
} from '@marmotter/client';
import { DEFAULT_ISUPPORT, applyISupport } from '@marmotter/protocol';
import { describe, expect, it, vi } from 'vitest';
import { memberActions } from './member-actions.js';

const support = applyISupport(DEFAULT_ISUPPORT, [
  'PREFIX=(qaohv)~&@%+',
  'CHANTYPES=#',
  'CASEMAPPING=rfc1459',
]);

const member = (nick: string, prefixes = ''): Member => ({
  nick,
  user: `~${nick[0]}`,
  host: 'host',
  account: undefined,
  realname: nick,
  away: false,
  bot: false,
  prefixes,
});

const channelWith = (...members: Member[]): ChannelState => ({
  ...emptyChannel('#test'),
  joined: true,
  members: new Map(members.map((entry) => [entry.nick, entry])),
});

const network = (): NetworkState => ({ ...initialNetworkState('n', 'Net', 'me'), support });

const callbacks = () => ({
  onMessage: vi.fn(),
  onWhois: vi.fn(),
  onIgnore: vi.fn(),
  onSend: vi.fn(),
});

const build = (target: Member, us: Member, others: Member[] = []) => {
  const cbs = callbacks();
  const items = memberActions(target, {
    network: network(),
    channel: channelWith(us, target, ...others),
    ourNick: us.nick,
    callbacks: cbs,
  });
  return { items, cbs };
};

const labels = (items: ReturnType<typeof build>['items']): string[] =>
  items.map((item) => item.label);

const run = (items: ReturnType<typeof build>['items'], id: string): void => {
  const item = items.find((entry) => entry.id === id);
  if (item === undefined) {
    throw new Error(`no menu item ${id}`);
  }
  item.onSelect();
};

describe('what anyone can do', () => {
  it('always offers to message and to look someone up', () => {
    const { items } = build(member('tamsin'), member('me'));
    expect(labels(items)).toContain('Send a message');
    expect(labels(items)).toContain('View details');
  });

  it('messages by name rather than by a command', () => {
    const { items, cbs } = build(member('tamsin'), member('me'));
    run(items, 'message');
    expect(cbs.onMessage).toHaveBeenCalledWith('tamsin');
  });

  it('asks the network who someone is', () => {
    const { items, cbs } = build(member('tamsin'), member('me'));
    run(items, 'whois');
    expect(cbs.onWhois).toHaveBeenCalledWith('tamsin');
  });
});

describe('moderation, only when we can', () => {
  it('offers nothing beyond the basics to somebody with no power', () => {
    const { items } = build(member('tamsin'), member('me'));
    // No op, no kick, no ban when we are an ordinary member.
    expect(labels(items)).toEqual(['Send a message', 'View details', 'Ignore']);
  });

  it('offers the moderation actions to an operator', () => {
    const { items } = build(member('tamsin'), member('me', '@'));
    expect(labels(items)).toContain('Make an operator');
    expect(labels(items)).toContain('Give voice');
    expect(labels(items)).toContain('Remove from channel');
    expect(labels(items)).toContain('Ban');
  });

  it('turns a role into the right mode change', () => {
    const { items, cbs } = build(member('tamsin'), member('me', '@'));
    run(items, 'o');
    expect(cbs.onSend).toHaveBeenCalledWith('MODE #test +o tamsin');
    run(items, 'v');
    expect(cbs.onSend).toHaveBeenCalledWith('MODE #test +v tamsin');
  });

  it('offers to remove a role the person already holds', () => {
    const { items, cbs } = build(member('tamsin', '@'), member('me', '~'));
    expect(labels(items)).toContain('Remove operator');
    run(items, 'o');
    expect(cbs.onSend).toHaveBeenCalledWith('MODE #test -o tamsin');
  });

  it('kicks and bans through the menu, not the command line', () => {
    const { items, cbs } = build(member('tamsin'), member('me', '@'));
    run(items, 'kick');
    expect(cbs.onSend).toHaveBeenCalledWith('KICK #test tamsin');
    run(items, 'ban');
    expect(cbs.onSend).toHaveBeenCalledWith('MODE #test +b tamsin!*@*');
  });

  it('will not act on somebody who outranks us', () => {
    // We are an operator; they are the owner. We cannot touch them.
    const { items } = build(member('owner', '~'), member('me', '@'));
    expect(labels(items)).not.toContain('Remove from channel');
    expect(labels(items)).not.toContain('Ban');
  });

  it('does not offer moderation on ourselves', () => {
    const { items } = build(member('me', '@'), member('me', '@'));
    expect(labels(items)).not.toContain('Make an operator');
    expect(labels(items)).not.toContain('Remove from channel');
  });
});

describe('following the network’s own roles', () => {
  it('does not offer half-op on a network without one', () => {
    const noHalfOp = applyISupport(DEFAULT_ISUPPORT, ['PREFIX=(ov)@+', 'CHANTYPES=#']);
    const items = memberActions(member('tamsin'), {
      network: { ...network(), support: noHalfOp },
      channel: {
        ...channelWith(member('me', '@'), member('tamsin')),
      },
      ourNick: 'me',
      callbacks: callbacks(),
    });
    expect(labels(items)).toContain('Make an operator');
    expect(labels(items)).not.toContain('Make a half-op');
  });

  it('lets a half-op moderate where the network has the role', () => {
    const { items } = build(member('tamsin'), member('me', '%'));
    // A half-op can kick and ban, which is what the role is for.
    expect(labels(items)).toContain('Remove from channel');
  });
});

describe('the ban builder', () => {
  it('is preferred over a default mask when the caller offers one', () => {
    const onBanBuilder = vi.fn();
    const items = memberActions(member('tamsin'), {
      network: network(),
      channel: channelWith(member('me', '@'), member('tamsin')),
      ourNick: 'me',
      callbacks: { ...callbacks(), onBanBuilder },
    });
    run(items, 'ban');
    expect(onBanBuilder).toHaveBeenCalled();
  });
});
