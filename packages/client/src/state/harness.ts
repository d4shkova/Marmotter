/**
 * The headless test harness BUILD_PLAN phase 3 asks for.
 *
 * Drives a scripted session transcript through the reducer and hands back the
 * resulting state, with no sockets, no timers, and no React. Exported rather
 * than kept in a test file because Phase 5's end-to-end work reuses it to build
 * fixtures.
 */

import { type IrcMessage, fold, parseMessage } from '@marmotter/protocol';
import { type Effect, type ReduceContext, initialNetworkState, reduce } from './reduce.js';
import type { ChannelState, Member, NetworkState } from './types.js';

/**
 * The result of replaying a transcript: the state it produced, and everything
 * the reducer asked to send along the way.
 */
export interface Transcript {
  readonly state: NetworkState;
  /** Every line the reducer asked to send, in order. */
  readonly sent: readonly string[];
  readonly effects: readonly Effect[];
}

const defaultContext: ReduceContext = {
  altNicks: [],
  wantsSasl: false,
  // A fixed clock, so a message with no `server-time` still has a stable id and
  // ordering. Tests that care about time supply their own.
  now: () => new Date('2026-08-02T00:00:00.000Z'),
};

/** Feeds one already-parsed message. */
export function feedMessage(
  session: Transcript,
  message: IrcMessage,
  context: ReduceContext = defaultContext,
): Transcript {
  const step = reduce(session.state, message, context);
  return {
    state: step.state,
    sent: [...session.sent, ...step.send],
    effects: [...session.effects, ...step.effects],
  };
}

/**
 * Feeds raw lines.
 *
 * A line that fails to parse throws rather than being skipped: a transcript
 * fixture with a typo should fail loudly, not quietly test less than it claims.
 */
export function feed(
  session: Transcript,
  lines: readonly string[],
  context: ReduceContext = defaultContext,
): Transcript {
  return lines.reduce((current, line) => {
    const parsed = parseMessage(line);
    if (!parsed.ok) {
      throw new Error(`transcript line does not parse: ${line}`);
    }
    return feedMessage(current, parsed.message, context);
  }, session);
}

export function newSession(
  options: { id?: string; name?: string; nick?: string } = {},
): Transcript {
  return {
    state: initialNetworkState(
      options.id ?? 'test-network',
      options.name ?? 'TestNet',
      options.nick ?? 'marmot',
    ),
    sent: [],
    effects: [],
  };
}

/**
 * A session already past registration, on a Libera-like server.
 *
 * Most tests care about what happens in a channel, not about getting there.
 */
export function registeredSession(options: { nick?: string; isupport?: string } = {}): Transcript {
  const nick = options.nick ?? 'marmot';
  const isupport =
    options.isupport ??
    'PREFIX=(qaohv)~&@%+ CHANMODES=beI,k,fl,imnpst CHANTYPES=# CASEMAPPING=rfc1459 NETWORK=TestNet';

  return feed(newSession({ nick }), [
    `:irc.test 001 ${nick} :Welcome`,
    `:irc.test 005 ${nick} ${isupport} :are supported by this server`,
    `:irc.test 376 ${nick} :End of /MOTD command.`,
  ]);
}

/** Reads a channel by name, whatever case the transcript used. */
export function channelOf(session: Transcript, name: string): ChannelState {
  const channel = session.state.channels.get(fold(name, session.state.support.caseMapping));
  if (channel === undefined) {
    throw new Error(`no channel called ${name}`);
  }
  return channel;
}

/** Reads a private conversation. */
export function queryOf(session: Transcript, name: string): ChannelState {
  const query = session.state.queries.get(fold(name, session.state.support.caseMapping));
  if (query === undefined) {
    throw new Error(`no conversation with ${name}`);
  }
  return query;
}

/** Member nicks in a channel, sorted for a stable comparison. */
export function memberNicks(session: Transcript, channel: string): string[] {
  return [...channelOf(session, channel).members.values()]
    .map((member) => member.nick)
    .sort((left, right) => left.localeCompare(right));
}

export function memberOf(session: Transcript, channel: string, nick: string): Member {
  const member = channelOf(session, channel).members.get(
    fold(nick, session.state.support.caseMapping),
  );
  if (member === undefined) {
    throw new Error(`${nick} is not in ${channel}`);
  }
  return member;
}

/** Message text in a channel, for asserting what the log shows. */
export function messageTexts(session: Transcript, channel: string): string[] {
  return channelOf(session, channel).messages.map((message) => message.text);
}
