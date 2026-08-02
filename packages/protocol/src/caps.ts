/**
 * IRCv3 capability negotiation.
 *
 * https://ircv3.net/specs/extensions/capability-negotiation
 *
 * Every capability degrades gracefully. This module reports what the server
 * offered and what it acknowledged; nothing above it may assume a capability is
 * present without asking.
 */

import type { IrcMessage } from './message.js';

/** Capabilities Marmotter requests, in the order they are offered. */
export const DESIRED_CAPABILITIES: readonly string[] = [
  'sasl',
  'server-time',
  'echo-message',
  'message-tags',
  'batch',
  'labeled-response',
  'multi-prefix',
  'extended-join',
  'away-notify',
  'account-notify',
  'account-tag',
  'chghost',
  'setname',
  'invite-notify',
  'standard-replies',
  'draft/chathistory',
  'cap-notify',
  'draft/message-redaction',
  '+draft/reply',
  '+draft/react',
  'draft/typing',
  'draft/read-marker',
];

export type CapPhase =
  /** Nothing sent yet. */
  | 'idle'
  /** `CAP LS 302` sent, collecting the offer. */
  | 'listing'
  /** `CAP REQ` sent, waiting on ACK or NAK. */
  | 'requesting'
  /** Waiting for SASL to finish before `CAP END`. */
  | 'authenticating'
  /** `CAP END` sent. Negotiation is over; `CAP NEW`/`DEL` may still arrive. */
  | 'done';

export interface CapState {
  readonly phase: CapPhase;
  /** Everything the server offered, mapped to its value (empty when valueless). */
  readonly available: ReadonlyMap<string, string>;
  /** Everything the server acknowledged. */
  readonly enabled: ReadonlySet<string>;
  /** Capabilities we asked for and the server refused. */
  readonly rejected: ReadonlySet<string>;
  /** True once the server has sent a `CAP LS` reply without a continuation marker. */
  readonly listComplete: boolean;
  /** Outstanding requests, so a late ACK can still be matched. */
  readonly pending: ReadonlySet<string>;
}

export const INITIAL_CAP_STATE: CapState = {
  phase: 'idle',
  available: new Map(),
  enabled: new Set(),
  rejected: new Set(),
  listComplete: false,
  pending: new Set(),
};

/** Actions the caller should take after feeding a message to the state machine. */
export type CapAction =
  /** Send `CAP REQ :<caps>`. */
  | { readonly kind: 'request'; readonly capabilities: readonly string[] }
  /** Begin SASL. Registration must not finish until it resolves. */
  | { readonly kind: 'start-sasl' }
  /** Send `CAP END`. */
  | { readonly kind: 'end' }
  /** A capability disappeared mid-session; features relying on it must stop. */
  | { readonly kind: 'lost'; readonly capabilities: readonly string[] };

export interface CapStep {
  readonly state: CapState;
  readonly actions: readonly CapAction[];
}

/** Splits a `CAP LS` capability list into names and values. */
export function parseCapabilityList(list: string): ReadonlyMap<string, string> {
  const caps = new Map<string, string>();
  for (const entry of list.split(' ')) {
    if (entry === '') {
      continue;
    }
    const equals = entry.indexOf('=');
    if (equals === -1) {
      caps.set(entry, '');
    } else {
      caps.set(entry.slice(0, equals), entry.slice(equals + 1));
    }
  }
  return caps;
}

/** The opening `CAP LS 302`, plus the state that expects its reply. */
export function beginNegotiation(state: CapState = INITIAL_CAP_STATE): {
  readonly state: CapState;
  readonly line: string;
} {
  return { state: { ...state, phase: 'listing' }, line: 'CAP LS 302' };
}

/** Which of the desired capabilities this server actually offers. */
export function capabilitiesToRequest(
  available: ReadonlyMap<string, string>,
  desired: readonly string[] = DESIRED_CAPABILITIES,
): readonly string[] {
  return desired.filter((cap) => available.has(cap));
}

/**
 * Advances the state machine on a `CAP` message.
 *
 * `wantsSasl` says whether the profile is configured to authenticate; the
 * machine holds `CAP END` back until SASL finishes when it is, because ending
 * negotiation early aborts authentication.
 */
export function handleCapMessage(
  state: CapState,
  msg: IrcMessage,
  options: { readonly wantsSasl: boolean; readonly desired?: readonly string[] } = {
    wantsSasl: false,
  },
): CapStep {
  // CAP <nick-or-*> <subcommand> [*] :<list>
  const subcommand = (msg.params[1] ?? '').toUpperCase();
  const hasContinuation = msg.params[2] === '*';
  const list = (hasContinuation ? msg.params[3] : msg.params[2]) ?? '';
  const desired = options.desired ?? DESIRED_CAPABILITIES;

  switch (subcommand) {
    case 'LS': {
      const available = new Map(state.available);
      for (const [name, value] of parseCapabilityList(list)) {
        available.set(name, value);
      }

      if (hasContinuation) {
        return { state: { ...state, available, listComplete: false }, actions: [] };
      }

      const wanted = capabilitiesToRequest(available, desired);
      if (wanted.length === 0) {
        return {
          state: { ...state, available, listComplete: true, phase: 'done' },
          actions: [{ kind: 'end' }],
        };
      }

      return {
        state: {
          ...state,
          available,
          listComplete: true,
          phase: 'requesting',
          pending: new Set(wanted),
        },
        actions: [{ kind: 'request', capabilities: wanted }],
      };
    }

    case 'ACK': {
      const acked = [...parseCapabilityList(list).keys()];
      const enabled = new Set(state.enabled);
      const pending = new Set(state.pending);
      const removed: string[] = [];

      for (const name of acked) {
        // An ACK may carry `-cap` to confirm a capability was disabled.
        if (name.startsWith('-')) {
          const bare = name.slice(1);
          enabled.delete(bare);
          pending.delete(bare);
          removed.push(bare);
        } else {
          enabled.add(name);
          pending.delete(name);
        }
      }

      const actions: CapAction[] = [];
      if (removed.length > 0) {
        actions.push({ kind: 'lost', capabilities: removed });
      }

      if (state.phase !== 'requesting') {
        return { state: { ...state, enabled, pending }, actions };
      }

      if (options.wantsSasl && enabled.has('sasl')) {
        return {
          state: { ...state, enabled, pending, phase: 'authenticating' },
          actions: [...actions, { kind: 'start-sasl' }],
        };
      }

      return {
        state: { ...state, enabled, pending, phase: 'done' },
        actions: [...actions, { kind: 'end' }],
      };
    }

    case 'NAK': {
      const refused = [...parseCapabilityList(list).keys()];
      const rejected = new Set(state.rejected);
      const pending = new Set(state.pending);
      for (const name of refused) {
        rejected.add(name);
        pending.delete(name);
      }

      if (state.phase !== 'requesting') {
        return { state: { ...state, rejected, pending }, actions: [] };
      }

      return {
        state: { ...state, rejected, pending, phase: 'done' },
        actions: [{ kind: 'end' }],
      };
    }

    case 'NEW': {
      // cap-notify: the server gained capabilities mid-session.
      const available = new Map(state.available);
      for (const [name, value] of parseCapabilityList(list)) {
        available.set(name, value);
      }

      const wanted = capabilitiesToRequest(parseCapabilityList(list), desired).filter(
        (cap) => !state.enabled.has(cap),
      );

      if (wanted.length === 0) {
        return { state: { ...state, available }, actions: [] };
      }

      return {
        state: { ...state, available, pending: new Set([...state.pending, ...wanted]) },
        actions: [{ kind: 'request', capabilities: wanted }],
      };
    }

    case 'DEL': {
      const gone = [...parseCapabilityList(list).keys()];
      const available = new Map(state.available);
      const enabled = new Set(state.enabled);
      for (const name of gone) {
        available.delete(name);
        enabled.delete(name);
      }

      return {
        state: { ...state, available, enabled },
        actions: [{ kind: 'lost', capabilities: gone }],
      };
    }

    default:
      return { state, actions: [] };
  }
}

/** Marks SASL as finished, releasing the held-back `CAP END`. */
export function finishSasl(state: CapState): CapStep {
  if (state.phase !== 'authenticating') {
    return { state, actions: [] };
  }
  return { state: { ...state, phase: 'done' }, actions: [{ kind: 'end' }] };
}

/** Whether a capability is currently negotiated. */
export function hasCapability(state: CapState, name: string): boolean {
  return state.enabled.has(name);
}
