/**
 * Settings, carried from one Marmotter to another.
 *
 * The same person runs this client on a desktop and on a phone, and until now
 * setting up the second meant typing the first one's networks in again by hand.
 * This is the document that moves between them: one JSON file holding the
 * networks, the name, and everything on the settings screen.
 *
 * Three rules shape it.
 *
 * **No secrets.** Passwords and channel keys are not in a profile to begin with
 * — a profile carries a `SecretRef`, and the value it stands for lives in the
 * platform's keychain — and nothing here goes looking for them. What travels is
 * the reference, which is a key into a keychain rather than anything that opens
 * one: it keeps "this network signs in with SASL as tamsin" intact, and the
 * password is typed once on the new device. Re-importing on the same device
 * finds its own keychain entries under those references and needs nothing
 * typed at all. The interface says all of this plainly rather than letting
 * somebody assume a backup includes their passwords.
 *
 * **No paths.** A download folder and a log folder are facts about one device,
 * and a phone has neither of the desktop's. They are left out on the way out
 * and filled in from the receiving device on the way in, so importing a
 * desktop's settings onto a phone does not point it at `C:\Users\…`.
 *
 * **No message content, ever.** Logs are not settings. Nothing in this file has
 * anybody's conversations in it, on any platform. See CLAUDE.md.
 *
 * The reading is deliberately forgiving, because the two ends will be different
 * versions of the app more often than not. Every field falls back to its own
 * default, so a document from a build that did not have a setting yet is not a
 * document that fails to load — it is one where that setting stays as it is.
 * What is refused is only what cannot be understood at all: text that is not
 * JSON, or JSON that is not one of these.
 */

import type { DefaultIdentity, NetworkProfile } from '@marmotter/shared';
import { EMPTY_IDENTITY, readStoredNetworks, writeStoredNetwork } from '@marmotter/shared';
import { readStoredSettings, writeStoredSettings, type StoredSettings } from './stored-settings.js';

/** What the file says it is. Anything else is not one of ours. */
export const CONFIG_FORMAT = 'marmotter-config';

/**
 * The document format's own version, which is not the app's.
 *
 * It changes only if the shape stops being readable by an older build — which
 * the field-by-field defaulting is designed to avoid. A newer document is read
 * rather than refused: refusing it would strand somebody whose phone updated
 * before their desktop did, and the worst an unknown field can do here is be
 * ignored.
 */
export const CONFIG_VERSION = 1;

/** The name a saved settings file is offered under. */
export const CONFIG_FILENAME = 'marmotter-settings.json';

/** What goes in the file. */
export interface ConfigDocument {
  readonly format: typeof CONFIG_FORMAT;
  readonly version: number;
  /** When it was written, for somebody looking at two of these. */
  readonly exportedAt: string;
  /** Which build wrote it. Informational — nothing branches on it. */
  readonly app?: string;
  readonly identity: DefaultIdentity;
  readonly networks: readonly unknown[];
  readonly settings: Record<string, unknown>;
}

/** Everything an export needs to know about this device. */
export interface ConfigSource {
  readonly identity: DefaultIdentity;
  readonly networks: readonly NetworkProfile[];
  readonly settings: StoredSettings;
  /** The app's version, recorded in the file. */
  readonly app?: string;
  /** Injectable for tests, so a document is reproducible. */
  readonly now?: Date;
}

/**
 * The paths this device uses, filled into an imported document.
 *
 * An export carries neither, so without these an import would arrive with the
 * download folder unset — which switches the file monitor off, because it
 * cannot be on with nowhere to write. Passing the device's own keeps a setting
 * that was never really about the other device.
 */
export interface DevicePaths {
  readonly downloadFolder?: string;
  readonly logPath?: string;
}

/** The document for this device's current configuration. */
export function buildConfig(source: ConfigSource): ConfigDocument {
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exportedAt: (source.now ?? new Date()).toISOString(),
    ...(source.app === undefined ? {} : { app: source.app }),
    identity: source.identity,
    networks: source.networks.map((profile) => withoutDevicePaths(writeStoredNetwork(profile))),
    settings: settingsWithoutDevicePaths(source.settings),
  };
}

/** The document as the text that gets copied or saved. */
export function serializeConfig(document: ConfigDocument): string {
  // Indented, because somebody will open this in a text editor to check what is
  // in it before they send it to their other machine — and being able to do
  // that is most of why it is JSON rather than something compact.
  return `${JSON.stringify(document, undefined, 2)}\n`;
}

/** A document that was understood, ready to be applied. */
export interface ConfigImport {
  readonly identity: DefaultIdentity;
  readonly networks: readonly NetworkProfile[];
  readonly settings: StoredSettings;
  /** What the file says wrote it, where it says. */
  readonly app: string | undefined;
  readonly exportedAt: string | undefined;
  /** How many profiles in the file could not be read, and were dropped. */
  readonly skippedNetworks: number;
}

export type ConfigParse =
  | { readonly ok: true; readonly config: ConfigImport }
  | { readonly ok: false; readonly problem: string };

/**
 * Reads a pasted or opened document.
 *
 * `paths` are this device's, filled in where the document deliberately carries
 * none. Every problem is a sentence somebody can act on: this is a screen where
 * the input is text somebody pasted, and "unexpected token < in JSON at
 * position 0" is not an answer to what went wrong.
 */
export function parseConfig(text: string, paths: DevicePaths = {}): ConfigParse {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, problem: 'Paste a settings file to see what it contains.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      problem:
        'That is not a settings file. Copy the whole file, including the first { and last }.',
    };
  }

  const fields = asRecord(parsed);
  if (fields === undefined) {
    return { ok: false, problem: 'That is not a settings file.' };
  }
  if (fields['format'] !== CONFIG_FORMAT) {
    return {
      ok: false,
      problem: 'That file was not written by Marmotter, so there is nothing here to import.',
    };
  }

  const offered = Array.isArray(fields['networks']) ? fields['networks'].length : 0;
  const networks = readStoredNetworks(fields['networks']);

  return {
    ok: true,
    config: {
      identity: readIdentity(fields['identity']),
      networks,
      settings: readStoredSettings(withDevicePaths(asRecord(fields['settings']) ?? {}, paths)),
      app: typeof fields['app'] === 'string' ? fields['app'] : undefined,
      exportedAt: typeof fields['exportedAt'] === 'string' ? fields['exportedAt'] : undefined,
      skippedNetworks: Math.max(0, offered - networks.length),
    },
  };
}

/** What applying a document would do, as a sentence for the confirm button. */
export function describeConfig(config: ConfigImport): string {
  const networks =
    config.networks.length === 0
      ? 'no networks'
      : config.networks.length === 1
        ? '1 network'
        : `${config.networks.length} networks`;
  const named = config.identity.nick === '' ? '' : `, the name ${config.identity.nick}`;
  return `${networks}${named}, and every setting on this screen.`;
}

/** The name, with each field defaulted rather than the lot dropped. */
function readIdentity(value: unknown): DefaultIdentity {
  const fields = asRecord(value) ?? {};
  const text = (key: string, fallback: string): string =>
    typeof fields[key] === 'string' ? fields[key] : fallback;
  return {
    nick: text('nick', EMPTY_IDENTITY.nick),
    altNick: text('altNick', EMPTY_IDENTITY.altNick),
    thirdNick: text('thirdNick', EMPTY_IDENTITY.thirdNick),
    realname: text('realname', EMPTY_IDENTITY.realname),
    email: text('email', EMPTY_IDENTITY.email),
  };
}

/** The settings, with this device's folders where the document has none. */
function withDevicePaths(
  settings: Record<string, unknown>,
  paths: DevicePaths,
): Record<string, unknown> {
  const userOptions = asRecord(settings['userOptions']) ?? {};
  const logging = asRecord(settings['logging']) ?? {};
  return {
    ...settings,
    userOptions: {
      ...userOptions,
      ...(paths.downloadFolder === undefined ? {} : { downloadFolder: paths.downloadFolder }),
    },
    logging: {
      ...logging,
      ...(paths.logPath === undefined ? {} : { path: paths.logPath }),
    },
  };
}

/** The settings with every folder belonging to this device taken out. */
function settingsWithoutDevicePaths(settings: StoredSettings): Record<string, unknown> {
  const written = writeStoredSettings(settings);
  const userOptions = { ...(asRecord(written['userOptions']) ?? {}) };
  const logging = { ...(asRecord(written['logging']) ?? {}) };
  delete userOptions['downloadFolder'];
  delete logging['path'];
  return { ...written, userOptions, logging };
}

/** One profile with its own log folder taken out, for the same reason. */
function withoutDevicePaths(profile: unknown): unknown {
  const fields = asRecord(profile);
  const logging = asRecord(fields?.['logging']);
  if (fields === undefined || logging === undefined) {
    return profile;
  }
  const withoutPath = { ...logging };
  delete withoutPath['path'];
  return { ...fields, logging: withoutPath };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
