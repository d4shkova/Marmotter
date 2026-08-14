import { DEFAULT_CTCP_POLICY } from '@marmotter/protocol';
import { defaultLoggingPolicy } from '@marmotter/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  readStoredSettings,
  writeStoredSettings,
  type StoredSettings,
} from './stored-settings.js';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_USER_OPTIONS,
  TOAST_SECONDS_RANGE,
  useView,
} from './view-store.js';

/** Through the file and back, which is the thing that actually has to hold. */
const roundTrip = (settings: StoredSettings): StoredSettings =>
  readStoredSettings(JSON.parse(JSON.stringify(writeStoredSettings(settings))));

describe('settings through the file and back', () => {
  it('brings the defaults back unchanged', () => {
    expect(roundTrip(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps every choice somebody made', () => {
    const chosen: StoredSettings = {
      appearance: {
        theme: 'paper',
        nickColumnWidth: 18,
        alignNicksRight: false,
        foldEvents: false,
        showTimestamps: false,
        unfurlLinks: true,
        highlightWords: ['marmot', 'burrow'],
        notificationsEnabled: false,
        showBrowseChannelsShortcut: false,
      },
      ctcp: { version: false, ping: true, time: false, clientinfo: false, versionText: 'nothing' },
      userOptions: {
        dccMonitorEnabled: true,
        downloadFolder: '/home/tamsin/Downloads',
        toastSeconds: 25,
      },
      logging: {
        enabled: true,
        scope: { channels: true, privateMessages: false, serverNotices: true },
        format: 'plaintext',
        retentionDays: 30,
        path: '/home/tamsin/logs',
      },
    };

    expect(roundTrip(chosen)).toEqual(chosen);
  });

  it('tells an absent version string from an empty one', () => {
    // Absent means the built-in string; empty means somebody cleared the field.
    expect(roundTrip(DEFAULT_SETTINGS).ctcp.versionText).toBeUndefined();
    const cleared = { ...DEFAULT_SETTINGS, ctcp: { ...DEFAULT_CTCP_POLICY, versionText: '' } };
    expect(roundTrip(cleared).ctcp.versionText).toBe('');
  });

  it('writes only the fields it names, so a new one is never persisted by accident', () => {
    const written = writeStoredSettings({
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_APPEARANCE, somethingNew: 'leaked' },
    } as StoredSettings & { appearance: { somethingNew: string } });

    expect(JSON.stringify(written)).not.toContain('leaked');
  });
});

describe('reading a settings file somebody has edited', () => {
  it('fills in everything a file does not mention', () => {
    // An install from before settings were kept has no `settings` at all.
    expect(readStoredSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(readStoredSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(readStoredSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
  });

  it('costs one setting rather than the file when one value is wrong', () => {
    const read = readStoredSettings({
      appearance: { nickColumnWidth: 'wide', alignNicksRight: false },
    });

    expect(read.appearance.nickColumnWidth).toBe(DEFAULT_APPEARANCE.nickColumnWidth);
    expect(read.appearance.alignNicksRight).toBe(false);
  });

  it('holds the nick column inside the range the control offers', () => {
    // A width of 400 from a hand-edited file pushes the message text off the
    // screen, with no obvious way back.
    expect(
      readStoredSettings({ appearance: { nickColumnWidth: 400 } }).appearance.nickColumnWidth,
    ).toBe(24);
    expect(
      readStoredSettings({ appearance: { nickColumnWidth: 1 } }).appearance.nickColumnWidth,
    ).toBe(6);
  });

  it('never lets a notice timeout become one that does not end', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -30]) {
      const seconds = readStoredSettings({ userOptions: { toastSeconds: bad } }).userOptions
        .toastSeconds;
      expect(seconds, String(bad)).toBeGreaterThanOrEqual(TOAST_SECONDS_RANGE.min);
      expect(seconds).toBeLessThanOrEqual(TOAST_SECONDS_RANGE.max);
    }
  });

  it('never turns link previews on from a value that does not clearly say so', () => {
    // Unfurling asks an arbitrary host for a page and tells it the user's
    // address. CLAUDE.md makes that an explicit choice, and a malformed file is
    // not one.
    for (const bad of ['true', 1, {}, null, undefined]) {
      expect(readStoredSettings({ appearance: { unfurlLinks: bad } }).appearance.unfurlLinks).toBe(
        false,
      );
    }
    expect(readStoredSettings({ appearance: { unfurlLinks: true } }).appearance.unfurlLinks).toBe(
      true,
    );
  });

  it('never switches logging on from a value that does not clearly say so', () => {
    for (const bad of ['true', 1, null, undefined]) {
      expect(readStoredSettings({ logging: { enabled: bad } }).logging.enabled).toBe(false);
    }
    expect(readStoredSettings({ logging: { enabled: true } }).logging.enabled).toBe(true);
  });

  it('keeps everything when the retention value makes no sense', () => {
    // Errs towards not deleting somebody's logs on the strength of a bad value.
    for (const bad of [Number.NaN, -5, 0, 'thirty', null]) {
      expect(readStoredSettings({ logging: { retentionDays: bad } }).logging.retentionDays).toBe(
        'forever',
      );
    }
    expect(readStoredSettings({ logging: { retentionDays: 30 } }).logging.retentionDays).toBe(30);
  });

  it('cannot restore the file monitor switched on with nowhere to write', () => {
    // The interface enforces that pairing; it has to survive a round trip
    // through a file too, or the monitor comes back on with no folder.
    const read = readStoredSettings({ userOptions: { dccMonitorEnabled: true } });
    expect(read.userOptions.dccMonitorEnabled).toBe(false);
    expect(read.userOptions.downloadFolder).toBeUndefined();

    const withFolder = readStoredSettings({
      userOptions: { dccMonitorEnabled: true, downloadFolder: '/downloads' },
    });
    expect(withFolder.userOptions.dccMonitorEnabled).toBe(true);
  });

  it('drops highlight words that are not words', () => {
    expect(
      readStoredSettings({ appearance: { highlightWords: ['marmot', 3, '', null, 'burrow'] } })
        .appearance.highlightWords,
    ).toEqual(['marmot', 'burrow']);
  });

  it('reads an unknown logging format as the default rather than passing it on', () => {
    expect(readStoredSettings({ logging: { format: 'parchment' } }).logging.format).toBe('sqlite');
    expect(readStoredSettings({ logging: { format: 'plaintext' } }).logging.format).toBe(
      'plaintext',
    );
  });
});

describe('the defaults', () => {
  it('are the same ones the rest of the app starts from', () => {
    // Reset returns to these, so they must not drift from the store's own.
    expect(DEFAULT_SETTINGS.appearance).toBe(DEFAULT_APPEARANCE);
    expect(DEFAULT_SETTINGS.userOptions).toBe(DEFAULT_USER_OPTIONS);
    expect(DEFAULT_SETTINGS.ctcp).toBe(DEFAULT_CTCP_POLICY);
    expect(DEFAULT_SETTINGS.logging).toBe(defaultLoggingPolicy);
  });

  it('keep logging and link previews off, which is what CLAUDE.md requires', () => {
    expect(DEFAULT_SETTINGS.logging.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.appearance.unfurlLinks).toBe(false);
    expect(DEFAULT_SETTINGS.userOptions.dccMonitorEnabled).toBe(false);
  });
});

describe('resetting to the defaults', () => {
  it('puts every setting back and leaves the rest of the store alone', () => {
    // The button says networks and the saved name are untouched, so they have
    // to be — a reset that quietly removed somebody's networks under a label
    // like this would be a nasty surprise.
    useView.setState({
      appearance: { ...DEFAULT_APPEARANCE, nickColumnWidth: 20, unfurlLinks: true },
      userOptions: { dccMonitorEnabled: true, downloadFolder: '/downloads', toastSeconds: 45 },
      logging: { ...defaultLoggingPolicy, enabled: true, retentionDays: 7 },
      ctcp: { ...DEFAULT_CTCP_POLICY, version: false },
      selection: { networkId: 'n1', target: '#marmotter' },
      networkOrder: ['n1', 'n2'],
    });

    useView.getState().resetSettings();
    const after = useView.getState();

    expect(after.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(after.userOptions).toEqual(DEFAULT_USER_OPTIONS);
    expect(after.logging).toEqual(defaultLoggingPolicy);
    expect(after.ctcp).toEqual(DEFAULT_CTCP_POLICY);

    // Not settings, and not the reset button's business.
    expect(after.selection).toEqual({ networkId: 'n1', target: '#marmotter' });
    expect(after.networkOrder).toEqual(['n1', 'n2']);
  });

  it('applies a whole set read from disk in one go', () => {
    useView.getState().applySettings(readStoredSettings({ appearance: { foldEvents: false } }));

    expect(useView.getState().appearance.foldEvents).toBe(false);
    // And the fields the file did not mention came from the defaults, not from
    // whatever happened to be in the store.
    expect(useView.getState().appearance.nickColumnWidth).toBe(DEFAULT_APPEARANCE.nickColumnWidth);
  });
});
