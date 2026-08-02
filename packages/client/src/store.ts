/**
 * The network registry.
 *
 * Keyed by network ID from the first line, with no "current network" anywhere
 * in it. That is deliberate and load-bearing: a store with a single active
 * connection is the thing that makes multi-network a rewrite rather than a
 * feature, and every IRC client that retrofitted it paid for the shortcut.
 *
 * Which network the user is looking at is interface state, not connection
 * state, so it lives here only as a pair of selection fields that nothing in
 * `packages/client` reads. Removing them would not change a single connection.
 */

import { create } from 'zustand';
import type { NetworkProfile } from '@marmotter/shared';
import { type Session, type SessionOptions, createSession } from './session.js';
import { initialNetworkState } from './state/reduce.js';
import type { NetworkState } from './state/types.js';

/** Where the user is looking. Interface state, kept out of network state. */
export interface Selection {
  readonly networkId: string | undefined;
  /** Channel or nick within that network. Undefined means the server tab. */
  readonly target: string | undefined;
}

export interface NetworkRegistry {
  /** Profiles the user has configured, keyed by ID, in the order they added them. */
  readonly profiles: ReadonlyMap<string, NetworkProfile>;
  /** Reduced state per network. Present for every profile, connected or not. */
  readonly networks: ReadonlyMap<string, NetworkState>;
  readonly selection: Selection;

  /**
   * Registers a profile.
   *
   * Adding a profile does not connect it: a client that dials out the moment a
   * network is saved cannot be configured without being seen doing it.
   */
  addProfile(profile: NetworkProfile, session: Session): void;
  /** Replaces a profile's settings, leaving its live state and session alone. */
  updateProfile(id: string, changes: Partial<NetworkProfile>): void;
  /** Forgets a profile and tears down its session. */
  removeProfile(id: string): void;

  /** The session for a network, or undefined when there is no such network. */
  sessionOf(id: string): Session | undefined;

  select(networkId: string | undefined, target?: string): void;

  /** Disconnects and releases every session. */
  reset(): void;
}

/**
 * Sessions are kept outside the store's state.
 *
 * A session owns a socket and listeners; putting one in a React store invites
 * it to be treated as a value, compared, cloned, or serialised, none of which it
 * survives. The store holds the data, this holds the machinery.
 */
const sessions = new Map<string, Session>();

export const useNetworks = create<NetworkRegistry>((set) => {
  const unsubscribes = new Map<string, () => void>();

  const track = (session: Session): void => {
    const stop = session.subscribe((state) => {
      set((current) => {
        const networks = new Map(current.networks);
        networks.set(state.id, state);
        return { networks };
      });
    });
    unsubscribes.set(session.id, stop);
  };

  const release = (id: string): void => {
    unsubscribes.get(id)?.();
    unsubscribes.delete(id);
    sessions.get(id)?.destroy();
    sessions.delete(id);
  };

  return {
    profiles: new Map(),
    networks: new Map(),
    selection: { networkId: undefined, target: undefined },

    addProfile(profile, session) {
      release(profile.id);
      sessions.set(profile.id, session);
      track(session);

      set((current) => {
        const profiles = new Map(current.profiles);
        profiles.set(profile.id, profile);
        const networks = new Map(current.networks);
        networks.set(profile.id, session.state);
        return { profiles, networks };
      });
    },

    updateProfile(id, changes) {
      set((current) => {
        const existing = current.profiles.get(id);
        if (existing === undefined) {
          return {};
        }
        const profiles = new Map(current.profiles);
        profiles.set(id, { ...existing, ...changes });
        return { profiles };
      });
    },

    removeProfile(id) {
      release(id);
      set((current) => {
        const profiles = new Map(current.profiles);
        profiles.delete(id);
        const networks = new Map(current.networks);
        networks.delete(id);
        const selection =
          current.selection.networkId === id
            ? { networkId: undefined, target: undefined }
            : current.selection;
        return { profiles, networks, selection };
      });
    },

    sessionOf: (id) => sessions.get(id),

    select(networkId, target) {
      set(() => ({ selection: { networkId, target } }));
    },

    reset() {
      for (const id of [...sessions.keys()]) {
        release(id);
      }
      set(() => ({
        profiles: new Map(),
        networks: new Map(),
        selection: { networkId: undefined, target: undefined },
      }));
    },
  };
});

/**
 * Builds a session for a profile and registers it.
 *
 * The transport is supplied rather than chosen here: the desktop app builds a
 * Tauri one and the web app a WebSocket one, and `packages/client` must not
 * know which platform it is on.
 */
export function registerNetwork(options: SessionOptions): Session {
  const session = createSession(options);
  useNetworks.getState().addProfile(options.profile, session);
  return session;
}

/** The reduced state for a network, or a disconnected placeholder. */
export function networkStateOf(id: string, name = ''): NetworkState {
  return useNetworks.getState().networks.get(id) ?? initialNetworkState(id, name, '');
}

/** Every network, in the order the profiles were added. */
export const selectNetworks = (state: NetworkRegistry): readonly NetworkState[] =>
  [...state.profiles.keys()].flatMap((id) => {
    const network = state.networks.get(id);
    return network === undefined ? [] : [network];
  });

/** The selected network's state, or undefined when nothing is selected. */
export const selectActiveNetwork = (state: NetworkRegistry): NetworkState | undefined =>
  state.selection.networkId === undefined
    ? undefined
    : state.networks.get(state.selection.networkId);
