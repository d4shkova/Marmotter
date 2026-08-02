import { describe, expect, it } from 'vitest';
import { feed, registeredSession } from './harness.js';
import {
  NOTIFY_BATCH,
  POLL_LIMIT,
  addNotifyLines,
  addToNotify,
  clearNotifyLines,
  notifyLimit,
  notifyMechanism,
  pollTargets,
  refreshNotifyLines,
  removeFromNotify,
  removeNotifyLines,
  resyncNotify,
} from './notify.js';

/** A registered session on a network advertising the given tokens. */
const on = (tokens: string) =>
  registeredSession({
    isupport: `PREFIX=(ohv)@%+ CHANTYPES=# CASEMAPPING=rfc1459 ${tokens}`,
  });

const libera = () => on('MONITOR=100');
const unreal = () => on('WATCH=128');
const bare = () => on('NETWORK=Small');

describe('picking a mechanism', () => {
  it('prefers MONITOR where the network has it', () => {
    expect(notifyMechanism(libera().state.support)).toBe('monitor');
  });

  it('falls back to WATCH, which is what UnrealIRCd offers', () => {
    expect(notifyMechanism(unreal().state.support)).toBe('watch');
  });

  it('falls back to polling when the network has neither', () => {
    expect(notifyMechanism(bare().state.support)).toBe('poll');
  });

  it('prefers MONITOR when a network advertises both', () => {
    expect(notifyMechanism(on('MONITOR=100 WATCH=128').state.support)).toBe('monitor');
  });
});

describe('limits', () => {
  it('reads the advertised limit', () => {
    expect(notifyLimit(libera().state.support)).toBe(100);
    expect(notifyLimit(unreal().state.support)).toBe(128);
  });

  it('keeps the poll list short, because each entry costs a WHOIS per tick', () => {
    expect(notifyLimit(bare().state.support)).toBe(POLL_LIMIT);
  });

  it('reports no limit when the network states none', () => {
    expect(notifyLimit(on('MONITOR').state.support)).toBeUndefined();
  });
});

describe('the lines each mechanism uses', () => {
  it('adds and removes with MONITOR', () => {
    const support = libera().state.support;
    expect(addNotifyLines(['tamsin', 'jonquil'], support)).toEqual(['MONITOR + tamsin,jonquil']);
    expect(removeNotifyLines(['tamsin'], support)).toEqual(['MONITOR - tamsin']);
    expect(refreshNotifyLines(['tamsin'], support)).toEqual(['MONITOR S']);
    expect(clearNotifyLines(support)).toEqual(['MONITOR C']);
  });

  it('adds and removes with WATCH, which signs each nick', () => {
    const support = unreal().state.support;
    expect(addNotifyLines(['tamsin', 'jonquil'], support)).toEqual(['WATCH +tamsin +jonquil']);
    expect(removeNotifyLines(['tamsin'], support)).toEqual(['WATCH -tamsin']);
    expect(refreshNotifyLines(['tamsin'], support)).toEqual(['WATCH S']);
    expect(clearNotifyLines(support)).toEqual(['WATCH C']);
  });

  it('registers nothing when there is nothing to register with', () => {
    const support = bare().state.support;
    expect(addNotifyLines(['tamsin'], support)).toEqual([]);
    expect(removeNotifyLines(['tamsin'], support)).toEqual([]);
    expect(clearNotifyLines(support)).toEqual([]);
    expect(refreshNotifyLines(['tamsin', 'jonquil'], support)).toEqual([
      'WHOIS tamsin',
      'WHOIS jonquil',
    ]);
  });

  it('chunks a long list rather than letting the server truncate it', () => {
    const nicks = Array.from({ length: NOTIFY_BATCH * 2 + 1 }, (_, index) => `n${index}`);
    expect(addNotifyLines(nicks, libera().state.support)).toHaveLength(3);
  });

  it('sends nothing for an empty list', () => {
    expect(addNotifyLines([], libera().state.support)).toEqual([]);
    expect(refreshNotifyLines([], libera().state.support)).toEqual([]);
  });
});

describe('maintaining the list', () => {
  it('adds nicks and registers them', () => {
    const change = addToNotify(libera().state, ['tamsin', 'jonquil']);
    expect([...change.notify.values()].map((entry) => entry.nick)).toEqual(['tamsin', 'jonquil']);
    expect(change.send).toEqual(['MONITOR + tamsin,jonquil']);
    expect(change.rejected).toEqual([]);
  });

  it('starts everyone as not-yet-known rather than assuming offline', () => {
    const change = addToNotify(libera().state, ['tamsin']);
    expect([...change.notify.values()][0]).toEqual({
      nick: 'tamsin',
      online: false,
      known: false,
    });
  });

  it('does not re-register someone already on the list', () => {
    const first = addToNotify(libera().state, ['tamsin']);
    const state = { ...libera().state, notify: first.notify };
    const second = addToNotify(state, ['Tamsin']);
    expect(second.send).toEqual([]);
    expect(second.notify.size).toBe(1);
  });

  it('reports what the network would not accept rather than dropping it quietly', () => {
    const state = on('MONITOR=2').state;
    const change = addToNotify(state, ['a', 'b', 'c']);
    expect(change.notify.size).toBe(2);
    expect(change.rejected).toEqual(['c']);
  });

  it('removes nicks and deregisters them', () => {
    const added = addToNotify(libera().state, ['tamsin', 'jonquil']);
    const state = { ...libera().state, notify: added.notify };
    const change = removeFromNotify(state, ['tamsin']);
    expect(change.notify.size).toBe(1);
    expect(change.send).toEqual(['MONITOR - tamsin']);
  });

  it('ignores a removal for someone who was never on the list', () => {
    const change = removeFromNotify(libera().state, ['stranger']);
    expect(change.send).toEqual([]);
  });
});

describe('after a reconnect', () => {
  it('re-registers the whole list, because the server forgot it', () => {
    const added = addToNotify(libera().state, ['tamsin', 'jonquil']);
    const state = { ...libera().state, notify: added.notify };
    const resync = resyncNotify(state);

    expect(resync.send).toEqual(['MONITOR C', 'MONITOR + tamsin,jonquil']);
  });

  it('forgets who was online, rather than showing stale presence', () => {
    const session = feed(libera(), [':irc.test 730 marmot :tamsin!~u@host']);
    const withEntry = addToNotify(session.state, ['tamsin']);
    // Already present and online from the burst.
    const online = { ...session.state, notify: withEntry.notify };
    expect(online.notify.get('tamsin')?.online).toBe(true);

    const resync = resyncNotify(online);
    expect(resync.notify.get('tamsin')?.known).toBe(false);
  });

  it('has nothing to re-register on a polled network', () => {
    const added = addToNotify(bare().state, ['tamsin']);
    const state = { ...bare().state, notify: added.notify };
    expect(resyncNotify(state).send).toEqual([]);
  });
});

describe('the poll fallback', () => {
  it('names who to WHOIS on the next tick', () => {
    const added = addToNotify(bare().state, ['tamsin', 'jonquil']);
    const state = { ...bare().state, notify: added.notify };
    expect(pollTargets(state)).toEqual(['tamsin', 'jonquil']);
  });

  it('polls nobody on a network that has a real mechanism', () => {
    const added = addToNotify(libera().state, ['tamsin']);
    const state = { ...libera().state, notify: added.notify };
    expect(pollTargets(state)).toEqual([]);
  });
});

describe('reading the server back', () => {
  it('marks someone online from a MONITOR burst', () => {
    const session = feed(libera(), [':irc.test 730 marmot :tamsin!~u@host,jonquil!~u@host']);
    expect(session.state.notify.get('tamsin')).toEqual({
      nick: 'tamsin',
      online: true,
      known: true,
    });
    expect(session.state.notify.get('jonquil')?.online).toBe(true);
  });

  it('marks someone offline', () => {
    const session = feed(libera(), [
      ':irc.test 730 marmot :tamsin!~u@host',
      ':irc.test 731 marmot :tamsin',
    ]);
    expect(session.state.notify.get('tamsin')?.online).toBe(false);
    expect(session.state.notify.get('tamsin')?.known).toBe(true);
  });

  it('reads a WATCH reply the same way', () => {
    const session = feed(unreal(), [
      ':irc.test 600 marmot tamsin ~u host.example 1754130000 :logged online',
    ]);
    expect(session.state.notify.get('tamsin')?.online).toBe(true);
  });

  it('drops someone the server confirms was removed', () => {
    const session = feed(unreal(), [
      ':irc.test 604 marmot tamsin ~u host 0 :is online',
      ':irc.test 602 marmot tamsin * * 0 :stopped watching',
    ]);
    expect(session.state.notify.has('tamsin')).toBe(false);
  });

  it('takes the stored list as authoritative for membership', () => {
    const session = feed(libera(), [
      ':irc.test 730 marmot :tamsin!~u@host',
      ':irc.test 732 marmot :tamsin,jonquil',
      ':irc.test 733 marmot :End of MONITOR list',
    ]);
    expect([...session.state.notify.keys()].sort()).toEqual(['jonquil', 'tamsin']);
    // Membership changed; what was already known about tamsin did not.
    expect(session.state.notify.get('tamsin')?.online).toBe(true);
    expect(session.state.notify.get('jonquil')?.known).toBe(false);
  });

  it('keeps the spelling the user chose, not the server’s', () => {
    const added = addToNotify(libera().state, ['Tamsin']);
    const session = feed({ ...libera(), state: { ...libera().state, notify: added.notify } }, [
      ':irc.test 730 marmot :tamsin!~u@host',
    ]);
    expect(session.state.notify.get('tamsin')?.nick).toBe('Tamsin');
  });
});
