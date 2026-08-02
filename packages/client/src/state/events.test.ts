import { describe, expect, it } from 'vitest';
import { channelOf, feed, memberOf, queryOf, registeredSession } from './harness.js';

/**
 * The remaining server-driven events: topic changes, invites, MOTD, standard
 * replies, WHO, and the channel browser.
 *
 * Every one of them exists because CLAUDE.md forbids a numeric reaching the
 * message list as a raw string. Each is either consumed into state or turned
 * into a line a person can read.
 */

const joined = () =>
  feed(registeredSession(), [
    ':marmot!~m@host JOIN #test',
    ':irc.test 353 marmot = #test :@jonquil marmot',
    ':irc.test 366 marmot #test :End of /NAMES list.',
  ]);

describe('the topic', () => {
  it('records a change, with who made it and when', () => {
    const session = feed(joined(), [
      '@time=2026-08-02T09:00:00.000Z :jonquil!~j@host TOPIC #test :Marmot business',
    ]);
    const topic = channelOf(session, '#test').topic;

    expect(topic?.text).toBe('Marmot business');
    expect(topic?.setBy).toBe('jonquil');
    expect(topic?.at).toEqual(new Date('2026-08-02T09:00:00.000Z'));
  });

  it('says who changed it in words, not as a raw command', () => {
    const session = feed(joined(), [':jonquil!~j@host TOPIC #test :Marmot business']);
    const line = channelOf(session, '#test').messages.find((message) => message.kind === 'topic');
    expect(line?.text).toBe('jonquil changed the topic to: Marmot business');
  });

  it('records a topic being cleared', () => {
    const session = feed(joined(), [
      ':jonquil!~j@host TOPIC #test :something',
      ':jonquil!~j@host TOPIC #test :',
    ]);
    expect(channelOf(session, '#test').topic?.text).toBe('');
  });

  it('ignores a topic for a channel we are not in', () => {
    const session = feed(joined(), [':jonquil!~j@host TOPIC #elsewhere :hello']);
    expect(session.state.channels.has('#elsewhere')).toBe(false);
  });

  it('reads the numeric saying a channel has no topic', () => {
    const session = feed(joined(), [':irc.test 331 marmot #test :No topic is set']);
    expect(channelOf(session, '#test').topic).toBeUndefined();
  });

  it('reads when the channel was created', () => {
    const session = feed(joined(), [':irc.test 329 marmot #test 1754130000']);
    expect(channelOf(session, '#test').created).toEqual(new Date(1754130000 * 1000));
  });
});

describe('invites', () => {
  it('turns one into something actionable rather than a raw command', () => {
    const session = feed(joined(), [':jonquil!~j@host INVITE marmot :#secret']);
    const notice = session.state.serverNotices.at(-1);

    expect(notice?.kind).toBe('invite');
    expect(notice?.text).toBe('jonquil invited you to #secret');
    expect(notice?.target).toBe('#secret');
  });
});

describe('the MOTD', () => {
  it('collects it into one item rather than a line each', () => {
    const session = feed(registeredSession(), [
      ':irc.test 375 marmot :- irc.test Message of the Day -',
      ':irc.test 372 marmot :- first line',
      ':irc.test 372 marmot :- second line',
      ':irc.test 376 marmot :End of /MOTD command.',
    ]);

    expect(session.state.motd).toEqual([
      '- irc.test Message of the Day -',
      '- first line',
      '- second line',
    ]);
    // None of it reaches a channel buffer.
    expect(session.state.channels.size).toBe(0);
  });

  it('starts a fresh MOTD rather than appending to the last one', () => {
    const session = feed(registeredSession(), [
      ':irc.test 375 marmot :- old -',
      ':irc.test 376 marmot :End',
      ':irc.test 375 marmot :- new -',
    ]);
    expect(session.state.motd).toEqual(['- new -']);
  });

  it('reaches the registered phase on a server with no MOTD at all', () => {
    const session = feed(feed(registeredSession(), []), [
      ':irc.test 422 marmot :MOTD File is missing',
    ]);
    expect(session.state.phase).toBe('registered');
  });
});

describe('server information', () => {
  it('files the counts in the server tab, not in a channel', () => {
    const session = feed(registeredSession(), [
      ':irc.test 251 marmot :There are 40 users and 900 invisible on 1 servers',
    ]);
    const notice = session.state.serverNotices.at(-1);

    expect(notice?.kind).toBe('server');
    expect(notice?.text).toContain('40 users');
  });

  it('records the server’s own name', () => {
    const session = feed(registeredSession(), [
      ':irc.test 004 marmot irc.test UnrealIRCd-6.1.8 iowrs Iabefhiklmnoprstv',
    ]);
    expect(session.state.serverName).toBe('irc.test');
  });
});

describe('standard replies', () => {
  it('renders a failure as a readable line', () => {
    const session = feed(joined(), [':irc.test FAIL JOIN CHANNEL_FULL #test :Channel is full']);
    const notice = session.state.serverNotices.at(-1);

    expect(notice?.kind).toBe('error');
    expect(notice?.text).toContain('Channel is full');
  });

  it('renders a warning as a notice rather than an error', () => {
    const session = feed(joined(), [':irc.test WARN REHASH CERTS_EXPIRED :Certificate expired']);
    expect(session.state.serverNotices.at(-1)?.kind).toBe('server');
  });

  it('renders a note the same way', () => {
    const session = feed(joined(), [':irc.test NOTE * TEST :Just so you know']);
    expect(session.state.serverNotices.at(-1)?.kind).toBe('server');
  });

  it('ignores one that does not parse rather than inventing a line', () => {
    const before = joined().state.serverNotices.length;
    const session = feed(joined(), [':irc.test FAIL']);
    expect(session.state.serverNotices).toHaveLength(before);
  });
});

describe('errors as plain English', () => {
  it('states what happened and what to do', () => {
    const session = feed(joined(), [':irc.test 473 marmot #private :Cannot join channel (+i)']);
    const notice = session.state.serverNotices.at(-1);

    expect(notice?.kind).toBe('error');
    expect(notice?.text).toBe(
      "#private is invite-only. You'll need an invitation from someone already in the channel.",
    );
    // The numeric itself never reaches the copy.
    expect(notice?.text).not.toContain('473');
  });

  it('does not mistake an error after registration for a nick collision', () => {
    const session = feed(joined(), [':irc.test 433 marmot taken :Nickname is in use']);
    expect(session.sent).not.toContain('NICK marmot_');
  });
});

describe('WHO', () => {
  it('fills in what NAMES could not say', () => {
    const session = feed(joined(), [
      ':irc.test 352 marmot #test ~j host.example irc.test jonquil H@ :0 Jonquil',
      ':irc.test 315 marmot #test :End of /WHO list.',
    ]);
    const member = memberOf(session, '#test', 'jonquil');

    expect(member.user).toBe('~j');
    expect(member.host).toBe('host.example');
    expect(member.realname).toBe('Jonquil');
    expect(member.away).toBe(false);
    // The prefix NAMES already gave is not lost.
    expect(member.prefixes).toBe('@');
  });

  it('reads the away flag', () => {
    const session = feed(joined(), [
      ':irc.test 352 marmot #test ~j host.example irc.test jonquil G :0 Jonquil',
    ]);
    expect(memberOf(session, '#test', 'jonquil').away).toBe(true);
  });

  it('ignores a WHO reply for a channel we are not in', () => {
    const session = feed(joined(), [
      ':irc.test 352 marmot #elsewhere ~x host irc.test stranger H :0 Stranger',
    ]);
    expect(session.state.channels.has('#elsewhere')).toBe(false);
  });
});

describe('the channel browser', () => {
  it('collects a LIST without any of it reaching a message buffer', () => {
    const session = feed(registeredSession(), [
      ':irc.test 321 marmot Channel :Users  Name',
      ':irc.test 322 marmot #first 42 :A topic',
      ':irc.test 322 marmot #second 7 :Another topic',
      ':irc.test 323 marmot :End of /LIST',
    ]);
    // Phase 5 renders the browser; nothing here may leak into a channel.
    expect(session.state.channels.size).toBe(0);
    expect(session.state.serverNotices).toHaveLength(0);
  });
});

describe('private conversations', () => {
  it('opens one under the sender’s nick', () => {
    const session = feed(joined(), [':jonquil!~j@host PRIVMSG marmot :are you there']);
    expect(queryOf(session, 'jonquil').messages.at(-1)?.text).toBe('are you there');
  });

  it('files our own outgoing side under the same conversation', () => {
    const session = feed(joined(), [
      ':jonquil!~j@host PRIVMSG marmot :hello',
      ':marmot!~m@host PRIVMSG jonquil :hello back',
    ]);
    const texts = queryOf(session, 'jonquil').messages.map((message) => message.text);
    expect(texts).toEqual(['hello', 'hello back']);
  });

  it('routes a notice to the sender’s conversation, still marked a notice', () => {
    const session = feed(joined(), [':jonquil!~j@host NOTICE marmot :heads up']);
    expect(queryOf(session, 'jonquil').messages.at(-1)?.kind).toBe('notice');
  });
});

describe('the connection ending', () => {
  it('treats an ERROR line as the connection being over', () => {
    const session = feed(joined(), [':irc.test ERROR :Closing link']);
    expect(session.state.phase).toBe('disconnected');
  });

  it('leaves a command it does not understand entirely alone', () => {
    const before = joined();
    const after = feed(before, [':irc.test SOMETHINGNEW #test :who knows']);
    expect(after.state.channels).toEqual(before.state.channels);
    expect(after.state.serverNotices).toEqual(before.state.serverNotices);
  });
});
