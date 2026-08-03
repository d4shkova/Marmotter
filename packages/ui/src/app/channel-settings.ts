/**
 * Channel settings, as controls rather than as a mode string.
 *
 * CLAUDE.md's abstraction table asks for `MODE #c +mtnsikl` to become a panel of
 * labelled toggles, with `+k` a password field and `+l` a member-limit stepper,
 * parsing `CHANMODES` from ISUPPORT rather than hardcoding. This module is the
 * mapping, kept pure so it can be reasoned about without a connection: what
 * controls does this network's advertised mode set justify showing, and what
 * `MODE` does a change to them produce.
 *
 * A letter the network advertises but the decoder cannot explain is
 * deliberately *not* given a control. Inventing a label for a mode nobody can
 * describe would put a switch in front of somebody with no way to know what it
 * does — those letters stay reachable through `/mode` and the raw log, and the
 * panel says so.
 */

import type { ISupport, ModeChange } from '@marmotter/protocol';
import { type ChannelModeState, classifyChannelMode } from '@marmotter/protocol';
import {
  CHANNEL_FLAG_MODES,
  CHANNEL_PARAMETER_MODES,
  type Explanation,
} from '../decoder/dictionary.js';

export type ControlKind = 'flag' | 'password' | 'limit';

export interface ChannelControl {
  readonly mode: string;
  readonly kind: ControlKind;
  /** Two or three words, for the row's label. */
  readonly title: string;
  /** One sentence saying what it does, in the interface's voice. */
  readonly detail: string;
  /** Set only where the meaning genuinely differs between networks. */
  readonly caveat?: string;
  /** Whether the mode is set. For a password or a limit, whether it has a value. */
  readonly enabled: boolean;
  /** The current value, for the controls that carry one. */
  readonly value: string;
}

/** What the settings panel holds, ready to be diffed back into MODE changes. */
export type ChannelSettings = Readonly<Record<string, { enabled: boolean; value: string }>>;

/**
 * The controls this network's `CHANMODES` justifies, in a stable order.
 *
 * Ordered by how often somebody reaches for them rather than alphabetically:
 * the things that change who may speak come before the things that change who
 * may see.
 */
const FLAG_ORDER = ['n', 'm', 't', 'i', 'r', 'S', 'z', 'c', 'C', 's', 'p', 'D'];

export function channelControls(
  modes: ChannelModeState,
  support: ISupport,
): readonly ChannelControl[] {
  const controls: ChannelControl[] = [];
  const advertised = new Set(support.chanModes.flag.split(''));

  const ordered = [
    ...FLAG_ORDER.filter((mode) => advertised.has(mode)),
    ...[...advertised].filter((mode) => !FLAG_ORDER.includes(mode)).sort(),
  ];

  for (const mode of ordered) {
    const explanation = CHANNEL_FLAG_MODES.get(mode);
    if (explanation === undefined) {
      continue;
    }
    controls.push({
      mode,
      kind: 'flag',
      ...describe(explanation),
      enabled: modes.flags.has(mode),
      value: '',
    });
  }

  // A password is type B — it carries its value both ways. A member limit is
  // type C, carrying one only when set. Both are read from what the server
  // advertised rather than assumed to exist.
  const withValue = `${support.chanModes.parameter}${support.chanModes.parameterWhenSet}`;
  if (withValue.includes('k')) {
    controls.push({
      mode: 'k',
      kind: 'password',
      ...describe(CHANNEL_PARAMETER_MODES.get('k')),
      enabled: modes.flags.has('k'),
      value: modes.params.get('k') ?? '',
    });
  }
  if (withValue.includes('l')) {
    controls.push({
      mode: 'l',
      kind: 'limit',
      ...describe(CHANNEL_PARAMETER_MODES.get('l')),
      enabled: modes.flags.has('l'),
      value: modes.params.get('l') ?? '',
    });
  }

  return controls;
}

/** The panel's starting state, taken from the channel as it is now. */
export function settingsFrom(controls: readonly ChannelControl[]): ChannelSettings {
  return Object.fromEntries(
    controls.map((control) => [control.mode, { enabled: control.enabled, value: control.value }]),
  );
}

/**
 * The mode changes that would turn the channel's current settings into the
 * panel's, or none where nothing moved.
 *
 * The caller passes the result to `serializeModeChanges`, which batches them
 * against the server's `MODES` limit — so a panel with a dozen changes still
 * produces commands the server will accept.
 */
export function diffChannelModes(
  controls: readonly ChannelControl[],
  desired: ChannelSettings,
  support: ISupport,
): readonly ModeChange[] {
  const changes: ModeChange[] = [];

  for (const control of controls) {
    const next = desired[control.mode];
    if (next === undefined) {
      continue;
    }
    const kind = classifyChannelMode(control.mode, support);

    if (control.kind === 'flag') {
      if (next.enabled !== control.enabled) {
        changes.push({ add: next.enabled, mode: control.mode, kind, parameter: undefined });
      }
      continue;
    }

    const wanted = next.enabled ? next.value.trim() : '';
    const current = control.enabled ? control.value : '';
    if (wanted === current) {
      continue;
    }

    if (wanted === '') {
      // Unsetting a key needs the key as its parameter on most ircds; a limit
      // takes none. `classifyChannelMode` is what tells the two apart, which is
      // why the letter is never special-cased here.
      changes.push({
        add: false,
        mode: control.mode,
        kind,
        parameter: kind === 'parameter' ? current : undefined,
      });
      continue;
    }

    // Replacing a key means dropping the old one first: a second `+k` on a
    // channel that already has one is refused by most ircds rather than
    // silently replacing it.
    if (current !== '' && kind === 'parameter') {
      changes.push({ add: false, mode: control.mode, kind, parameter: current });
    }
    changes.push({ add: true, mode: control.mode, kind, parameter: wanted });
  }

  return changes;
}

/** Modes the network advertises that the panel deliberately does not show. */
export function unexplainedModes(support: ISupport): readonly string[] {
  return support.chanModes.flag
    .split('')
    .filter((mode) => !CHANNEL_FLAG_MODES.has(mode))
    .sort();
}

function describe(
  explanation: Explanation | undefined,
): Pick<ChannelControl, 'title' | 'detail'> & { caveat?: string } {
  if (explanation === undefined) {
    return { title: 'Unnamed setting', detail: 'This network has not described this setting.' };
  }
  return {
    title: explanation.title,
    detail: explanation.detail,
    ...(explanation.caveat === undefined ? {} : { caveat: explanation.caveat }),
  };
}
