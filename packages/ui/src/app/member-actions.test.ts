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

describe('lifting what is already set', () => {
  /** Builds a menu with the channel's ban and mute tables already fetched. */
  const withLists = (
    target: Member,
    us: Member,
    lists: Partial<ChannelState['lists']>,
    options: { operator?: boolean } = {},
  ) => {
    const cbs = { ...callbacks(), onOpenList: vi.fn(), onKillBuilder: vi.fn() };
    const base = channelWith(us, target);
    const items = memberActions(target, {
      network: network(),
      channel: { ...base, lists: { ...base.lists, ...lists } },
      ourNick: us.nick,
      ...options,
      callbacks: cbs,
    });
    return { items, cbs };
  };

  const entry = (mask: string) => ({ mask, setBy: 'someone', at: undefined });

  it('offers to lift a ban that catches them', () => {
    const target = member('tamsin');
    const { items, cbs } = withLists(target, member('me', '@'), {
      ban: [entry('tamsin!*@*')],
    });

    expect(labels(items)).toContain('Lift their ban');
    run(items, 'unb');
    expect(cbs.onSend).toHaveBeenCalledWith('MODE #test -b tamsin!*@*');
  });

  it('leaves a ban that catches somebody else alone', () => {
    const { items } = withLists(member('tamsin'), member('me', '@'), {
      ban: [entry('jonquil!*@*')],
    });

    expect(labels(items)).not.toContain('Lift their ban');
  });

  it('lifts every ban that catches them, one line each', () => {
    // How many parameters a MODE may carry differs by network, so several masks
    // on one line is a line some server will truncate — lifting some of them
    // and silently leaving the rest.
    const { items, cbs } = withLists(member('tamsin'), member('me', '@'), {
      ban: [entry('tamsin!*@*'), entry('*!*@host'), entry('jonquil!*@*')],
    });

    expect(labels(items)).toContain('Lift their ban (2)');
    run(items, 'unb');
    expect(cbs.onSend).toHaveBeenCalledTimes(2);
    expect(cbs.onSend).toHaveBeenCalledWith('MODE #test -b tamsin!*@*');
    expect(cbs.onSend).toHaveBeenCalledWith('MODE #test -b *!*@host');
  });

  it('offers the tables even when it has not fetched them', () => {
    // The lists load when their table is opened, so an empty list means "we
    // have not looked", not "they are not banned". The route in has to exist or
    // the menu would quietly imply the second.
    const { items, cbs } = withLists(member('tamsin'), member('me', '@'), { ban: [] });

    expect(labels(items)).toContain('Manage bans and mutes');
    run(items, 'lists');
    expect(cbs.onOpenList).toHaveBeenCalledWith('ban');
  });

  it('offers none of it to somebody who cannot moderate', () => {
    const { items } = withLists(member('tamsin'), member('me'), {
      ban: [entry('tamsin!*@*')],
    });

    expect(labels(items)).not.toContain('Lift their ban');
    expect(labels(items)).not.toContain('Manage bans and mutes');
  });
});

describe('server operator actions', () => {
  const build = (options: { operator?: boolean }) => {
    const cbs = { ...callbacks(), onKillBuilder: vi.fn() };
    const target = member('tamsin');
    const us = member('me', '@');
    const items = memberActions(target, {
      network: network(),
      channel: channelWith(us, target),
      ourNick: us.nick,
      ...options,
      callbacks: cbs,
    });
    return { items, cbs, target };
  };

  it('offers to disconnect somebody on a network the user operates', () => {
    const { items, cbs, target } = build({ operator: true });

    expect(labels(items)).toContain('Disconnect from the network');
    run(items, 'kill');
    // It opens a builder rather than firing: a disconnection carries a reason
    // the person on the other end is shown.
    expect(cbs.onKillBuilder).toHaveBeenCalledWith(target);
    expect(cbs.onSend).not.toHaveBeenCalled();
  });

  it('says nothing about it on a network the user does not operate', () => {
    expect(labels(build({}).items)).not.toContain('Disconnect from the network');
  });

  it('never offers it against yourself', () => {
    const us = member('me', '@');
    const items = memberActions(us, {
      network: network(),
      channel: channelWith(us),
      ourNick: us.nick,
      operator: true,
      callbacks: { ...callbacks(), onKillBuilder: vi.fn() },
    });

    expect(labels(items)).not.toContain('Disconnect from the network');
  });
});

describe('mutes, where the network has them', () => {
  const entry = (mask: string) => ({ mask, setBy: 'someone', at: undefined });

  /** A network whose `+q` is a mute list rather than channel ownership. */
  const quietSupport = applyISupport(DEFAULT_ISUPPORT, [
    'PREFIX=(ohv)@%+',
    'CHANMODES=beIq,k,l,imnpst',
    'CHANTYPES=#',
    'CASEMAPPING=rfc1459',
  ]);

  it('offers to lift a mute on a network that keeps a mute list', () => {
    const target = member('tamsin');
    const us = member('me', '@');
    const base = channelWith(us, target);
    const cbs = callbacks();

    const items = memberActions(target, {
      network: { ...initialNetworkState('n', 'Net', 'me'), support: quietSupport },
      channel: { ...base, lists: { ...base.lists, quiet: [entry('tamsin!*@*')] } },
      ourNick: us.nick,
      callbacks: cbs,
    });

    expect(items.map((item) => item.label)).toContain('Lift their mute');
  });

  it('says nothing about mutes where +q is channel ownership instead', () => {
    // `+q` is a mute list on some ircds and ownership on others. Reading
    // CHANMODES rather than assuming is the whole point: on the PREFIX-based
    // network at the top of this file, `-q` would take somebody's ownership
    // away while claiming to unmute them.
    const target = member('tamsin');
    const us = member('me', '@');
    const base = channelWith(us, target);

    const items = memberActions(target, {
      network: network(),
      channel: { ...base, lists: { ...base.lists, quiet: [entry('tamsin!*@*')] } },
      ourNick: us.nick,
      callbacks: callbacks(),
    });

    expect(items.map((item) => item.label)).not.toContain('Lift their mute');
  });
});
