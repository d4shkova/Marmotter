import { DEFAULT_ISUPPORT, applyISupport, serializeModeChanges } from '@marmotter/protocol';
import type { ChannelModeState } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import {
  channelControls,
  diffChannelModes,
  settingsFrom,
  unexplainedModes,
} from './channel-settings.js';

const support = applyISupport(DEFAULT_ISUPPORT, ['CHANMODES=beI,k,l,imnpstQ', 'PREFIX=(ov)@+']);

const modes = (flags: string[], params: [string, string][] = []): ChannelModeState => ({
  flags: new Set(flags),
  params: new Map(params),
});

/** The MODE lines the panel would send for a set of changes. */
const linesFor = (current: ChannelModeState, changes: Record<string, unknown>) => {
  const controls = channelControls(current, support);
  const desired = { ...settingsFrom(controls), ...changes } as ReturnType<typeof settingsFrom>;
  return serializeModeChanges(diffChannelModes(controls, desired, support), support).map(
    (command) => `${command.modeString} ${command.params.join(' ')}`.trim(),
  );
};

describe('channel settings from CHANMODES', () => {
  it('offers a control for every flag the network advertises and can describe', () => {
    const offered = channelControls(modes([]), support).map((control) => control.mode);
    expect(offered).toContain('n');
    expect(offered).toContain('m');
    expect(offered).toContain('i');
    expect(offered).toContain('k');
    expect(offered).toContain('l');
  });

  // A switch nobody can describe is a switch nobody should be shown. Those
  // letters stay reachable through the command bar, and the panel says so.
  it('shows no control for a letter the decoder cannot explain', () => {
    expect(channelControls(modes([]), support).map((control) => control.mode)).not.toContain('Q');
    expect(unexplainedModes(support)).toContain('Q');
  });

  it('offers nothing a network has not advertised', () => {
    const narrow = applyISupport(DEFAULT_ISUPPORT, ['CHANMODES=b,,,nt']);
    const offered = channelControls(modes([]), narrow).map((control) => control.mode);
    expect(offered).toEqual(['n', 't']);
  });

  it('reads the channel’s current settings into the controls', () => {
    const controls = channelControls(modes(['n', 't', 'l'], [['l', '120']]), support);
    const limit = controls.find((control) => control.mode === 'l');
    expect(controls.find((control) => control.mode === 'n')?.enabled).toBe(true);
    expect(controls.find((control) => control.mode === 'm')?.enabled).toBe(false);
    expect(limit?.value).toBe('120');
  });

  it('names things by what they do, never by a mode letter', () => {
    const control = channelControls(modes([]), support).find((entry) => entry.mode === 'm');
    expect(control?.title).toBe('Moderated');
    expect(control?.detail).not.toMatch(/\+m|mode/i);
  });
});

describe('turning a changed panel back into MODE', () => {
  it('sends nothing when nothing moved', () => {
    expect(linesFor(modes(['n', 't']), {})).toEqual([]);
  });

  // One command, in the order the controls are laid out — so what the raw log
  // shows lines up with what somebody just clicked, top to bottom.
  it('sends one command for several flags flipped at once', () => {
    expect(
      linesFor(modes(['n']), { m: { enabled: true, value: '' }, n: { enabled: false, value: '' } }),
    ).toEqual(['-n+m']);
  });

  it('sets a member limit with its value and clears it without one', () => {
    expect(linesFor(modes([]), { l: { enabled: true, value: '50' } })).toEqual(['+l 50']);
    expect(linesFor(modes(['l'], [['l', '50']]), { l: { enabled: false, value: '50' } })).toEqual([
      '-l',
    ]);
  });

  it('sets a password and clears it by naming the one being removed', () => {
    expect(linesFor(modes([]), { k: { enabled: true, value: 'hunter2' } })).toEqual(['+k hunter2']);
    // Most ircds refuse `-k` without the key, so the current one goes with it.
    expect(
      linesFor(modes(['k'], [['k', 'hunter2']]), { k: { enabled: false, value: '' } }),
    ).toEqual(['-k hunter2']);
  });

  // A second `+k` on a channel that already has one is refused rather than
  // silently replacing it, so the old key has to come off first.
  it('drops the old password before setting a new one', () => {
    expect(linesFor(modes(['k'], [['k', 'old']]), { k: { enabled: true, value: 'new' } })).toEqual([
      '-k+k old new',
    ]);
  });

  it('batches changes against the server’s MODES limit', () => {
    const limited = applyISupport(DEFAULT_ISUPPORT, [
      'CHANMODES=beI,k,l,imnpst',
      'PREFIX=(ov)@+',
      'MODES=2',
    ]);
    const controls = channelControls(modes([]), limited);
    const desired = {
      ...settingsFrom(controls),
      m: { enabled: true, value: '' },
      i: { enabled: true, value: '' },
      s: { enabled: true, value: '' },
    };
    const commands = serializeModeChanges(diffChannelModes(controls, desired, limited), limited);
    expect(commands).toHaveLength(2);
  });
});
