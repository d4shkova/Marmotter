/**
 * The reducer: one parsed IRC message in, new network state plus lines to send
 * out.
 *
 * Pure and synchronous, which is what makes the acceptance harness possible —
 * a scripted transcript can be replayed through it and the final state
 * asserted, with no sockets, no timers, and no React.
 *
 * SASL is the one thing not handled here, because SCRAM needs WebCrypto and is
 * therefore async. The reducer reports that it should start and the session
 * layer drives it.
 */

import {
  DEFAULT_ISUPPORT,
  INITIAL_CAP_STATE,
  type IrcMessage,
  type ListKind,
  type Source,
  applyChannelModes,
  applyISupport,
  applyPrefixes,
  applyUserModes,
  beginNegotiation,
  DEFAULT_CTCP_POLICY,
  type CtcpMessage,
  type CtcpPolicy,
  ctcpReply,
  decodeAction,
  decodeCtcp,
  encodeCtcp,
  fold,
  handleCapMessage,
  interpretNumeric,
  RPL_WHOISUSER,
  RPL_LUSERCHANNELS,
  applyWhoisNumeric,
  emptyWhois,
  isChannel,
  parseChannelModes,
  isCtcp,
  parseDccSend,
  type DccSend,
  parseXdccAnnounce,
  type XdccPack,
  parseStandardReply,
  parseUserModes,
  sameTarget,
  type SuggestedAction,
} from '@marmotter/protocol';
import { completeHistoryBatch, historyAnchorTime } from './history.js';
import { type IgnoreChannel, findIgnore, hostmaskOf } from './ignore.js';
import { getMember, removeMember, renameMember, upsertMember } from './members.js';
import { derivedId, insertMessage, reconcileEcho, timestampOf } from './messages.js';
import {
  CHANNEL_LIST_LIMIT,
  type ChannelState,
  type IgnoreRule,
  type Member,
  type Message,
  type MessageKind,
  type NetworkState,
  type NotifyEntry,
  emptyChannel,
  emptyDirectory,
} from './types.js';

/** Everything the reducer needs that is not in the state itself. */
export interface ReduceContext {
  /** Nicks to try, in order, when the preferred one is refused. */
  readonly altNicks: readonly string[];
  /** Whether the profile is configured to authenticate. */
  readonly wantsSasl: boolean;
  /**
   * Which automatic CTCP answers are switched on.
   *
   * Omitted means the defaults. Passed through the context rather than read
   * from state because it is a preference, not something the network told us.
   */
  readonly ctcp?: CtcpPolicy;
  /** Injected so tests are deterministic. */
  readonly now?: () => Date;
}

export type Effect =
  /** Begin SASL. The session layer owns the mechanism. */
  | { readonly kind: 'start-sasl' }
  /** Registration finished; the session may send autojoins. */
  | { readonly kind: 'registered' }
  /** A capability went away; features relying on it must stop. */
  | { readonly kind: 'capabilities-lost'; readonly capabilities: readonly string[] }
  /**
   * The network refused something that was asked of a channel — a join, or a
   * setting.
   *
   * Raised as well as written to the server tab, because the server tab is not
   * where somebody who clicked Join is looking. Carries the copy rather than
   * the numeric: what to do about it is a question about the sentence, not
   * about the number behind it.
   */
  | {
      readonly kind: 'channel-error';
      readonly channel: string;
      readonly message: string;
      readonly action: SuggestedAction;
    }
  /**
   * Somebody advertised a file over DCC. The session raises it to the file
   * monitor, which the user has to have switched on; nothing is fetched here.
   */
  | {
      readonly kind: 'dcc-offer';
      readonly from: string;
      readonly target: string;
      readonly send: DccSend;
    }
  /**
   * A bot advertised a file over XDCC in a channel. Raised so the file monitor
   * can list it; nothing is requested until the user asks.
   */
  | {
      readonly kind: 'xdcc-offer';
      readonly from: string;
      readonly target: string;
      readonly pack: XdccPack;
    };

export interface ReduceResult {
  readonly state: NetworkState;
  readonly send: readonly string[];
  readonly effects: readonly Effect[];
}

export function initialNetworkState(id: string, name: string, nick: string): NetworkState {
  return {
    id,
    name,
    phase: 'disconnected',
    lastClose: undefined,
    nick,
    triedNicks: [],
    userModes: new Set(),
    account: undefined,
    away: false,
    support: DEFAULT_ISUPPORT,
    caps: INITIAL_CAP_STATE,
    serverName: '',
    registeredAt: undefined,
    channelCount: undefined,
    motd: [],
    serverNotices: [],
    channels: new Map(),
    queries: new Map(),
    notify: new Map(),
    whois: new Map(),
    ignores: [],
    batches: new Map(),
    rawLog: [],
    directory: emptyDirectory(),
    invites: [],
    ctcpVersions: new Map(),
  };
}

/** The opening burst: capability negotiation, then identification. */
export function startRegistration(
  state: NetworkState,
  identity: { nick: string; username: string; realname: string },
): ReduceResult {
  const { state: caps, line } = beginNegotiation(state.caps);

  return {
    state: {
      ...state,
      phase: 'registering',
      caps,
      nick: identity.nick,
      triedNicks: [identity.nick],
    },
    send: [line, `NICK ${identity.nick}`, `USER ${identity.username} 0 * :${identity.realname}`],
    effects: [],
  };
}

/** A CTCP request named for what it asks, never as a raw token. */
function describeCtcp(ctcp: CtcpMessage): string {
  switch (ctcp.command) {
    case 'VERSION':
      return 'what client you use';
    case 'PING':
      return 'a round-trip time';
    case 'TIME':
      return 'your clock';
    case 'CLIENTINFO':
      return 'what your client supports';
    case 'SOURCE':
      return 'where your client comes from';
    case 'USERINFO':
      return 'your user information';
    case 'FINGER':
      return 'your idle time';
    default:
      // Named rather than described, because there is nothing to describe. The
      // decoder covers the ones worth knowing about.
      return `an automated request (${ctcp.command})`;
  }
}

/** Splits a reply body back into the command and parameters `encodeCtcp` takes. */
function splitReply(reply: string): [string, string] {
  const space = reply.indexOf(' ');
  return space === -1 ? [reply, ''] : [reply.slice(0, space), reply.slice(space + 1)];
}

/**
 * Errors that are about one channel, rather than about the connection.
 *
 * These are the ones worth raising to the interface as they happen: each is a
 * refusal of something the user just asked for — a join, a setting, a message
 * to a channel — and each has an answer the person can act on. Anything else
 * stays in the server tab, where an error nobody asked for belongs.
 */
const CHANNEL_ERRORS: ReadonlySet<string> = new Set([
  '403', // No such channel
  '404', // Cannot send to channel
  '405', // Too many channels
  '471', // Channel is full
  '473', // Invite only
  '474', // Banned
  '475', // Wrong password
  '476', // Bad channel name
  '477', // Needs an account
  '478', // Ban list full
  '482', // Not an operator here
]);

const noEffects: readonly Effect[] = [];

const result = (
  state: NetworkState,
  send: readonly string[] = [],
  effects: readonly Effect[] = noEffects,
): ReduceResult => ({ state, send, effects });

/** Whether a target names us. */
const isSelf = (state: NetworkState, nick: string): boolean =>
  sameTarget(nick, state.nick, state.support.caseMapping);

/**
 * Whether a `NOTICE` came from the server itself rather than from a person.
 *
 * This matters more than it looks. A server's connection banner — "Looking up
 * your hostname", the ban notice, the "you are connecting from" line — arrives
 * as a `NOTICE`, and filing it as conversation puts a row in the sidebar named
 * after the server. Before registration those notices are addressed to `*`,
 * which produces a second row called `*`. Three sidebar entries for one
 * network, two of which cannot be talked to.
 *
 * The protocol gives no syntax that distinguishes a server name from a nick, so
 * this reads what a server prefix actually looks like: no `!user@host` part,
 * and a name containing a dot, which no ircd permits in a nick. A notice
 * addressed to `*` is pre-registration by definition and never conversation.
 */
const isServerNotice = (source: Source | undefined, target: string): boolean =>
  target === '*' ||
  source === undefined ||
  (source.user === '' && source.host === '' && source.nick.includes('.'));

/** Reads a channel or query, creating it if absent. */
const conversationOf = (
  state: NetworkState,
  target: string,
): { channel: ChannelState; isChannelTarget: boolean } => {
  const key = fold(target, state.support.caseMapping);
  const isChannelTarget = isChannel(target, state.support);
  const existing = isChannelTarget ? state.channels.get(key) : state.queries.get(key);
  return { channel: existing ?? emptyChannel(target), isChannelTarget };
};

/** Writes a channel or query back. */
const withConversation = (
  state: NetworkState,
  target: string,
  channel: ChannelState,
): NetworkState => {
  const key = fold(target, state.support.caseMapping);
  if (isChannel(target, state.support)) {
    const channels = new Map(state.channels);
    channels.set(key, channel);
    return { ...state, channels };
  }
  const queries = new Map(state.queries);
  queries.set(key, channel);
  return { ...state, queries };
};

/** Adds a message to a conversation. */
const addMessage = (state: NetworkState, target: string, message: Message): NetworkState => {
  const { channel } = conversationOf(state, target);
  return withConversation(state, target, {
    ...channel,
    messages: insertMessage(channel.messages, message),
  });
};

/** Adds the same event message to every channel a person is in. */
const addToChannelsWith = (
  state: NetworkState,
  nick: string,
  build: (channel: ChannelState) => Message,
  amend: (channel: ChannelState) => ChannelState,
): NetworkState => {
  const mapping = state.support.caseMapping;
  const channels = new Map(state.channels);
  let changed = false;

  for (const [key, channel] of state.channels) {
    if (getMember(channel.members, nick, mapping) === undefined) {
      continue;
    }
    const amended = amend(channel);
    channels.set(key, {
      ...amended,
      messages: insertMessage(amended.messages, build(channel)),
    });
    changed = true;
  }

  return changed ? { ...state, channels } : state;
};

interface MessageInit {
  readonly kind: MessageKind;
  readonly target: string;
  readonly text: string;
  readonly source?: Source | undefined;
}

/** Builds a message from a raw IRC message plus what the caller knows. */
const buildMessage = (msg: IrcMessage, init: MessageInit, now: () => Date): Message => {
  const { at, fromServerTime } = timestampOf(msg.tags, now);
  const provided = msg.tags.get('msgid');
  const account = msg.tags.get('account');
  const replyTo = msg.tags.get('+draft/reply');

  const base = {
    kind: init.kind,
    at,
    fromServerTime,
    source: init.source ?? msg.source,
    target: init.target,
    text: init.text,
    account: account === undefined || account === '*' ? undefined : account,
    replyTo,
    pending: false,
    tags: msg.tags,
  };

  return {
    ...base,
    id: provided !== undefined && provided !== '' ? provided : derivedId(base),
  };
};

/** Batch types that carry server-side scrollback, draft prefix included. */
const HISTORY_BATCH_TYPES: ReadonlySet<string> = new Set(['chathistory', 'draft/chathistory']);

/**
 * Records a message against the batch it belongs to.
 *
 * The reducer sees one message at a time, so what a batch contained has to be
 * accumulated as it streams. Timestamps are tracked because gap detection needs
 * to know where the returned page sits relative to the live buffer.
 */
function recordBatched(state: NetworkState, msg: IrcMessage, now: () => Date): NetworkState {
  const reference = msg.tags.get('batch');
  if (reference === undefined) {
    return state;
  }
  const batch = state.batches.get(reference);
  if (batch === undefined) {
    // A batch tag naming a batch we never saw open: losing the grouping is
    // better than losing the message, so it falls through untouched.
    return state;
  }

  const { at } = timestampOf(msg.tags, now);
  const batches = new Map(state.batches);
  batches.set(reference, {
    ...batch,
    count: batch.count + 1,
    oldest: batch.oldest === undefined || at < batch.oldest ? at : batch.oldest,
    newest: batch.newest === undefined || at > batch.newest ? at : batch.newest,
  });
  return { ...state, batches };
}

/** Opens or closes a batch, and applies what a history batch turned out to be. */
function handleBatch(state: NetworkState, msg: IrcMessage): ReduceResult {
  const target = msg.params[0] ?? '';
  const sign = target[0];
  const reference = target.slice(1);

  if (reference === '') {
    return result(state); // Malformed; nothing to correlate against.
  }

  if (sign === '+') {
    const type = msg.params[1] ?? '';
    const params = msg.params.slice(2);
    const batches = new Map(state.batches);

    let liveOldest: Date | undefined;
    if (HISTORY_BATCH_TYPES.has(type)) {
      const conversationTarget = params[0] ?? '';
      const key = fold(conversationTarget, state.support.caseMapping);
      const channel = state.channels.get(key) ?? state.queries.get(key);
      // Recorded now because once history is inserted the two are
      // indistinguishable.
      liveOldest = channel === undefined ? undefined : historyAnchorTime(channel);
    }

    batches.set(reference, {
      reference,
      type,
      params,
      parent: msg.tags.get('batch'),
      count: 0,
      oldest: undefined,
      newest: undefined,
      liveOldest,
    });
    return result({ ...state, batches });
  }

  if (sign === '-') {
    const batch = state.batches.get(reference);
    if (batch === undefined) {
      return result(state); // Closing a batch we never opened.
    }
    const batches = new Map(state.batches);
    batches.delete(reference);

    const closed: NetworkState = { ...state, batches };
    if (!HISTORY_BATCH_TYPES.has(batch.type)) {
      return result(closed);
    }
    return result(completeHistoryBatch(closed, batch.params[0] ?? '', batch));
  }

  return result(state);
}

/**
 * Whether a message is suppressed by the mute list.
 *
 * Suppression happens here, before the message reaches a buffer, so an ignored
 * person leaves no trace at all — and nothing is sent, so they cannot tell.
 */
function suppressedBy(state: NetworkState, msg: IrcMessage, now: Date): IgnoreRule | undefined {
  if (state.ignores.length === 0) {
    return undefined;
  }

  const channel = IGNORE_CHANNEL_FOR.get(msg.command);
  if (channel === undefined) {
    return undefined;
  }

  const hostmask = hostmaskOf(msg.source);
  if (hostmask === undefined || isSelf(state, msg.source?.nick ?? '')) {
    return undefined;
  }

  // A CTCP is a PRIVMSG, but a person who muted someone's chatter has not
  // necessarily consented to answering their VERSION requests.
  const resolved = channel === 'messages' && isCtcp(msg.params[1] ?? '') ? 'ctcp' : channel;

  return findIgnore(state.ignores, {
    hostmask,
    channel: resolved,
    mapping: state.support.caseMapping,
    now,
  });
}

/** Which part of the mute list governs each command. */
const IGNORE_CHANNEL_FOR: ReadonlyMap<string, IgnoreChannel> = new Map<string, IgnoreChannel>([
  ['PRIVMSG', 'messages'],
  ['NOTICE', 'notices'],
  ['TAGMSG', 'messages'],
  ['INVITE', 'invites'],
  ['JOIN', 'events'],
  ['PART', 'events'],
  ['QUIT', 'events'],
  ['NICK', 'events'],
  ['MODE', 'events'],
]);

/**
 * Applies one message.
 *
 * Batch bookkeeping and the mute list run first, because both decide whether
 * the message reaches a buffer at all. Everything after that is the per-command
 * reduction.
 */
export function reduce(state: NetworkState, msg: IrcMessage, context: ReduceContext): ReduceResult {
  const now = context.now ?? (() => new Date());
  const counted = recordBatched(state, msg, now);

  if (msg.command === 'BATCH') {
    return handleBatch(counted, msg);
  }

  const muted = suppressedBy(counted, msg, now());
  if (muted === undefined) {
    return applyMessage(counted, msg, context);
  }

  // An event-scoped mute still has to keep the member list right: the person
  // really did leave, even though their departure is not shown. So the message
  // is applied in full and only the lines it wrote are taken back out.
  if (IGNORE_CHANNEL_FOR.get(msg.command) === 'events') {
    const applied = applyMessage(counted, msg, context);
    return { ...applied, state: keepingBuffers(counted, applied.state) };
  }

  return result(counted);
}

/**
 * The second state, with every message buffer taken from the first.
 *
 * Everything else — membership, modes, topic — is kept, which is what makes a
 * muted join both invisible and correct.
 */
function keepingBuffers(before: NetworkState, after: NetworkState): NetworkState {
  const restore = (
    previous: ReadonlyMap<string, ChannelState>,
    next: ReadonlyMap<string, ChannelState>,
  ): ReadonlyMap<string, ChannelState> => {
    const merged = new Map(next);
    for (const [key, channel] of next) {
      const original = previous.get(key);
      merged.set(key, { ...channel, messages: original?.messages ?? [] });
    }
    return merged;
  };

  return {
    ...after,
    channels: restore(before.channels, after.channels),
    queries: restore(before.queries, after.queries),
    serverNotices: before.serverNotices,
  };
}

function applyMessage(state: NetworkState, msg: IrcMessage, context: ReduceContext): ReduceResult {
  const now = context.now ?? (() => new Date());
  const mapping = state.support.caseMapping;

  switch (msg.command) {
    case 'PING':
      // Answered here rather than by the interface: a missed PONG is a dropped
      // connection, and nothing above should be able to forget.
      return result(state, [`PONG :${msg.params[0] ?? ''}`]);

    case 'PONG':
      return result(state);

    case 'ERROR': {
      // The server's parting message is usually the most direct account of why
      // a connection ended — "Closing Link: … (Banned)". Dropping it, as this
      // once did, throws away the one line that explains the disconnect.
      const text = msg.params[msg.params.length - 1] ?? '';
      return result({
        ...state,
        phase: 'disconnected',
        serverNotices:
          text === ''
            ? state.serverNotices
            : [...state.serverNotices, buildMessage(msg, { kind: 'error', target: '', text }, now)],
      });
    }

    case 'CAP': {
      const step = handleCapMessage(state.caps, msg, { wantsSasl: context.wantsSasl });
      const send: string[] = [];
      const effects: Effect[] = [];

      for (const action of step.actions) {
        switch (action.kind) {
          case 'request':
            send.push(`CAP REQ :${action.capabilities.join(' ')}`);
            break;
          case 'end':
            send.push('CAP END');
            break;
          case 'start-sasl':
            effects.push({ kind: 'start-sasl' });
            break;
          case 'lost':
            effects.push({ kind: 'capabilities-lost', capabilities: action.capabilities });
            break;
        }
      }

      return result({ ...state, caps: step.state }, send, effects);
    }

    case 'JOIN': {
      const channelName = msg.params[0] ?? '';
      const nick = msg.source?.nick ?? '';
      const { channel } = conversationOf(state, channelName);

      // extended-join carries the account and realname, which saves a WHO.
      const account = msg.params[1];
      const realname = msg.params[2];

      const members = upsertMember(channel.members, nick, mapping, {
        nick,
        user: msg.source?.user ?? '',
        host: msg.source?.host ?? '',
        ...(account === undefined ? {} : { account: account === '*' ? undefined : account }),
        ...(realname === undefined ? {} : { realname }),
      });

      const joinedSelf = isSelf(state, nick);
      const message = buildMessage(
        msg,
        {
          kind: 'join',
          target: channelName,
          text: `${nick} joined`,
        },
        now,
      );

      const next = withConversation(state, channelName, {
        ...channel,
        name: channelName,
        joined: joinedSelf ? true : channel.joined,
        members,
        messages: insertMessage(channel.messages, message),
      });

      // Walking in answers the invitation, however it was accepted — from the
      // notice, from the sidebar, or by typing `/join`. Leaving it on the list
      // would invite somebody into a room they are standing in.
      if (!joinedSelf) {
        return result(next);
      }
      const joinedKey = fold(channelName, mapping);
      return result({
        ...next,
        invites: next.invites.filter((invite) => fold(invite.channel, mapping) !== joinedKey),
      });
    }

    case 'PART': {
      const channelName = msg.params[0] ?? '';
      const nick = msg.source?.nick ?? '';
      const key = fold(channelName, mapping);
      const channel = state.channels.get(key);
      if (channel === undefined) {
        return result(state);
      }

      const message = buildMessage(
        msg,
        {
          kind: 'part',
          target: channelName,
          text: msg.params[1] ?? `${nick} left`,
        },
        now,
      );

      if (isSelf(state, nick)) {
        // Our own part: keep the buffer, drop the membership.
        const channels = new Map(state.channels);
        channels.set(key, {
          ...channel,
          joined: false,
          members: new Map(),
          messages: insertMessage(channel.messages, message),
        });
        return result({ ...state, channels });
      }

      const channels = new Map(state.channels);
      channels.set(key, {
        ...channel,
        members: removeMember(channel.members, nick, mapping),
        messages: insertMessage(channel.messages, message),
      });
      return result({ ...state, channels });
    }

    case 'QUIT': {
      const nick = msg.source?.nick ?? '';
      const reason = msg.params[0] ?? '';

      // A netsplit shows up as a mass QUIT whose reason is two server names.
      // The batch tag, where the server sends one, groups them; the interface
      // folds either way.
      const next = addToChannelsWith(
        state,
        nick,
        (channel) => buildMessage(msg, { kind: 'quit', target: channel.name, text: reason }, now),
        (channel) => ({ ...channel, members: removeMember(channel.members, nick, mapping) }),
      );
      return result(next);
    }

    case 'NICK': {
      const from = msg.source?.nick ?? '';
      const to = msg.params[0] ?? '';

      const renamed = addToChannelsWith(
        state,
        from,
        (channel) =>
          buildMessage(
            msg,
            {
              kind: 'nick',
              target: channel.name,
              text: `${from} is now known as ${to}`,
            },
            now,
          ),
        // The person is unchanged: prefixes, account, and away state all carry
        // over. Losing them here is why operators appear to be demoted by a
        // rename.
        (channel) => ({ ...channel, members: renameMember(channel.members, from, to, mapping) }),
      );

      return result(isSelf(state, from) ? { ...renamed, nick: to } : renamed);
    }

    case 'KICK': {
      const channelName = msg.params[0] ?? '';
      const victim = msg.params[1] ?? '';
      const key = fold(channelName, mapping);
      const channel = state.channels.get(key);
      if (channel === undefined) {
        return result(state);
      }

      const message = buildMessage(
        msg,
        {
          kind: 'kick',
          target: channelName,
          text: `${victim} was removed by ${msg.source?.nick ?? 'someone'}${
            msg.params[2] === undefined ? '' : `: ${msg.params[2]}`
          }`,
        },
        now,
      );

      const channels = new Map(state.channels);
      channels.set(key, {
        ...channel,
        joined: isSelf(state, victim) ? false : channel.joined,
        members: isSelf(state, victim) ? new Map() : removeMember(channel.members, victim, mapping),
        messages: insertMessage(channel.messages, message),
      });
      return result({ ...state, channels });
    }

    case 'MODE': {
      const target = msg.params[0] ?? '';

      if (!isChannel(target, state.support)) {
        const changes = parseUserModes(msg.params[1] ?? '');
        return result({ ...state, userModes: applyUserModes(state.userModes, changes) });
      }

      const key = fold(target, mapping);
      const channel = state.channels.get(key);
      if (channel === undefined) {
        return result(state);
      }

      const parsed = parseChannelModes(msg.params[1] ?? '', msg.params.slice(2), state.support);

      // Prefix changes land on members; everything else on the channel. A mode
      // change arriving while NAMES is still streaming still applies, because
      // members are upserted rather than replaced.
      let members = channel.members;
      for (const change of parsed.changes) {
        if (change.kind !== 'prefix' || change.parameter === undefined) {
          continue;
        }
        const existing = getMember(members, change.parameter, mapping);
        members = upsertMember(members, change.parameter, mapping, {
          prefixes: applyPrefixes(existing?.prefixes ?? '', [change], state.support),
        });
      }

      const message = buildMessage(
        msg,
        {
          kind: 'mode',
          target,
          text: [msg.params[1] ?? '', ...msg.params.slice(2)].join(' ').trim(),
        },
        now,
      );

      const prefixChanges = parsed.changes.filter((change) => change.kind === 'prefix');

      const channels = new Map(state.channels);
      channels.set(key, {
        ...channel,
        modes: applyChannelModes(channel.modes, parsed.changes),
        members,
        // Replayed when the burst ends; see ChannelState.pendingPrefixChanges.
        pendingPrefixChanges: channel.namesLoading
          ? [...channel.pendingPrefixChanges, ...prefixChanges]
          : channel.pendingPrefixChanges,
        messages: insertMessage(channel.messages, message),
      });
      return result({ ...state, channels });
    }

    case 'TOPIC': {
      const channelName = msg.params[0] ?? '';
      const key = fold(channelName, mapping);
      const channel = state.channels.get(key);
      if (channel === undefined) {
        return result(state);
      }

      const { at } = timestampOf(msg.tags, now);
      const text = msg.params[1] ?? '';
      const message = buildMessage(
        msg,
        {
          kind: 'topic',
          target: channelName,
          text: `${msg.source?.nick ?? 'someone'} changed the topic to: ${text}`,
        },
        now,
      );

      const channels = new Map(state.channels);
      channels.set(key, {
        ...channel,
        topic: { text, setBy: msg.source?.nick, at },
        messages: insertMessage(channel.messages, message),
      });
      return result({ ...state, channels });
    }

    case 'PRIVMSG':
    case 'NOTICE': {
      const target = msg.params[0] ?? '';
      const body = msg.params[1] ?? '';
      const sender = msg.source?.nick ?? '';

      // A private message is filed under the sender, not under our own nick.
      const conversation = isChannel(target, state.support)
        ? target
        : isSelf(state, target)
          ? sender
          : target;

      const action = decodeAction(body);

      // A CTCP request that is not an ACTION is not conversation, and CLAUDE.md
      // says so explicitly: answered automatically where configured, surfaced
      // as a quiet notice, never as a message in the channel. A CTCP *reply*
      // (which arrives as a NOTICE) is somebody answering us, and is a notice
      // in the same way.
      // Our own outgoing request comes back through `echo-message`, and
      // answering it would mean sending ourselves a reply to a question we
      // asked somebody else — visible spurious traffic, and a notice claiming
      // we had been asked something.
      const ctcp = action === undefined && !isSelf(state, sender) ? decodeCtcp(body) : undefined;
      if (ctcp !== undefined && sender !== '') {
        // A DCC SEND advertises a file rather than asking anything about us. It
        // is raised to the file monitor as an effect and shown as a plain-words
        // notice in the conversation. It is never auto-answered, and nothing is
        // fetched without the user clicking Download.
        if (msg.command === 'PRIVMSG' && ctcp.command === 'DCC') {
          const send = parseDccSend(ctcp);
          if (send !== undefined) {
            const notice = buildMessage(
              msg,
              {
                kind: 'server',
                target: conversation,
                text: send.passive
                  ? `${sender} offered you the file “${send.filename}”, but as a passive transfer Marmotter can't fetch it.`
                  : `${sender} offered you the file “${send.filename}”. Open the file monitor to download it.`,
              },
              now,
            );
            return result(
              { ...state, serverNotices: [...state.serverNotices, notice] },
              [],
              [{ kind: 'dcc-offer', from: sender, target: conversation, send }],
            );
          }
        }

        const policy = context.ctcp ?? DEFAULT_CTCP_POLICY;
        const answer = msg.command === 'PRIVMSG' ? ctcpReply(ctcp, policy, now()) : undefined;

        const notice = buildMessage(
          msg,
          {
            kind: 'server',
            target: conversation,
            text:
              msg.command === 'NOTICE'
                ? `${sender} answered: ${describeCtcp(ctcp)}`
                : answer === undefined
                  ? `${sender} asked for ${describeCtcp(ctcp)}. Marmotter did not answer.`
                  : `${sender} asked for ${describeCtcp(ctcp)}. Marmotter answered.`,
          },
          now,
        );

        // A version reply is the one piece of CTCP worth keeping: it is how the
        // account panel learns which services package this network runs, and
        // nothing in registration says.
        const versions =
          msg.command === 'NOTICE' && ctcp.command === 'VERSION' && ctcp.params !== ''
            ? new Map(state.ctcpVersions).set(fold(sender, mapping), ctcp.params)
            : state.ctcpVersions;

        return result(
          {
            ...state,
            serverNotices: [...state.serverNotices, notice],
            ctcpVersions: versions,
          },
          answer === undefined ? [] : [`NOTICE ${sender} :${encodeCtcp(...splitReply(answer))}`],
        );
      }

      // What the server says about the connection goes on the network's own
      // tab, which is where somebody looks for it, rather than becoming a
      // conversation with something that cannot answer.
      // A notice the server sends *to a channel* is another matter: it is
      // addressed to the room and belongs in it.
      if (
        msg.command === 'NOTICE' &&
        !isChannel(target, state.support) &&
        isServerNotice(msg.source, target)
      ) {
        return result({
          ...state,
          serverNotices: [
            ...state.serverNotices,
            buildMessage(msg, { kind: 'server', target: '', text: body }, now),
          ],
        });
      }

      const built = buildMessage(
        msg,
        {
          kind: msg.command === 'NOTICE' ? 'notice' : action === undefined ? 'privmsg' : 'action',
          target: conversation,
          text: action ?? body,
        },
        now,
      );

      // Our own message coming back through echo-message.
      if (isSelf(state, sender)) {
        const { channel } = conversationOf(state, conversation);
        return result(
          withConversation(state, conversation, {
            ...channel,
            name: conversation,
            messages: reconcileEcho(channel.messages, built),
          }),
        );
      }

      // A message from a bot may be an XDCC catalogue line. It stays in the
      // conversation as ordinary text — hiding a packlist channel's own content
      // would be surprising — and is also raised to the file monitor, which the
      // user has to have switched on for anything to be collected.
      //
      // Both PRIVMSG and NOTICE count: serving bots spam packs to a channel and
      // answer `!list`/`@find` in private, and either can arrive as a NOTICE.
      // The conversation it lands in — channel or the bot's own query — is what
      // is reported, so the browser can group by where it came from.
      const effects: Effect[] = [];
      if (action === undefined) {
        const pack = parseXdccAnnounce(body);
        if (pack !== undefined) {
          effects.push({ kind: 'xdcc-offer', from: sender, target: conversation, pack });
        }
      }

      return result(addMessage(state, conversation, built), [], effects);
    }

    case 'TAGMSG':
      // Reactions and typing notifications carry no body. Phase 5 renders them;
      // the buffer does not need a line for one.
      return result(state);

    case 'INVITE': {
      const channelName = msg.params[1] ?? '';
      const from = msg.source?.nick ?? 'Someone';
      const message = buildMessage(
        msg,
        {
          kind: 'invite',
          target: channelName,
          text: `${from} invited you to ${channelName}`,
        },
        now,
      );

      // `invite-notify` also reports invitations sent to *other* people, which
      // are somebody else's business. Only one addressed to us is actionable.
      const forUs = sameTarget(msg.params[0] ?? '', state.nick, mapping);
      const key = fold(channelName, state.support.caseMapping);
      const already = state.invites.some(
        (invite) => fold(invite.channel, state.support.caseMapping) === key,
      );

      return result({
        ...state,
        serverNotices: [...state.serverNotices, message],
        invites:
          forUs && !already && channelName !== ''
            ? [...state.invites, { channel: channelName, from, at: now() }]
            : state.invites,
      });
    }

    case 'AWAY': {
      const nick = msg.source?.nick ?? '';
      const away = (msg.params[0] ?? '') !== '';
      const channels = new Map(state.channels);
      for (const [key, channel] of state.channels) {
        if (getMember(channel.members, nick, mapping) === undefined) {
          continue;
        }
        channels.set(key, {
          ...channel,
          members: upsertMember(channel.members, nick, mapping, { away }),
        });
      }
      return result({
        ...state,
        channels,
        away: isSelf(state, nick) ? away : state.away,
      });
    }

    case 'ACCOUNT': {
      const nick = msg.source?.nick ?? '';
      const account = msg.params[0] ?? '*';
      const resolved = account === '*' ? undefined : account;

      const channels = new Map(state.channels);
      for (const [key, channel] of state.channels) {
        if (getMember(channel.members, nick, mapping) === undefined) {
          continue;
        }
        channels.set(key, {
          ...channel,
          members: upsertMember(channel.members, nick, mapping, { account: resolved }),
        });
      }
      return result({
        ...state,
        channels,
        account: isSelf(state, nick) ? resolved : state.account,
      });
    }

    case 'CHGHOST': {
      const nick = msg.source?.nick ?? '';
      const user = msg.params[0] ?? '';
      const host = msg.params[1] ?? '';

      const channels = new Map(state.channels);
      for (const [key, channel] of state.channels) {
        if (getMember(channel.members, nick, mapping) === undefined) {
          continue;
        }
        channels.set(key, {
          ...channel,
          members: upsertMember(channel.members, nick, mapping, { user, host }),
        });
      }
      return result({ ...state, channels });
    }

    case 'SETNAME': {
      const nick = msg.source?.nick ?? '';
      const realname = msg.params[0] ?? '';

      const channels = new Map(state.channels);
      for (const [key, channel] of state.channels) {
        if (getMember(channel.members, nick, mapping) === undefined) {
          continue;
        }
        channels.set(key, {
          ...channel,
          members: upsertMember(channel.members, nick, mapping, { realname }),
        });
      }
      return result({ ...state, channels });
    }

    case 'FAIL':
    case 'WARN':
    case 'NOTE': {
      const reply = parseStandardReply(msg);
      if (reply === undefined) {
        return result(state);
      }
      const message = buildMessage(
        msg,
        {
          kind: reply.severity === 'fail' ? 'error' : 'server',
          target: '',
          text: reply.description,
        },
        now,
      );
      return result({ ...state, serverNotices: [...state.serverNotices, message] });
    }

    default:
      return /^\d{3}$/.test(msg.command) ? reduceNumeric(state, msg, context, now) : result(state);
  }
}

/** Numerics, via the typed events from `packages/protocol`. */
function reduceNumeric(
  state: NetworkState,
  msg: IrcMessage,
  context: ReduceContext,
  now: () => Date,
): ReduceResult {
  const event = interpretNumeric(msg, state.support);
  const mapping = state.support.caseMapping;

  switch (event.kind) {
    case 'welcome':
      return result({
        ...state,
        phase: 'registered',
        nick: event.nick,
        registeredAt: now(),
        serverName: msg.source?.nick ?? state.serverName,
      });

    case 'isupport':
      return result({ ...state, support: applyISupport(state.support, event.tokens) });

    case 'my-info':
      return result({ ...state, serverName: event.server });

    case 'server-info': {
      // `254` carries the channel count as a parameter of its own, which is
      // worth keeping rather than only rendering: it is what lets the interface
      // say how big a channel list will be before asking for one.
      const counted = msg.command === RPL_LUSERCHANNELS ? Number(msg.params[1]) : Number.NaN;
      return result({
        ...state,
        ...(Number.isInteger(counted) ? { channelCount: counted } : {}),
        serverNotices: [
          ...state.serverNotices,
          buildMessage(msg, { kind: 'server', target: '', text: event.text }, now),
        ],
      });
    }

    case 'motd-start':
      return result({ ...state, motd: [event.text] });
    case 'motd-line':
      return result({ ...state, motd: [...state.motd, event.text] });
    case 'motd-end':
    case 'no-motd':
      // Registration is complete once the MOTD ends, whether there was one or
      // not. Autojoins wait for this.
      //
      // The end marker is not part of the MOTD: it is the server saying the
      // message finished, and putting "End of /MOTD command." inside the
      // collapsed item would be showing the user a protocol detail.
      return {
        state: { ...state, phase: 'registered' },
        send: [],
        effects: [{ kind: 'registered' }],
      };

    case 'topic': {
      const { channel } = conversationOf(state, event.channel);
      return result(
        withConversation(state, event.channel, {
          ...channel,
          name: event.channel,
          topic: { text: event.topic, setBy: channel.topic?.setBy, at: channel.topic?.at },
        }),
      );
    }

    case 'topic-set-by': {
      const { channel } = conversationOf(state, event.channel);
      return result(
        withConversation(state, event.channel, {
          ...channel,
          name: event.channel,
          topic: { text: channel.topic?.text ?? '', setBy: event.setBy, at: event.at },
        }),
      );
    }

    case 'no-topic': {
      const { channel } = conversationOf(state, event.channel);
      return result(
        withConversation(state, event.channel, {
          ...channel,
          name: event.channel,
          topic: undefined,
        }),
      );
    }

    case 'names': {
      const { channel } = conversationOf(state, event.channel);
      // A fresh burst replaces the list; a continuation adds to it.
      let members: ReadonlyMap<string, Member> = channel.namesLoading
        ? channel.members
        : new Map<string, Member>();

      for (const entry of event.members) {
        members = upsertMember(members, entry.nick, mapping, {
          nick: entry.nick,
          prefixes: entry.prefixes,
        });
      }

      return result(
        withConversation(state, event.channel, {
          ...channel,
          name: event.channel,
          namesLoading: true,
          members,
        }),
      );
    }

    case 'names-end': {
      const { channel } = conversationOf(state, event.channel);

      // The burst has just overwritten prefixes with its own snapshot. Any mode
      // that arrived while it was streaming is newer, so it is applied last.
      let members = channel.members;
      for (const change of channel.pendingPrefixChanges) {
        if (change.parameter === undefined) {
          continue;
        }
        const existing = getMember(members, change.parameter, mapping);
        members = upsertMember(members, change.parameter, mapping, {
          prefixes: applyPrefixes(existing?.prefixes ?? '', [change], state.support),
        });
      }

      return result(
        withConversation(state, event.channel, {
          ...channel,
          name: event.channel,
          namesLoading: false,
          pendingPrefixChanges: [],
          members,
        }),
      );
    }

    case 'who-reply': {
      const details: Partial<Member> = {
        nick: event.nick,
        user: event.username,
        host: event.host,
        away: event.away,
        bot: event.bot,
        realname: event.realname,
        ...(event.prefixes === '' ? {} : { prefixes: event.prefixes }),
      };

      const key = fold(event.channel, mapping);
      const named = state.channels.get(key);
      if (named !== undefined) {
        const channels = new Map(state.channels);
        channels.set(key, {
          ...named,
          members: upsertMember(named.members, event.nick, mapping, details),
        });
        return result({ ...state, channels });
      }

      // A WHO on a nick rather than a channel reports `*` as the channel, and a
      // WHO on a channel we are not in tells us nothing about a member list we
      // do not have. Either way, creating a channel from it would invent one.
      const channels = new Map(state.channels);
      let changed = false;
      for (const [channelKey, channel] of state.channels) {
        if (getMember(channel.members, event.nick, mapping) === undefined) {
          continue;
        }
        channels.set(channelKey, {
          ...channel,
          members: upsertMember(channel.members, event.nick, mapping, details),
        });
        changed = true;
      }
      return result(changed ? { ...state, channels } : state);
    }

    case 'channel-modes': {
      const { channel } = conversationOf(state, event.channel);
      const parsed = parseChannelModes(event.modeString, event.params, state.support);
      return result(
        withConversation(state, event.channel, {
          ...channel,
          name: event.channel,
          modes: applyChannelModes(channel.modes, parsed.changes),
        }),
      );
    }

    case 'channel-created': {
      const { channel } = conversationOf(state, event.channel);
      return result(
        withConversation(state, event.channel, {
          ...channel,
          name: event.channel,
          created: event.at,
        }),
      );
    }

    case 'list-entry': {
      const { channel } = conversationOf(state, event.channel);
      const list: ListKind = event.list;
      const loading = new Set(channel.listsLoading);
      loading.add(list);

      return result(
        withConversation(state, event.channel, {
          ...channel,
          name: event.channel,
          listsLoading: loading,
          lists: {
            ...channel.lists,
            [list]: [
              ...channel.lists[list],
              { mask: event.mask, setBy: event.setBy, at: event.at },
            ],
          },
        }),
      );
    }

    case 'list-end': {
      const { channel } = conversationOf(state, event.channel);
      const loading = new Set(channel.listsLoading);
      loading.delete(event.list);
      return result(
        withConversation(state, event.channel, {
          ...channel,
          name: event.channel,
          listsLoading: loading,
        }),
      );
    }

    // The public channel list. Not every server sends the start numeric, so
    // the first row opens the listing as well — otherwise a network that goes
    // straight to 322 would fill a directory nobody had marked as loading.
    case 'channel-list-start':
      return result({
        ...state,
        directory: { entries: [], loading: true, complete: false, truncated: false },
      });

    case 'channel-list-entry': {
      const directory = state.directory.complete
        ? { entries: [], loading: true, complete: false, truncated: false }
        : state.directory;

      if (directory.entries.length >= CHANNEL_LIST_LIMIT) {
        return result({ ...state, directory: { ...directory, loading: true, truncated: true } });
      }

      return result({
        ...state,
        directory: {
          ...directory,
          loading: true,
          entries: [
            ...directory.entries,
            { channel: event.channel, members: event.members, topic: event.topic },
          ],
        },
      });
    }

    case 'channel-list-end':
      return result({
        ...state,
        directory: { ...state.directory, loading: false, complete: true },
      });

    case 'away-state':
      return result({ ...state, away: event.away });

    case 'sasl-success':
      return result({ ...state, account: event.account ?? state.account });

    case 'logged-out':
      return result({ ...state, account: undefined });

    case 'monitor': {
      const notify = new Map(state.notify);
      for (const target of event.targets) {
        // Targets arrive as a full mask on some networks and a bare nick on
        // others; only the nick is the identity.
        const nick = target.split('!')[0] ?? target;
        if (nick === '') {
          continue;
        }
        const key = fold(nick, mapping);
        const existing = state.notify.get(key);
        notify.set(key, {
          // Keep the spelling the user chose, not whichever the server sent.
          nick: existing?.nick ?? nick,
          online: event.online,
          known: true,
        });
      }
      return result({ ...state, notify });
    }

    case 'monitor-list': {
      // The server's copy of the list is authoritative for membership, but says
      // nothing about who is online, so nobody's state is invented here.
      const notify = new Map<string, NotifyEntry>();
      for (const target of event.targets) {
        const nick = target.split('!')[0] ?? target;
        if (nick === '') {
          continue;
        }
        const key = fold(nick, mapping);
        notify.set(key, state.notify.get(key) ?? { nick, online: false, known: false });
      }
      return result({ ...state, notify });
    }

    case 'monitor-removed': {
      const notify = new Map(state.notify);
      for (const target of event.targets) {
        notify.delete(fold(target.split('!')[0] ?? target, mapping));
      }
      return result({ ...state, notify });
    }

    case 'whois': {
      // 311 is always the first line of a WHOIS, so it starts a fresh profile —
      // a repeated lookup then never shows a field left over from the last one.
      // Every later line folds into whatever is being built.
      const key = fold(event.nick, mapping);
      const base =
        event.numeric === RPL_WHOISUSER
          ? emptyWhois(event.nick)
          : (state.whois.get(key) ?? emptyWhois(event.nick));
      const whois = new Map(state.whois);
      whois.set(key, applyWhoisNumeric(base, event.numeric, event.params));
      return result({ ...state, whois });
    }

    case 'whois-end': {
      const key = fold(event.nick, mapping);
      const existing = state.whois.get(key);
      if (existing === undefined) {
        return result(state);
      }
      const whois = new Map(state.whois);
      whois.set(key, { ...existing, complete: true });
      return result({ ...state, whois });
    }

    case 'away': {
      // During a WHOIS the away message arrives as its own numeric (301). It is
      // attached to the profile being built; a bare 301 — the kind sent when you
      // message someone who is away — has no profile in flight and is left be.
      const key = fold(event.nick, mapping);
      const existing = state.whois.get(key);
      if (existing === undefined || existing.complete) {
        return result(state);
      }
      const whois = new Map(state.whois);
      whois.set(key, { ...existing, away: event.reason });
      return result({ ...state, whois });
    }

    case 'error': {
      // Nick collision during registration: work down the alternatives, then
      // start appending underscores. Surfaced as a quiet notice, never a modal,
      // and never silently.
      if (state.phase === 'registering' && ['433', '436', '437', '432'].includes(event.numeric)) {
        const next = nextNick(state, context.altNicks);
        return {
          state: {
            ...state,
            nick: next,
            triedNicks: [...state.triedNicks, next],
            serverNotices: [
              ...state.serverNotices,
              buildMessage(
                msg,
                {
                  kind: 'server',
                  target: '',
                  text: `${event.report.message} Trying ${next}.`,
                },
                now,
              ),
            ],
          },
          send: [`NICK ${next}`],
          effects: [],
        };
      }

      // An error about a channel is raised as well as written down. The server
      // tab is where the line belongs; it is not where somebody who has just
      // clicked Join is looking, and a join that fails silently reads as a
      // client that ignored them.
      const subject = event.params[1] ?? '';
      const channelError: readonly Effect[] =
        CHANNEL_ERRORS.has(event.numeric) && isChannel(subject, state.support)
          ? [
              {
                kind: 'channel-error',
                channel: subject,
                message: event.report.message,
                action: event.report.action,
              },
            ]
          : [];

      return result(
        {
          ...state,
          serverNotices: [
            ...state.serverNotices,
            buildMessage(msg, { kind: 'error', target: '', text: event.report.message }, now),
          ],
        },
        [],
        channelError,
      );
    }

    default:
      return result(state);
  }
}

/**
 * The next nick to try.
 *
 * Works through the profile's alternatives first, then appends underscores. The
 * result is never one already refused this registration.
 */
export function nextNick(state: NetworkState, altNicks: readonly string[]): string {
  const mapping = state.support.caseMapping;
  const tried = new Set(state.triedNicks.map((nick) => fold(nick, mapping)));

  for (const candidate of altNicks) {
    if (!tried.has(fold(candidate, mapping))) {
      return candidate;
    }
  }

  let candidate = `${state.nick}_`;
  const limit = state.support.maxNickLength ?? 30;
  while (tried.has(fold(candidate, mapping))) {
    candidate = `${candidate}_`;
  }
  // Truncate rather than send a nick the server will refuse for length.
  return candidate.length > limit ? candidate.slice(0, limit) : candidate;
}
