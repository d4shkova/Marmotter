/**
 * The settings screen, written down and read back.
 *
 * Everything on that screen except the networks and the name: how the message
 * list is laid out, what raises a notification, what strangers may ask over
 * CTCP, where downloads go, how long a notice stays, and the logging policy.
 * Without this they were chosen afresh on every launch, which is the same as
 * not having settings.
 *
 * The shape lives here rather than in `@marmotter/shared` because `CtcpPolicy`
 * comes from `@marmotter/protocol`, which `shared` deliberately does not depend
 * on. `shared` owns the profile and identity shapes; the shell owns its own
 * interface settings, and `StoredPreferences` carries them through opaquely.
 *
 * Everything read back is validated field by field. This is a file on
 * somebody's own disk that anything running as them can edit, and a `NaN` where
 * a number is expected is how a notice never dismisses itself. Anything missing
 * or malformed falls back to that field's default rather than to `undefined`,
 * so one bad value costs one setting rather than the file.
 */

import { DEFAULT_CTCP_POLICY, type CtcpPolicy } from '@marmotter/protocol';
import { defaultLoggingPolicy, type LoggingPolicy } from '@marmotter/shared';
import { readThemeId } from '../themes.js';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_USER_OPTIONS,
  clampToastSeconds,
  type Appearance,
  type UserOptions,
} from './view-store.js';

/** Everything the settings screen holds, as it goes to disk. */
export interface StoredSettings {
  readonly appearance: Appearance;
  readonly ctcp: CtcpPolicy;
  readonly userOptions: UserOptions;
  readonly logging: LoggingPolicy;
}

/** The settings a fresh install starts from. Also what Reset returns to. */
export const DEFAULT_SETTINGS: StoredSettings = {
  appearance: DEFAULT_APPEARANCE,
  ctcp: DEFAULT_CTCP_POLICY,
  userOptions: DEFAULT_USER_OPTIONS,
  logging: defaultLoggingPolicy,
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** A number inside its bounds, or the default. Rejects NaN and Infinity. */
const number = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
};

const words = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
    : DEFAULT_APPEARANCE.highlightWords;

function readAppearance(value: unknown): Appearance {
  const fields = record(value);
  return {
    // Anything the file does not recognise as a theme is the default one,
    // rather than a window with no colours defined in it at all.
    theme: readThemeId(fields['theme']),
    // Bounded the same way the settings control bounds it. A width of 400 from
    // a hand-edited file would push the message text off the screen with no
    // obvious way back.
    nickColumnWidth: number(fields['nickColumnWidth'], DEFAULT_APPEARANCE.nickColumnWidth, 6, 24),
    alignNicksRight: bool(fields['alignNicksRight'], DEFAULT_APPEARANCE.alignNicksRight),
    foldEvents: bool(fields['foldEvents'], DEFAULT_APPEARANCE.foldEvents),
    showTimestamps: bool(fields['showTimestamps'], DEFAULT_APPEARANCE.showTimestamps),
    // Never restored as on from a malformed value: unfurling asks an arbitrary
    // host for a page and tells it the user's address, and CLAUDE.md makes that
    // an explicit choice. A file that does not clearly say yes means no.
    unfurlLinks: fields['unfurlLinks'] === true,
    highlightWords: words(fields['highlightWords']),
    notificationsEnabled: bool(
      fields['notificationsEnabled'],
      DEFAULT_APPEARANCE.notificationsEnabled,
    ),
    showBrowseChannelsShortcut: bool(
      fields['showBrowseChannelsShortcut'],
      DEFAULT_APPEARANCE.showBrowseChannelsShortcut,
    ),
    sidePanelsAtEdges: bool(fields['sidePanelsAtEdges'], DEFAULT_APPEARANCE.sidePanelsAtEdges),
  };
}

function readCtcp(value: unknown): CtcpPolicy {
  const fields = record(value);
  const versionText = fields['versionText'];
  return {
    version: bool(fields['version'], DEFAULT_CTCP_POLICY.version),
    ping: bool(fields['ping'], DEFAULT_CTCP_POLICY.ping),
    time: bool(fields['time'], DEFAULT_CTCP_POLICY.time),
    clientinfo: bool(fields['clientinfo'], DEFAULT_CTCP_POLICY.clientinfo),
    // Absent means the built-in string, which is not the same as an empty one.
    ...(typeof versionText === 'string' ? { versionText } : {}),
  };
}

function readUserOptions(value: unknown): UserOptions {
  const fields = record(value);
  const folder = fields['downloadFolder'];
  return {
    // The monitor cannot be on without somewhere to write, whatever the file
    // says — that pairing is enforced in the interface and has to survive a
    // round trip through disk.
    dccMonitorEnabled: bool(fields['dccMonitorEnabled'], false) && typeof folder === 'string',
    downloadFolder: typeof folder === 'string' && folder !== '' ? folder : undefined,
    toastSeconds: clampToastSeconds(
      typeof fields['toastSeconds'] === 'number'
        ? fields['toastSeconds']
        : DEFAULT_USER_OPTIONS.toastSeconds,
    ),
  };
}

function readLogging(value: unknown): LoggingPolicy {
  const fields = record(value);
  const scope = record(fields['scope']);
  const retention = fields['retentionDays'];
  const path = fields['path'];
  return {
    // Logging off unless the file clearly says otherwise. CLAUDE.md makes
    // switching it on an explicit choice, and a malformed file is not one.
    enabled: fields['enabled'] === true,
    scope: {
      channels: bool(scope['channels'], defaultLoggingPolicy.scope.channels),
      privateMessages: bool(scope['privateMessages'], defaultLoggingPolicy.scope.privateMessages),
      serverNotices: bool(scope['serverNotices'], defaultLoggingPolicy.scope.serverNotices),
    },
    format: fields['format'] === 'plaintext' ? 'plaintext' : 'sqlite',
    // Anything that is not a sane number of days keeps everything, which errs
    // towards not deleting somebody's logs on the strength of a bad value.
    retentionDays:
      typeof retention === 'number' && Number.isFinite(retention) && retention >= 1
        ? Math.round(retention)
        : 'forever',
    ...(typeof path === 'string' && path !== '' ? { path } : {}),
  };
}

/** The settings in the file, with every missing field filled from the defaults. */
export function readStoredSettings(value: unknown): StoredSettings {
  const fields = record(value);
  return {
    appearance: readAppearance(fields['appearance']),
    ctcp: readCtcp(fields['ctcp']),
    userOptions: readUserOptions(fields['userOptions']),
    logging: readLogging(fields['logging']),
  };
}

/**
 * The settings as they go into the file.
 *
 * Written field by field rather than by spreading, for the same reason the
 * profile serializer is: a field added to one of these types later is not
 * persisted until somebody decides it should be.
 */
export function writeStoredSettings(settings: StoredSettings): Record<string, unknown> {
  return {
    appearance: {
      theme: settings.appearance.theme,
      nickColumnWidth: settings.appearance.nickColumnWidth,
      alignNicksRight: settings.appearance.alignNicksRight,
      foldEvents: settings.appearance.foldEvents,
      showTimestamps: settings.appearance.showTimestamps,
      unfurlLinks: settings.appearance.unfurlLinks,
      highlightWords: [...settings.appearance.highlightWords],
      notificationsEnabled: settings.appearance.notificationsEnabled,
      showBrowseChannelsShortcut: settings.appearance.showBrowseChannelsShortcut,
      sidePanelsAtEdges: settings.appearance.sidePanelsAtEdges,
    },
    ctcp: {
      version: settings.ctcp.version,
      ping: settings.ctcp.ping,
      time: settings.ctcp.time,
      clientinfo: settings.ctcp.clientinfo,
      ...(settings.ctcp.versionText === undefined
        ? {}
        : { versionText: settings.ctcp.versionText }),
    },
    userOptions: {
      dccMonitorEnabled: settings.userOptions.dccMonitorEnabled,
      ...(settings.userOptions.downloadFolder === undefined
        ? {}
        : { downloadFolder: settings.userOptions.downloadFolder }),
      toastSeconds: settings.userOptions.toastSeconds,
    },
    logging: {
      enabled: settings.logging.enabled,
      scope: {
        channels: settings.logging.scope.channels,
        privateMessages: settings.logging.scope.privateMessages,
        serverNotices: settings.logging.scope.serverNotices,
      },
      format: settings.logging.format,
      retentionDays: settings.logging.retentionDays,
      ...(settings.logging.path === undefined ? {} : { path: settings.logging.path }),
    },
  };
}
