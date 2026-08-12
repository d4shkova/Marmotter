/**
 * A session: one network profile, one transport, one reduced state.
 *
 * The reducer is pure and synchronous, which is what makes it testable — but a
 * real connection is neither. This is where the two meet. Everything async
 * lives here: the socket, the SASL exchange, the optimistic send that has to be
 * reconciled later.
 *
 * SASL is the reason this layer exists at all. SCRAM-SHA-256 derives keys with
 * WebCrypto, which is a promise, and a promise cannot live inside a pure
 * reducer. So the reducer says "start SASL" and this drives the exchange,
 * feeding each `AUTHENTICATE` back through as it resolves.
 */

import {
  AuthenticateReassembler,
  type CryptoProvider,
  type DccSend,
  type XdccPack,
  type IrcMessage,
  type SaslMechanism,
  type SaslMechanismName,
  DEFAULT_CTCP_POLICY,
  type CtcpPolicy,
  createMechanism,
  encodeAction,
  fold,
  isChannel,
  makeSource,
  parseMechanisms,
  parseMessage,
  selectMechanism,
  webCryptoProvider,
} from '@marmotter/protocol';
import type {
  CloseReason,
  NetworkProfile,
  SecretRef,
  Transport,
  Unsubscribe,
} from '@marmotter/shared';
import { type Keepalive, createKeepalive } from './keepalive.js';
import { Listeners } from './transport/listeners.js';
import { connectErrorReason } from './transport/connect-error.js';
import type { ReconnectingTransport } from './transport/reconnecting.js';
import { type AddIgnoreOptions, addIgnore, pruneIgnores, removeIgnore } from './state/ignore.js';
import { backfillJoinedChannels, requestOlder } from './state/history.js';
import {
  POLL_INTERVAL_MS,
  addToNotify,
  notifyMechanism,
  pollTargets,
  removeFromNotify,
  resyncNotify,
} from './state/notify.js';
import { derivedId, insertMessage } from './state/messages.js';
import {
  type Effect,
  type ReduceContext,
  initialNetworkState,
  reduce,
  startRegistration,
} from './state/reduce.js';
import {
  type Message,
  type NetworkState,
  RAW_LOG_LIMIT,
  emptyChannel,
  emptyDirectory,
} from './state/types.js';

/** Resolves a secret handle to the secret itself, or undefined if it is gone. */
export type SecretResolver = (ref: SecretRef) => Promise<string | undefined>;

export interface SessionOptions {
  readonly profile: NetworkProfile;
  /** Already built for this profile's endpoints. The session never picks one. */
  readonly transport: Transport | ReconnectingTransport;
  /**
   * Reads secrets from the platform's store.
   *
   * Omitted on a profile with no authentication. A profile that needs one and
   * has none fails authentication rather than sending an empty password.
   */
  readonly resolveSecret?: SecretResolver;
  /** WebCrypto, for SCRAM. Defaults to the platform's when it has one. */
  readonly crypto?: CryptoProvider;
  readonly now?: () => Date;
  /** Messages per history request. Clamped to what the server allows. */
  readonly historyPageSize?: number;
  /** Which automatic CTCP answers are switched on. Defaults to all of them. */
  readonly ctcp?: CtcpPolicy;
  /**
   * How long the connection may be silent before the session checks it is alive.
   *
   * Zero switches the check off, which is what a test driving a scripted
   * transcript wants — there is no socket there to go half-open.
   */
  readonly keepaliveIdleMs?: number;
  /** How long to wait for any answer before calling the connection dead. */
  readonly keepaliveTimeoutMs?: number;
}

/** Something the session did that the interface may want to react to. */
export type SessionEvent =
  | { readonly kind: 'state'; readonly state: NetworkState }
  | { readonly kind: 'connected' }
  | { readonly kind: 'registered' }
  | { readonly kind: 'closed'; readonly reason: CloseReason }
  /** Authentication failed. The connection continues, unauthenticated. */
  | { readonly kind: 'auth-failed'; readonly reason: string }
  /**
   * Somebody advertised a file over DCC. Raised so the file monitor can list
   * it; nothing is fetched until the user asks. `target` is the conversation it
   * arrived in — a channel, or the sender for a private message.
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

export interface Session {
  readonly id: string;
  readonly state: NetworkState;
  subscribe(callback: (state: NetworkState) => void): Unsubscribe;
  on(callback: (event: SessionEvent) => void): Unsubscribe;

  connect(): Promise<void>;
  disconnect(reason?: string): void;

  /** Sends a raw line, as `/quote` does. */
  send(line: string): void;
  /** Sends a message, rendered immediately and reconciled against the echo. */
  sendMessage(target: string, text: string): void;
  sendAction(target: string, text: string): void;

  join(target: string, key?: string): void;
  part(target: string, reason?: string): void;
  /**
   * Stops showing a private conversation.
   *
   * Local only. There is no leaving a private conversation on IRC — the person
   * is not in a room with you — so this forgets what was said and nothing is
   * sent. A new message from them opens it again.
   */
  closeQuery(target: string): void;
  /**
   * Asks the network for its public channel list.
   *
   * The pattern is passed through as the server understands it; every ircd
   * spells the filter differently, so the browser narrows what came back
   * rather than relying on the server to.
   */
  listChannels(pattern?: string): void;

  /** Loads the page before what is shown, for scrolling upward. */
  loadOlder(target: string): void;

  /**
   * Marks us away, or back when given nothing.
   *
   * The server's own reply is what moves the state; this only asks.
   */
  setAway(message?: string): void;
  /** Invites somebody into a channel. */
  invite(nick: string, target: string): void;
  /** Forgets an invitation without joining. Purely local — IRC has no decline. */
  dismissInvite(channel: string): void;
  /**
   * Changes which automatic CTCP answers are switched on.
   *
   * Live rather than fixed at construction: somebody who turns off answering
   * VERSION expects it to stop answering now, not at the next reconnect.
   */
  setCtcpPolicy(policy: CtcpPolicy): void;

  addIgnore(mask: string, options?: AddIgnoreOptions): void;
  removeIgnore(mask: string): void;
  addNotify(nicks: readonly string[]): readonly string[];
  removeNotify(nicks: readonly string[]): void;

  /** Releases every listener. The transport is disconnected too. */
  destroy(): void;
}

const MECHANISM_FOR: ReadonlyMap<string, SaslMechanismName> = new Map<string, SaslMechanismName>([
  ['sasl-plain', 'PLAIN'],
  ['sasl-external', 'EXTERNAL'],
  ['sasl-scram', 'SCRAM-SHA-256'],
]);

/**
 * Replies that arrive in bulk and are worth nothing individually.
 *
 * `RPL_LIST` is the whole reason this exists: one row per channel on the
 * network, tens of thousands of them, each currently costing a render of every
 * component watching the network. `RPL_WHOREPLY` and `RPL_NAMREPLY` are the
 * same shape on a large channel. The end-of-list numeric beside each one is
 * deliberately absent, so finishing always announces immediately.
 */
const BULK_NUMERICS: ReadonlySet<string> = new Set(['322', '352', '354', '353']);

/**
 * How long a coalesced announcement waits.
 *
 * Long enough that a flood becomes ten updates a second rather than thousands,
 * short enough that the count in the channel browser still reads as live.
 */
const BULK_FLUSH_MS = 100;

/** The mechanism this profile is configured for, if any. */
function configuredMechanism(profile: NetworkProfile): SaslMechanismName | undefined {
  return profile.auth === undefined ? undefined : MECHANISM_FOR.get(profile.auth.type);
}

const defaultCrypto = (): CryptoProvider | undefined => {
  const platform = (globalThis as { crypto?: { subtle?: unknown } }).crypto;
  return platform?.subtle === undefined
    ? undefined
    : webCryptoProvider(platform as Parameters<typeof webCryptoProvider>[0]);
};

export function createSession(options: SessionOptions): Session {
  const { profile, transport } = options;
  const now = options.now ?? (() => new Date());
  const states = new Listeners<NetworkState>();
  const events = new Listeners<SessionEvent>();

  let ctcpPolicy: CtcpPolicy = options.ctcp ?? DEFAULT_CTCP_POLICY;

  // Rebuilt per message rather than captured once, so a policy change takes
  // effect on the next request instead of the next connection.
  const contextNow = (): ReduceContext => ({
    altNicks: profile.identity.altNicks,
    wantsSasl: configuredMechanism(profile) !== undefined,
    ctcp: ctcpPolicy,
    now,
  });

  let state = initialNetworkState(profile.id, profile.name, profile.identity.nick);
  let mechanism: SaslMechanism | undefined;
  /** Whether the mechanism has produced its initial response yet. */
  let mechanismStarted = false;
  let reassembler = new AuthenticateReassembler();
  let subscriptions: Unsubscribe[] = [];
  let destroyed = false;
  /** The WHOIS poll, on networks with neither MONITOR nor WATCH. */
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  /** A pending announcement of coalesced state, if one is waiting. */
  let coalescing: ReturnType<typeof setTimeout> | undefined;

  const publish = (next: NetworkState): void => {
    // Anything published outright supersedes a coalesced announcement, which
    // would otherwise fire a moment later with state already announced.
    if (coalescing !== undefined) {
      clearTimeout(coalescing);
      coalescing = undefined;
    }
    state = next;
    states.emit(next);
    events.emit({ kind: 'state', state: next });
  };

  /**
   * Records new state now, announces it shortly.
   *
   * For replies that arrive in the thousands and mean nothing one at a time.
   * A bare `LIST` on a large network is twenty thousand numerics over a few
   * seconds, and announcing each one is twenty thousand renders of the whole
   * interface — which is how a channel list makes a client stop responding.
   * `session.state` is still correct the instant the line is reduced; only the
   * telling waits.
   */
  const publishSoon = (next: NetworkState): void => {
    state = next;
    if (coalescing !== undefined) {
      return;
    }
    coalescing = setTimeout(() => {
      coalescing = undefined;
      states.emit(state);
      events.emit({ kind: 'state', state });
    }, BULK_FLUSH_MS);
  };

  const recordRaw = (
    current: NetworkState,
    direction: 'in' | 'out',
    line: string,
  ): NetworkState => {
    const appended = [...current.rawLog, { at: now(), direction, line }];
    return {
      ...current,
      rawLog:
        appended.length > RAW_LOG_LIMIT
          ? appended.slice(appended.length - RAW_LOG_LIMIT)
          : appended,
    };
  };

  /** Sends lines and records them in the raw log. */
  const write = (lines: readonly string[]): void => {
    if (lines.length === 0) {
      return;
    }
    let next = state;
    for (const line of lines) {
      transport.send(line);
      next = recordRaw(next, 'out', line);
    }
    publish(next);
  };

  const handleEffects = (effects: readonly Effect[]): void => {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'start-sasl':
          void beginSasl();
          break;
        case 'registered':
          onRegistered();
          break;
        case 'capabilities-lost':
          // Nothing to undo in state: every feature reads `caps.enabled` at the
          // point of use, so losing one takes effect on the next read.
          break;
        case 'dcc-offer':
          events.emit({
            kind: 'dcc-offer',
            from: effect.from,
            target: effect.target,
            send: effect.send,
          });
          break;
        case 'xdcc-offer':
          events.emit({
            kind: 'xdcc-offer',
            from: effect.from,
            target: effect.target,
            pack: effect.pack,
          });
          break;
      }
    }
  };

  const onRegistered = (): void => {
    const lines: string[] = [];

    // Before the autojoins, so a channel that only lets in signed-in people has
    // the best chance of the sign-in having landed first.
    if (profile.auth?.type === 'nickserv') {
      void identifyWithService(profile.auth.account, profile.auth.password);
    }

    for (const entry of profile.autojoin) {
      // Keys are resolved asynchronously, so a keyed channel joins a moment
      // later rather than holding up the rest.
      if (entry.key === undefined) {
        lines.push(`JOIN ${entry.target}`);
      } else {
        void joinWithKey(entry.target, entry.key);
      }
    }
    lines.push(...profile.connectCommands.filter((line) => line !== ''));

    // MONITOR and WATCH lists live on the server and do not survive a
    // reconnect, so the list is re-registered rather than assumed.
    const resync = resyncNotify(state);
    publish({ ...state, notify: resync.notify });
    write([...lines, ...resync.send]);

    // Anything that happened while we were gone, then the newest page for
    // channels that were already open.
    const backfill = backfillJoinedChannels(state, options.historyPageSize);
    publish(backfill.state);
    write(backfill.send);

    startPolling();
    events.emit({ kind: 'registered' });
  };

  /**
   * The WHOIS fallback for the notify list.
   *
   * Only runs on a network offering neither MONITOR nor WATCH. The interval is
   * deliberately slow and the list deliberately short: a WHOIS per friend per
   * tick is indistinguishable from flooding if either grows.
   */
  const startPolling = (): void => {
    stopPolling();
    if (pollTargets(state).length === 0 && notifyMechanism(state.support) !== 'poll') {
      return;
    }
    pollTimer = setInterval(() => {
      const targets = pollTargets(state);
      if (targets.length > 0) {
        write(targets.map((nick) => `WHOIS ${nick}`));
      }
    }, POLL_INTERVAL_MS);
  };

  const stopPolling = (): void => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const joinWithKey = async (target: string, ref: SecretRef): Promise<void> => {
    const key = await options.resolveSecret?.(ref);
    if (destroyed) {
      return;
    }
    write([key === undefined ? `JOIN ${target}` : `JOIN ${target} ${key}`]);
  };

  /**
   * The legacy sign-in: a private message to the account service.
   *
   * CLAUDE.md prefers SASL everywhere it exists, and this is what is left for
   * the networks that do not offer it. It goes out after registration rather
   * than during it, because there is no service to talk to until the connection
   * is up — which is also why it cannot fail the way SASL can. Nothing replies
   * in a form worth waiting on, so the notice from the service lands in the
   * conversation with it, where somebody can read what happened.
   */
  const identifyWithService = async (account: string, ref: SecretRef): Promise<void> => {
    const password = await options.resolveSecret?.(ref);
    if (destroyed || password === undefined) {
      if (!destroyed) {
        events.emit({
          kind: 'auth-failed',
          reason: 'No password was stored for this network, so signing in was skipped.',
        });
      }
      return;
    }
    write([`PRIVMSG NickServ :IDENTIFY ${account} ${password}`]);
  };

  const failAuth = (reason: string): void => {
    mechanism = undefined;
    mechanismStarted = false;
    events.emit({ kind: 'auth-failed', reason });
    // Registration must not stall on a failed exchange; the connection
    // continues unauthenticated and the interface says so.
    write(['AUTHENTICATE *', 'CAP END']);
  };

  const credentialsFor = async (): Promise<{ account?: string; password?: string } | undefined> => {
    const auth = profile.auth;
    if (auth === undefined) {
      return undefined;
    }
    switch (auth.type) {
      case 'sasl-external':
        return {};
      case 'sasl-plain':
      case 'sasl-scram': {
        const password = await options.resolveSecret?.(auth.password);
        return password === undefined ? undefined : { account: auth.account, password };
      }
      default:
        return undefined;
    }
  };

  const beginSasl = async (): Promise<void> => {
    const configured = configuredMechanism(profile);
    if (configured === undefined) {
      write(['CAP END']);
      return;
    }

    const advertised = parseMechanisms(state.caps.available.get('sasl') ?? '');
    const chosen = selectMechanism(advertised, [configured]);
    if (chosen === undefined) {
      failAuth(`This network does not offer ${configured} authentication.`);
      return;
    }

    const credentials = await credentialsFor();
    if (credentials === undefined || destroyed) {
      if (!destroyed) {
        failAuth('The saved password could not be read.');
      }
      return;
    }

    const built = createMechanism(chosen, credentials, options.crypto ?? defaultCrypto());
    if (built === undefined) {
      failAuth(`${chosen} is not available on this platform.`);
      return;
    }

    mechanism = built;
    mechanismStarted = false;
    reassembler = new AuthenticateReassembler();

    // Only the mechanism name goes out now. The initial response waits for the
    // server's empty challenge: sending it early is a protocol violation, and a
    // server that has not finished setting the mechanism up will reject it.
    write([`AUTHENTICATE ${chosen}`]);
  };

  const applyStep = (step: Awaited<ReturnType<SaslMechanism['start']>>): void => {
    switch (step.kind) {
      case 'send':
        write(step.payload.map((chunk) => `AUTHENTICATE ${chunk}`));
        break;
      case 'await-outcome':
        break;
      case 'failed':
        failAuth(step.reason);
        break;
    }
  };

  /**
   * Drives the SASL exchange.
   *
   * `AUTHENTICATE` is handled here rather than in the reducer because each
   * response may need WebCrypto, and the reducer cannot await anything.
   */
  const handleAuthenticate = async (msg: IrcMessage): Promise<void> => {
    const active = mechanism;
    if (active === undefined) {
      return;
    }

    const payload = reassembler.push(msg.params[0] ?? '');
    if (payload === undefined) {
      return; // More chunks to come.
    }

    // The first challenge is the server's empty `+`, which is the cue to send
    // the initial response. Everything after it is a real challenge.
    const started = mechanismStarted;
    mechanismStarted = true;
    const step = started ? await active.respond(payload) : await active.start();

    if (destroyed || mechanism !== active) {
      return;
    }
    applyStep(step);
  };

  const handleLine = (line: string): void => {
    const parsed = parseMessage(line);
    let next = recordRaw(state, 'in', line);

    if (!parsed.ok) {
      // An unparseable line is still evidence, so it stays in the raw log; it
      // just cannot mean anything to the reducer.
      publish(next);
      return;
    }

    const msg = parsed.message;
    if (msg.command === 'AUTHENTICATE') {
      publish(next);
      void handleAuthenticate(msg);
      return;
    }

    // Lapsed mutes stop matching without anyone having to remove them.
    const ignores = pruneIgnores(next.ignores, now());
    if (ignores !== next.ignores) {
      next = { ...next, ignores };
    }

    const step = reduce(next, msg, contextNow());
    // Nothing to send and nothing to do makes a reply safe to announce late;
    // anything with consequences is announced at once.
    if (BULK_NUMERICS.has(msg.command) && step.send.length === 0 && step.effects.length === 0) {
      publishSoon(step.state);
    } else {
      publish(step.state);
      write(step.send);
      handleEffects(step.effects);
    }

    if (step.state.phase === 'registered') {
      mechanism = undefined;
      mechanismStarted = false;
    }
  };

  /**
   * The liveness watch, in a holder because it and `handleClose` refer to each
   * other: the watch stops when the connection closes, and a connection that
   * has gone silent is closed by the watch. A holder rather than a `let` so the
   * binding itself is fixed and only its contents are filled in below.
   */
  const watch: { current: Keepalive | undefined } = { current: undefined };

  const handleClose = (reason: CloseReason): void => {
    mechanism = undefined;
    mechanismStarted = false;
    watch.current?.stop();
    // Batches do not survive a connection, and a half-open one would silently
    // absorb the first messages of the next.
    publish({
      ...state,
      phase: 'disconnected',
      lastClose: reason,
      // How long we have been signed in is a fact about a connection, not about
      // a network. The next one starts the clock again.
      registeredAt: undefined,
      batches: new Map(),
      channels: new Map(
        [...state.channels].map(([key, channel]) => [
          key,
          { ...channel, historyPending: undefined },
        ]),
      ),
    });
    events.emit({ kind: 'closed', reason });
  };

  /**
   * Watching for a connection that has died without saying so.
   *
   * The half-open socket: the network goes away, nothing sends a FIN, and the
   * client sits showing "connected" forever. Started once registration
   * completes — before that the server is talking to us anyway — and told about
   * every inbound line, which is what counts as proof of life.
   */
  watch.current = createKeepalive({
    send: (line) => {
      try {
        transport.send(line);
      } catch {
        // The transport refusing to send is itself the answer: there is nothing
        // to ping through. The timeout below reaches the same conclusion.
      }
    },
    onDead: () => {
      const reason: CloseReason = {
        kind: 'network-error',
        message: 'The server stopped responding.',
      };
      // A reconnecting transport is told, so it retries. Anything else is
      // disconnected, which at least stops the interface claiming otherwise.
      if ('dropped' in transport) {
        transport.dropped(reason);
      } else {
        transport.disconnect();
        handleClose(reason);
      }
    },
    ...(options.keepaliveIdleMs === undefined ? {} : { idleMs: options.keepaliveIdleMs }),
    ...(options.keepaliveTimeoutMs === undefined ? {} : { timeoutMs: options.keepaliveTimeoutMs }),
  });

  /**
   * Listens from the moment the session exists, not from `connect`.
   *
   * A reconnecting transport re-establishes on its own schedule and starts
   * delivering lines again without anyone calling `connect`. A session that
   * only listened while it thought it was connected would miss them.
   */
  subscriptions.push(
    transport.onLine((line) => {
      // Started from the first line rather than from `connect`: a reconnecting
      // transport re-establishes on its own schedule without anyone calling
      // `connect`, and the watch has to cover those connections too. `start` is
      // a no-op once it is running.
      //
      // Noted before the line is parsed — an unparseable line is still evidence
      // that the other end is there, which is all this needs to know.
      watch.current?.start();
      watch.current?.noteActivity();
      handleLine(line);
    }),
  );
  subscriptions.push(transport.onClose(handleClose));

  /**
   * Following a reconnecting transport while it works.
   *
   * Between a drop and the attempt that fixes it the transport emits no close —
   * that is the point of it — so without this the phase would sit at
   * `registered` and the sidebar would show a connected network that is not
   * carrying anything. What the user needs to see there is "connecting".
   */
  if ('onStateChange' in transport) {
    subscriptions.push(
      transport.onStateChange((connection) => {
        if (connection.kind === 'connecting' || connection.kind === 'waiting') {
          watch.current?.stop();
          // Only from a state that claimed otherwise. A first connection
          // already sets this in `connect`, and republishing would discard the
          // `lastClose` it deliberately cleared.
          if (state.phase === 'registered' || state.phase === 'registering') {
            publish({ ...state, phase: 'connecting', registeredAt: undefined });
          }
        }
      }),
    );
  }

  const detach = (): void => {
    for (const stop of subscriptions) {
      stop();
    }
    subscriptions = [];
  };

  /** Builds a message we are about to send, shown before the server confirms. */
  const optimistic = (target: string, text: string, kind: 'privmsg' | 'action'): Message => {
    const at = now();
    const base = {
      kind,
      at,
      fromServerTime: false,
      source: makeSource(state.nick),
      target,
      text,
      account: state.account,
      replyTo: undefined,
      // Cleared when echo-message returns it. Without that capability it stays
      // set, and the interface shows the un-acknowledged indicator.
      pending: true,
      tags: new Map<string, string>(),
    };
    return { ...base, id: derivedId(base) };
  };

  const showOwn = (target: string, message: Message): void => {
    const key = fold(target, state.support.caseMapping);
    const toChannel = isChannel(target, state.support);
    const existing = (toChannel ? state.channels : state.queries).get(key);
    const channel = existing ?? emptyChannel(target);
    const updated = { ...channel, messages: insertMessage(channel.messages, message) };

    if (toChannel) {
      const channels = new Map(state.channels);
      channels.set(key, updated);
      publish({ ...state, channels });
    } else {
      const queries = new Map(state.queries);
      queries.set(key, updated);
      publish({ ...state, queries });
    }
  };

  return {
    id: profile.id,

    get state() {
      return state;
    },

    subscribe: (callback) => states.add(callback),
    on: (callback) => events.add(callback),

    async connect() {
      // Announced before the socket is even attempted, so the interface can
      // show "connecting" rather than an indefinite blank. Without this the
      // phase sits at `disconnected` throughout the TCP and TLS handshake, and
      // a failure is indistinguishable from still trying.
      publish({ ...state, phase: 'connecting', lastClose: undefined });

      try {
        await transport.connect({
          endpoint: profile.servers[0] ?? {
            host: '',
            port: 6697,
            tls: { mode: 'tls', verifyCert: true },
          },
        });
      } catch (error) {
        // A transport that rejects its connect — a refused socket, a TLS
        // failure surfaced synchronously — never emits a close event, so the
        // phase would otherwise stay stuck at `connecting`. The reason the
        // transport classified is kept where it has one, so a rejected
        // certificate stays a `tls-error` the interface can act on rather than
        // being flattened to a generic network error.
        const reason: CloseReason = connectErrorReason(error) ?? {
          kind: 'network-error',
          message: error instanceof Error ? error.message : String(error),
        };
        publish({ ...state, phase: 'disconnected', lastClose: reason });
        throw error;
      }

      events.emit({ kind: 'connected' });

      const opening = startRegistration(state, profile.identity);
      publish(opening.state);

      // A server password is not SASL and goes before NICK, so it is prepended
      // rather than sent alongside the rest.
      if (profile.auth?.type === 'server-password') {
        const password = await options.resolveSecret?.(profile.auth.password);
        if (password !== undefined && !destroyed) {
          write([`PASS ${password}`]);
        }
      }
      write(opening.send);
    },

    disconnect(reason) {
      if (state.phase !== 'disconnected') {
        write([reason === undefined ? 'QUIT' : `QUIT :${reason}`]);
      }
      transport.disconnect();
    },

    send: (line) => write([line]),

    sendMessage(target, text) {
      for (const part of text.split('\n').filter((line) => line !== '')) {
        showOwn(target, optimistic(target, part, 'privmsg'));
        write([`PRIVMSG ${target} :${part}`]);
      }
    },

    sendAction(target, text) {
      showOwn(target, optimistic(target, text, 'action'));
      write([`PRIVMSG ${target} :${encodeAction(text)}`]);
    },

    join: (target, key) => write([key === undefined ? `JOIN ${target}` : `JOIN ${target} ${key}`]),
    part: (target, reason) =>
      write([reason === undefined ? `PART ${target}` : `PART ${target} :${reason}`]),

    closeQuery(target) {
      // Nothing goes to the network: IRC has no concept of a private
      // conversation to leave. Closing one is purely a local decision to stop
      // showing it, and the next message from that person reopens it.
      const queries = new Map(state.queries);
      if (queries.delete(fold(target, state.support.caseMapping))) {
        publish({ ...state, queries });
      }
    },

    listChannels(pattern) {
      // Clearing first means the browser shows an empty loading state rather
      // than the previous network-wide list while the new answer arrives.
      publish({ ...state, directory: { ...emptyDirectory(), loading: true } });
      write([pattern === undefined || pattern === '' ? 'LIST' : `LIST ${pattern}`]);
    },

    loadOlder(target) {
      const result = requestOlder(state, target, options.historyPageSize);
      if (result.ok) {
        publish(result.state);
        write(result.send);
      }
    },

    setAway: (message) =>
      write([message === undefined || message === '' ? 'AWAY' : `AWAY :${message}`]),

    invite: (nick, target) => write([`INVITE ${nick} ${target}`]),

    setCtcpPolicy(policy) {
      ctcpPolicy = policy;
    },

    dismissInvite(channel) {
      const key = fold(channel, state.support.caseMapping);
      publish({
        ...state,
        invites: state.invites.filter(
          (invite) => fold(invite.channel, state.support.caseMapping) !== key,
        ),
      });
    },

    addIgnore(mask, ignoreOptions) {
      publish({
        ...state,
        ignores: addIgnore(state.ignores, mask, { now: now(), ...ignoreOptions }),
      });
    },

    removeIgnore(mask) {
      publish({ ...state, ignores: removeIgnore(state.ignores, mask) });
    },

    addNotify(nicks) {
      const change = addToNotify(state, nicks);
      publish({ ...state, notify: change.notify });
      write(change.send);
      return change.rejected;
    },

    removeNotify(nicks) {
      const change = removeFromNotify(state, nicks);
      publish({ ...state, notify: change.notify });
      write(change.send);
    },

    destroy() {
      destroyed = true;
      clearTimeout(coalescing);
      coalescing = undefined;
      stopPolling();
      detach();
      states.clear();
      events.clear();
      transport.disconnect();
    },
  };
}
