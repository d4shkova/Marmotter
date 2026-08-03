import { describe, expect, it } from 'vitest';
import {
  channelOf,
  feed,
  memberNicks,
  memberOf,
  messageTexts,
  newSession,
  queryOf,
  registeredSession,
} from './harness.js';
import { nextNick, startRegistration } from './reduce.js';

describe('registration', () => {
  it('opens with capability negotiation and identification', () => {
    const step = startRegistration(newSession().state, {
      nick: 'marmot',
      username: 'marmot',
      realname: 'Marmotter user',
    });

    expect(step.send).toEqual(['CAP LS 302', 'NICK marmot', 'USER marmot 0 * :Marmotter user']);
    expect(step.state.phase).toBe('registering');
    // The first nick counts as tried, so a collision does not retry it.
    expect(step.state.triedNicks).toEqual(['marmot']);
  });

  it('reaches the registered phase', () => {
    const registered = registeredSession();
    expect(registered.state.phase).toBe('registered');
    expect(registered.state.nick).toBe('marmot');
  });

  it('adapts to the network rather than assuming defaults', () => {
    const session = registeredSession();
    expect(session.state.support.network).toBe('TestNet');
    expect(session.state.support.prefixes.map((p) => p.prefix).join('')).toBe('~&@%+');
    expect(session.state.support.caseMapping).toBe('rfc1459');
  });

  it('answers PING without the interface having to remember', () => {
    const session = feed(registeredSession(), ['PING :abc123']);
    expect(session.sent).toContain('PONG :abc123');
  });

  it('reports registration completing, so autojoins can follow', () => {
    const session = registeredSession();
    expect(session.effects.some((effect) => effect.kind === 'registered')).toBe(true);
  });
});

describe('nick collision', () => {
  it('works through the alternatives, then appends underscores', () => {
    const context = { altNicks: ['marmot_', 'marmotte'], wantsSasl: false };
    let session = feed(newSession({ nick: 'marmot' }), [], context);
    session = {
      ...session,
      state: { ...session.state, phase: 'registering', triedNicks: ['marmot'] },
    };

    session = feed(session, [':irc.test 433 * marmot :Nickname is already in use.'], context);
    expect(session.state.nick).toBe('marmot_');
    expect(session.sent).toContain('NICK marmot_');

    session = feed(session, [':irc.test 433 * marmot_ :Nickname is already in use.'], context);
    expect(session.state.nick).toBe('marmotte');

    session = feed(session, [':irc.test 433 * marmotte :Nickname is already in use.'], context);
    expect(session.state.nick).toBe('marmotte_');
  });

  it('says so rather than connecting silently under another name', () => {
    const context = { altNicks: ['marmot_'], wantsSasl: false };
    let session = feed(newSession({ nick: 'marmot' }), [], context);
    session = {
      ...session,
      state: { ...session.state, phase: 'registering', triedNicks: ['marmot'] },
    };
    session = feed(session, [':irc.test 433 * marmot :Nickname is already in use.'], context);

    const notice = session.state.serverNotices.at(-1);
    expect(notice?.text).toContain('already taken');
    expect(notice?.text).toContain('marmot_');
    // A quiet inline notice, not an error the interface would shout about.
    expect(notice?.kind).toBe('server');
  });

  it('never reuses a nick already refused', () => {
    const state = {
      ...registeredSession().state,
      nick: 'marmot',
      triedNicks: ['marmot', 'marmot_'],
    };
    expect(nextNick(state, ['marmot_'])).toBe('marmot__');
  });

  it('does not exceed the length the network allows', () => {
    const base = registeredSession();
    const state = {
      ...base.state,
      nick: 'a'.repeat(9),
      triedNicks: ['a'.repeat(9)],
      support: { ...base.state.support, maxNickLength: 9 },
    };
    expect(nextNick(state, []).length).toBeLessThanOrEqual(9);
  });
});

describe('joining and the member list', () => {
  const joined = () =>
    feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :@jonquil +emilyp tamsin marmot',
      ':irc.test 366 marmot #test :End of /NAMES list.',
      ':irc.test 332 marmot #test :Building a client',
      ':irc.test 333 marmot #test jonquil 1753858800',
    ]);

  it('records the channel as joined', () => {
    expect(channelOf(joined(), '#test').joined).toBe(true);
  });

  it('reads the member list with prefixes split off', () => {
    expect(memberNicks(joined(), '#test')).toEqual(['emilyp', 'jonquil', 'marmot', 'tamsin']);
    expect(memberOf(joined(), '#test', 'jonquil').prefixes).toBe('@');
    expect(memberOf(joined(), '#test', 'emilyp').prefixes).toBe('+');
    expect(memberOf(joined(), '#test', 'tamsin').prefixes).toBe('');
  });

  it('reads the topic and who set it', () => {
    const topic = channelOf(joined(), '#test').topic;
    expect(topic?.text).toBe('Building a client');
    expect(topic?.setBy).toBe('jonquil');
    expect(topic?.at).toEqual(new Date(1753858800000));
  });

  it('accumulates a NAMES burst split across several replies', () => {
    const session = feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :@jonquil +emilyp',
      ':irc.test 353 marmot = #test :tamsin marmot',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);
    expect(memberNicks(session, '#test')).toEqual(['emilyp', 'jonquil', 'marmot', 'tamsin']);
  });

  it('replaces the list when a second burst starts', () => {
    const session = feed(joined(), [
      ':irc.test 353 marmot = #test :@jonquil',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);
    expect(memberNicks(session, '#test')).toEqual(['jonquil']);
  });

  it('takes the account and realname from extended-join without a WHO', () => {
    const session = feed(joined(), [':bramble!~b@host JOIN #test bramble_account :Bramble Person']);
    const member = memberOf(session, '#test', 'bramble');
    expect(member.account).toBe('bramble_account');
    expect(member.realname).toBe('Bramble Person');
    expect(member.host).toBe('host');
  });

  it('treats a * account in extended-join as logged out', () => {
    const session = feed(joined(), [':bramble!~b@host JOIN #test * :Bramble']);
    expect(memberOf(session, '#test', 'bramble').account).toBeUndefined();
  });

  it('fills in the host from a WHO reply without losing the prefix', () => {
    const session = feed(joined(), [
      ':irc.test 352 marmot #test ~jq real.host irc.test jonquil H@ :0 Jonquil',
    ]);
    const member = memberOf(session, '#test', 'jonquil');
    expect(member.host).toBe('real.host');
    expect(member.realname).toBe('Jonquil');
    expect(member.prefixes).toBe('@');
  });

  it('removes a member who parts, and keeps the rest', () => {
    const session = feed(joined(), [':tamsin!~t@host PART #test :bye']);
    expect(memberNicks(session, '#test')).toEqual(['emilyp', 'jonquil', 'marmot']);
  });

  it('empties the list when we leave, but keeps the buffer', () => {
    const session = feed(joined(), [':marmot!~m@host PART #test :bye']);
    const channel = channelOf(session, '#test');
    expect(channel.joined).toBe(false);
    expect(channel.members.size).toBe(0);
    expect(channel.messages.length).toBeGreaterThan(0);
  });

  it('removes someone who is kicked', () => {
    const session = feed(joined(), [':jonquil!~j@host KICK #test tamsin :spam']);
    expect(memberNicks(session, '#test')).not.toContain('tamsin');
    expect(messageTexts(session, '#test').at(-1)).toContain('tamsin was removed by jonquil');
  });

  it('marks the channel unjoined when we are the one kicked', () => {
    const session = feed(joined(), [':jonquil!~j@host KICK #test marmot :bye']);
    expect(channelOf(session, '#test').joined).toBe(false);
  });
});

describe('member list amendments', () => {
  const joined = () =>
    feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :@jonquil +emilyp marmot',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);

  it('applies away-notify', () => {
    const session = feed(joined(), [':emilyp!~e@host AWAY :back later']);
    expect(memberOf(session, '#test', 'emilyp').away).toBe(true);

    const back = feed(session, [':emilyp!~e@host AWAY']);
    expect(memberOf(back, '#test', 'emilyp').away).toBe(false);
  });

  it('applies account-notify', () => {
    const session = feed(joined(), [':emilyp!~e@host ACCOUNT emily_account']);
    expect(memberOf(session, '#test', 'emilyp').account).toBe('emily_account');

    const out = feed(session, [':emilyp!~e@host ACCOUNT *']);
    expect(memberOf(out, '#test', 'emilyp').account).toBeUndefined();
  });

  it('applies chghost without disturbing anything else', () => {
    const session = feed(joined(), [
      ':emilyp!~e@host ACCOUNT emily_account',
      ':emilyp!~e@host CHGHOST newuser new.host',
    ]);
    const member = memberOf(session, '#test', 'emilyp');
    expect(member.user).toBe('newuser');
    expect(member.host).toBe('new.host');
    // The account survived the host change.
    expect(member.account).toBe('emily_account');
    expect(member.prefixes).toBe('+');
  });

  it('applies setname', () => {
    const session = feed(joined(), [':emilyp!~e@host SETNAME :A New Name']);
    expect(memberOf(session, '#test', 'emilyp').realname).toBe('A New Name');
  });

  it('tracks our own away state', () => {
    const session = feed(registeredSession(), [':irc.test 306 marmot :You have been marked away']);
    expect(session.state.away).toBe(true);
    expect(feed(session, [':irc.test 305 marmot :No longer away']).state.away).toBe(false);
  });
});

describe('messages', () => {
  const joined = () =>
    feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :marmot jonquil',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);

  it('records a channel message', () => {
    const session = feed(joined(), ['@msgid=a1 :jonquil!~j@host PRIVMSG #test :hello there']);
    const message = channelOf(session, '#test').messages.at(-1);
    expect(message?.kind).toBe('privmsg');
    expect(message?.text).toBe('hello there');
    expect(message?.id).toBe('a1');
  });

  it('reads an ACTION as an action rather than message text', () => {
    const session = feed(joined(), [':jonquil!~j@host PRIVMSG #test :ACTION waves']);
    const message = channelOf(session, '#test').messages.at(-1);
    expect(message?.kind).toBe('action');
    expect(message?.text).toBe('waves');
  });

  it('marks a notice as a notice, never as a message', () => {
    const session = feed(joined(), [':irc.test NOTICE #test :server notice']);
    expect(channelOf(session, '#test').messages.at(-1)?.kind).toBe('notice');
  });

  // Three sidebar rows for one network — the network, a row named after the
  // server, and a row called `*` — is what filing these as conversation looks
  // like from the outside.
  it('files what the server says on the network tab, not in a conversation', () => {
    const session = feed(registeredSession(), [
      ':irc.test NOTICE marmot :*** You are connecting from 10.0.0.1',
    ]);
    expect(session.state.queries.size).toBe(0);
    expect(session.state.serverNotices.at(-1)?.text).toBe('*** You are connecting from 10.0.0.1');
  });

  it('does not open a conversation called * for a pre-registration notice', () => {
    const session = feed(newSession(), [':irc.test NOTICE * :*** Looking up your hostname']);
    expect(session.state.queries.size).toBe(0);
    expect(session.state.serverNotices.at(-1)?.text).toBe('*** Looking up your hostname');
  });

  it('still treats a notice from a person as a conversation', () => {
    const session = feed(registeredSession(), [':bramble!~b@host NOTICE marmot :are you there']);
    expect(queryOf(session, 'bramble').messages.at(-1)?.kind).toBe('notice');
  });

  it('files a private message under the sender, not under our own nick', () => {
    const session = feed(registeredSession(), [':bramble!~b@host PRIVMSG marmot :are you there']);
    expect(queryOf(session, 'bramble').messages.at(-1)?.text).toBe('are you there');
  });

  it('uses server-time when the server provides it', () => {
    const session = feed(joined(), [
      '@time=2026-08-02T09:14:00.000Z :jonquil!~j@host PRIVMSG #test :timed',
    ]);
    const message = channelOf(session, '#test').messages.at(-1);
    expect(message?.at).toEqual(new Date('2026-08-02T09:14:00.000Z'));
    expect(message?.fromServerTime).toBe(true);
  });

  it('falls back to the local clock, and says so', () => {
    const session = feed(joined(), [':jonquil!~j@host PRIVMSG #test :untimed']);
    expect(channelOf(session, '#test').messages.at(-1)?.fromServerTime).toBe(false);
  });

  it('reads the reply tag', () => {
    const session = feed(joined(), [
      '@msgid=b1;+draft/reply=a1 :jonquil!~j@host PRIVMSG #test :answering',
    ]);
    expect(channelOf(session, '#test').messages.at(-1)?.replyTo).toBe('a1');
  });

  it('reads the account tag', () => {
    const session = feed(joined(), ['@account=jq :jonquil!~j@host PRIVMSG #test :hello']);
    expect(channelOf(session, '#test').messages.at(-1)?.account).toBe('jq');
  });
});

describe('modes', () => {
  const joined = () =>
    feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :marmot jonquil tamsin',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);

  it('applies a channel mode', () => {
    const session = feed(joined(), [':jonquil!~j@host MODE #test +nt']);
    const modes = channelOf(session, '#test').modes;
    expect(modes.flags.has('n')).toBe(true);
    expect(modes.flags.has('t')).toBe(true);
  });

  it('records a mode that carries a value', () => {
    const session = feed(joined(), [':jonquil!~j@host MODE #test +k secret']);
    expect(channelOf(session, '#test').modes.params.get('k')).toBe('secret');
  });

  it('applies a prefix change to the member, not the channel', () => {
    const session = feed(joined(), [':jonquil!~j@host MODE #test +o tamsin']);
    expect(memberOf(session, '#test', 'tamsin').prefixes).toBe('@');
    expect(channelOf(session, '#test').modes.flags.has('o')).toBe(false);
  });

  it('handles a compound change', () => {
    const session = feed(joined(), [
      ':jonquil!~j@host MODE #test +o-v+b tamsin marmot *!*@bad.host',
    ]);
    expect(memberOf(session, '#test', 'tamsin').prefixes).toBe('@');
    expect(memberOf(session, '#test', 'marmot').prefixes).toBe('');
  });

  it('applies a mode change that arrives while NAMES is still streaming', () => {
    // The member list is built by upsert, so a change landing mid-burst is not
    // lost when the rest of the burst arrives.
    const session = feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :marmot jonquil',
      ':jonquil!~j@host MODE #test +o jonquil',
      ':irc.test 353 marmot = #test :tamsin',
      ':irc.test 366 marmot #test :End of /NAMES list.',
    ]);

    expect(memberOf(session, '#test', 'jonquil').prefixes).toBe('@');
    expect(memberNicks(session, '#test')).toEqual(['jonquil', 'marmot', 'tamsin']);
  });

  it('reads the channel mode reply', () => {
    const session = feed(joined(), [':irc.test 324 marmot #test +nt']);
    expect(channelOf(session, '#test').modes.flags.has('n')).toBe(true);
  });

  it('tracks our own user modes', () => {
    const session = feed(registeredSession(), [':marmot MODE marmot :+iw']);
    expect([...session.state.userModes].sort()).toEqual(['i', 'w']);
  });
});

describe('ban and exception lists', () => {
  const joined = () => feed(registeredSession(), [':marmot!~m@host JOIN #test']);

  it('collects a ban list and marks it loaded at the end', () => {
    const session = feed(joined(), [
      ':irc.test 367 marmot #test *!*@bad.host jonquil 1753859000',
      ':irc.test 367 marmot #test $a:spammer jonquil 1753859100',
      ':irc.test 368 marmot #test :End of channel ban list',
    ]);

    const channel = channelOf(session, '#test');
    expect(channel.lists.ban.map((entry) => entry.mask)).toEqual(['*!*@bad.host', '$a:spammer']);
    expect(channel.lists.ban[0]?.setBy).toBe('jonquil');
    expect(channel.listsLoading.has('ban')).toBe(false);
  });

  it('keeps the four lists apart', () => {
    const session = feed(joined(), [
      ':irc.test 367 marmot #test ban!*@* a 1',
      ':irc.test 348 marmot #test except!*@* a 1',
      ':irc.test 346 marmot #test invite!*@* a 1',
      ':irc.test 728 marmot #test q quiet!*@* a 1',
    ]);

    const lists = channelOf(session, '#test').lists;
    expect(lists.ban).toHaveLength(1);
    expect(lists.except).toHaveLength(1);
    expect(lists.invite).toHaveLength(1);
    expect(lists.quiet).toHaveLength(1);
  });
});

describe('casemapping', () => {
  it('treats a channel as the same however the server spells it', () => {
    const session = feed(registeredSession(), [
      ':marmot!~m@host JOIN #Test',
      ':jonquil!~j@host PRIVMSG #test :same channel',
    ]);
    expect(channelOf(session, '#TEST').messages.at(-1)?.text).toBe('same channel');
  });

  it('folds the Scandinavian pairs under rfc1459', () => {
    const session = feed(registeredSession(), [
      ':marmot!~m@host JOIN #test',
      ':irc.test 353 marmot = #test :nick[]',
      ':irc.test 366 marmot #test :End of /NAMES',
      ':nick[]!~n@host AWAY :gone',
    ]);
    // `nick{}` and `nick[]` are the same person under rfc1459.
    expect(memberOf(session, '#test', 'nick{}').away).toBe(true);
  });

  it('does not fold them under ascii', () => {
    const session = feed(
      registeredSession({
        isupport: 'PREFIX=(ov)@+ CHANTYPES=# CASEMAPPING=ascii',
      }),
      [
        ':marmot!~m@host JOIN #test',
        ':irc.test 353 marmot = #test :nick[]',
        ':irc.test 366 marmot #test :End of /NAMES',
      ],
    );
    expect(() => memberOf(session, '#test', 'nick{}')).toThrow();
  });
});
