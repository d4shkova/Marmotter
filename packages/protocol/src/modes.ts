/**
 * Mode parsing.
 *
 * Which modes consume a parameter is decided entirely by `CHANMODES` and
 * `PREFIX` from ISUPPORT. Hardcoding it is the classic source of member-list
 * corruption: miscount one parameter and every later mode in the same command
 * is attributed to the wrong target.
 */

import { type ISupport, modeForPrefix } from './isupport.js';

/** How a mode behaves, which decides whether it takes a parameter. */
export type ModeKind =
  /** CHANMODES type A. Always takes a parameter. Maintains a list. */
  | 'list'
  /** CHANMODES type B. Always takes a parameter. */
  | 'parameter'
  /** CHANMODES type C. Takes a parameter when set, none when unset. */
  | 'parameter-when-set'
  /** CHANMODES type D. Never takes a parameter. */
  | 'flag'
  /** Grants a nick prefix, per PREFIX. Always takes a nick parameter. */
  | 'prefix'
  /** Not advertised by the server. Assumed parameterless. */
  | 'unknown';

export interface ModeChange {
  /** True for `+`, false for `-`. */
  readonly add: boolean;
  readonly mode: string;
  readonly kind: ModeKind;
  /** Absent when this mode takes no parameter, or the parameter ran out. */
  readonly parameter: string | undefined;
}

export interface ModeChangeResult {
  readonly changes: readonly ModeChange[];
  /**
   * True when a mode needed a parameter and none was left.
   *
   * Callers should treat the affected change as unreliable; it usually means the
   * server and client disagree about `CHANMODES`.
   */
  readonly truncated: boolean;
  /** Parameters left over after every mode was satisfied. */
  readonly unused: readonly string[];
}

/** Classifies a channel mode letter against what the server advertises. */
export function classifyChannelMode(mode: string, support: ISupport): ModeKind {
  if (support.prefixes.some((entry) => entry.mode === mode)) {
    return 'prefix';
  }
  const { list, parameter, parameterWhenSet, flag } = support.chanModes;
  if (list.includes(mode)) {
    return 'list';
  }
  if (parameter.includes(mode)) {
    return 'parameter';
  }
  if (parameterWhenSet.includes(mode)) {
    return 'parameter-when-set';
  }
  if (flag.includes(mode)) {
    return 'flag';
  }
  return 'unknown';
}

/** Whether a change of this kind consumes a parameter. */
export function takesParameter(kind: ModeKind, add: boolean): boolean {
  switch (kind) {
    case 'list':
    case 'parameter':
    case 'prefix':
      return true;
    case 'parameter-when-set':
      return add;
    case 'flag':
    case 'unknown':
      return false;
  }
}

/**
 * Parses a channel mode string and its parameters into ordered changes.
 *
 * Handles compound changes such as `+o-v+b nick1 nick2 mask`, where the sign
 * flips mid-string and each mode draws its parameter in order.
 *
 * An unadvertised mode is assumed parameterless. Guessing the other way would
 * swallow a parameter belonging to a later mode and corrupt everything after it;
 * this way only the unknown mode itself is wrong.
 */
export function parseChannelModes(
  modeString: string,
  params: readonly string[],
  support: ISupport,
): ModeChangeResult {
  const changes: ModeChange[] = [];
  let add = true;
  let next = 0;
  let truncated = false;

  for (const char of modeString) {
    if (char === '+') {
      add = true;
      continue;
    }
    if (char === '-') {
      add = false;
      continue;
    }

    const kind = classifyChannelMode(char, support);
    let parameter: string | undefined;

    if (takesParameter(kind, add)) {
      if (next < params.length) {
        parameter = params[next];
        next += 1;
      } else {
        truncated = true;
      }
    }

    changes.push({ add, mode: char, kind, parameter });
  }

  return { changes, truncated, unused: params.slice(next) };
}

/**
 * Parses a user mode string, as sent for MODE on one's own nick.
 *
 * User modes take no parameters in practice, so no ISUPPORT is needed.
 */
export function parseUserModes(modeString: string): readonly ModeChange[] {
  const changes: ModeChange[] = [];
  let add = true;

  for (const char of modeString) {
    if (char === '+') {
      add = true;
    } else if (char === '-') {
      add = false;
    } else {
      changes.push({ add, mode: char, kind: 'flag', parameter: undefined });
    }
  }
  return changes;
}

/**
 * The non-list, non-prefix modes currently set on a channel.
 *
 * List modes live in their own collections, populated from the 367/346/348/728
 * numerics, and prefix modes belong to individual members.
 */
export interface ChannelModeState {
  readonly flags: ReadonlySet<string>;
  /** Values for modes that carry one, e.g. `k` to the key, `l` to the limit. */
  readonly params: ReadonlyMap<string, string>;
}

export const EMPTY_CHANNEL_MODES: ChannelModeState = {
  flags: new Set(),
  params: new Map(),
};

/**
 * Applies parsed changes to channel mode state.
 *
 * Prefix and list modes are ignored here: they are not properties of the
 * channel, and the caller routes them to the member list and the list tables.
 */
export function applyChannelModes(
  state: ChannelModeState,
  changes: readonly ModeChange[],
): ChannelModeState {
  const flags = new Set(state.flags);
  const params = new Map(state.params);

  for (const change of changes) {
    if (change.kind === 'prefix' || change.kind === 'list') {
      continue;
    }

    if (!change.add) {
      flags.delete(change.mode);
      params.delete(change.mode);
      continue;
    }

    flags.add(change.mode);
    if (change.parameter !== undefined) {
      params.set(change.mode, change.parameter);
    }
  }

  return { flags, params };
}

/** Applies changes to a set of user mode letters. */
export function applyUserModes(
  current: ReadonlySet<string>,
  changes: readonly ModeChange[],
): ReadonlySet<string> {
  const modes = new Set(current);
  for (const change of changes) {
    if (change.add) {
      modes.add(change.mode);
    } else {
      modes.delete(change.mode);
    }
  }
  return modes;
}

/**
 * Applies prefix-mode changes to a member's prefix characters.
 *
 * The result stays ordered by the server's advertised privilege order, so the
 * highest prefix is always first and the member list can show it directly.
 */
export function applyPrefixes(
  current: string,
  changes: readonly ModeChange[],
  support: ISupport,
): string {
  const held = new Set(current.split(''));

  for (const change of changes) {
    if (change.kind !== 'prefix') {
      continue;
    }
    const prefix = support.prefixes.find((entry) => entry.mode === change.mode)?.prefix;
    if (prefix === undefined) {
      continue;
    }
    if (change.add) {
      held.add(prefix);
    } else {
      held.delete(prefix);
    }
  }

  return support.prefixes
    .map((entry) => entry.prefix)
    .filter((prefix) => held.has(prefix))
    .join('');
}

/** Turns prefix characters into the mode letters behind them. */
export function prefixesToModes(prefixes: string, support: ISupport): string {
  return prefixes
    .split('')
    .map((prefix) => modeForPrefix(prefix, support))
    .filter((mode): mode is string => mode !== undefined)
    .join('');
}

export interface ModeCommand {
  readonly modeString: string;
  readonly params: readonly string[];
}

/**
 * Renders changes back into MODE commands, respecting the server's `MODES`
 * limit on how many changes one command may carry.
 *
 * The moderation panels build changes as a list and send them without having to
 * know the limit; batching here keeps that knowledge in one place.
 */
export function serializeModeChanges(
  changes: readonly ModeChange[],
  support: ISupport,
): readonly ModeCommand[] {
  const perCommand = support.modesPerCommand ?? changes.length;
  if (changes.length === 0) {
    return [];
  }

  const commands: ModeCommand[] = [];
  const limit = Math.max(1, perCommand);

  for (let start = 0; start < changes.length; start += limit) {
    const batch = changes.slice(start, start + limit);
    const params: string[] = [];
    let modeString = '';
    let sign: '+' | '-' | undefined;

    for (const change of batch) {
      const wanted = change.add ? '+' : '-';
      if (wanted !== sign) {
        modeString += wanted;
        sign = wanted;
      }
      modeString += change.mode;
      if (change.parameter !== undefined && takesParameter(change.kind, change.add)) {
        params.push(change.parameter);
      }
    }

    commands.push({ modeString, params });
  }

  return commands;
}
