import { describe, expect, it } from 'vitest';
import { DEFAULT_CTCP_POLICY } from '@marmotter/protocol';
import { EMPTY_IDENTITY, defaultLoggingPolicy, type NetworkProfile } from '@marmotter/shared';
import {
  CONFIG_FORMAT,
  buildConfig,
  describeConfig,
  parseConfig,
  serializeConfig,
  type ConfigSource,
} from './config-transfer.js';
import { DEFAULT_APPEARANCE, DEFAULT_USER_OPTIONS } from './view-store.js';
import { DEFAULT_SETTINGS } from './stored-settings.js';

const profile = (overrides: Partial<NetworkProfile> = {}): NetworkProfile => ({
  id: 'libera',
  name: 'Libera.Chat',
  servers: [{ host: 'irc.libera.chat', port: 6697, tls: { mode: 'tls', verifyCert: true } }],
  identity: { nick: 'tamsin', altNicks: ['tamsin_'], username: 'tamsin', realname: 'Tamsin' },
  autojoin: [{ target: '#marmotter' }],
  connectCommands: [],
  encoding: 'utf-8',
  autoReconnect: true,
  ...overrides,
});

const source = (overrides: Partial<ConfigSource> = {}): ConfigSource => ({
  identity: { ...EMPTY_IDENTITY, nick: 'tamsin', altNick: 'tamsin_' },
  networks: [profile()],
  settings: DEFAULT_SETTINGS,
  now: new Date('2026-08-29T12:00:00Z'),
  ...overrides,
});

const roundTrip = (
  overrides: Partial<ConfigSource> = {},
  paths: Parameters<typeof parseConfig>[1] = {},
) => {
  const result = parseConfig(serializeConfig(buildConfig(source(overrides))), paths);
  if (!result.ok) {
    throw new Error(result.problem);
  }
  return result.config;
};

describe('a settings document', () => {
  it('carries the networks and the name from one device to the other', () => {
    const config = roundTrip();

    expect(config.identity.nick).toBe('tamsin');
    expect(config.networks).toHaveLength(1);
    expect(config.networks[0]?.name).toBe('Libera.Chat');
    expect(config.networks[0]?.servers[0]?.host).toBe('irc.libera.chat');
    expect(config.networks[0]?.autojoin[0]?.target).toBe('#marmotter');
  });

  it('says what it is, so a file that is not one can be refused', () => {
    expect(buildConfig(source()).format).toBe(CONFIG_FORMAT);
  });

  it('keeps how a network signs in, and under which account', () => {
    const config = roundTrip({
      networks: [
        profile({
          auth: {
            type: 'sasl-plain',
            account: 'tamsin',
            password: { kind: 'secret-ref', id: 'ref-1' },
          },
        }),
      ],
    });

    expect(config.networks[0]?.auth).toEqual({
      type: 'sasl-plain',
      account: 'tamsin',
      password: { kind: 'secret-ref', id: 'ref-1' },
    });
  });

  /**
   * The whole point of `SecretRef`. A reference is a key into a keychain, not
   * anything that opens one, and no password is in a profile to begin with — so
   * the document has nowhere to leak one from. This is the test that notices if
   * that ever stops being true.
   */
  it('has no password anywhere in it', () => {
    const text = serializeConfig(
      buildConfig(
        source({
          networks: [
            profile({
              auth: {
                type: 'server-password',
                password: { kind: 'secret-ref', id: 'ref-1' },
              },
              autojoin: [{ target: '#private', key: { kind: 'secret-ref', id: 'ref-2' } }],
            }),
          ],
        }),
      ),
    );

    expect(text).not.toContain('hunter2');
    // What is there is the reference, and only ever the reference.
    expect(JSON.parse(text)).toMatchObject({
      networks: [{ auth: { password: { kind: 'secret-ref' } } }],
    });
  });
});

/**
 * A download folder and a log folder are facts about one machine. Android does
 * not even let the user choose them, so carrying a desktop's across would point
 * a phone at a path it has no such thing as.
 */
describe('the folders that belong to one device', () => {
  it('leaves them out of the file', () => {
    const text = serializeConfig(
      buildConfig(
        source({
          settings: {
            ...DEFAULT_SETTINGS,
            userOptions: { ...DEFAULT_USER_OPTIONS, downloadFolder: '/home/tamsin/Downloads' },
            logging: { ...defaultLoggingPolicy, path: '/home/tamsin/logs' },
          },
        }),
      ),
    );

    expect(text).not.toContain('/home/tamsin/Downloads');
    expect(text).not.toContain('/home/tamsin/logs');
  });

  it('fills in the receiving device’s own', () => {
    const config = roundTrip(
      {
        settings: {
          ...DEFAULT_SETTINGS,
          userOptions: { ...DEFAULT_USER_OPTIONS, downloadFolder: '/home/tamsin/Downloads' },
        },
      },
      { downloadFolder: '/data/uk.co.dashkova.marmotter/files/downloads', logPath: '/data/logs' },
    );

    expect(config.settings.userOptions.downloadFolder).toBe(
      '/data/uk.co.dashkova.marmotter/files/downloads',
    );
    expect(config.settings.logging.path).toBe('/data/logs');
  });

  /**
   * The file monitor cannot be on with nowhere to write, and that pairing is
   * enforced on the way in. Without the receiving device's folder the setting
   * would arrive switched off — which is why the folder is filled in first.
   */
  it('keeps the file monitor switched on where the new device has somewhere to write', () => {
    const withMonitor = {
      ...DEFAULT_SETTINGS,
      userOptions: {
        ...DEFAULT_USER_OPTIONS,
        dccMonitorEnabled: true,
        downloadFolder: '/home/tamsin/Downloads',
      },
    };

    expect(
      roundTrip({ settings: withMonitor }, { downloadFolder: '/phone/downloads' }).settings
        .userOptions.dccMonitorEnabled,
    ).toBe(true);
    // And off where it has not: a monitor with no folder is a download that
    // fails per file rather than a setting that is honestly unavailable.
    expect(roundTrip({ settings: withMonitor }).settings.userOptions.dccMonitorEnabled).toBe(false);
  });
});

/**
 * The two ends will be different releases of the app more often than not — a
 * phone updates when the shop says so and a desktop when somebody says so — so
 * a document is read field by field, with anything missing falling back to its
 * own default rather than dropping the file.
 */
describe('a document written by a different build', () => {
  it('accepts one with settings it has never heard of', () => {
    const document = buildConfig(source());
    const text = JSON.stringify({
      ...document,
      version: document.version + 5,
      settings: { ...document.settings, somethingNewer: { enabled: true } },
    });

    const result = parseConfig(text);
    expect(result.ok).toBe(true);
  });

  it('fills in a setting the older build never wrote', () => {
    const document = buildConfig(source());
    const { appearance: _dropped, ...withoutAppearance } = document.settings;

    const result = parseConfig(JSON.stringify({ ...document, settings: withoutAppearance }));
    expect(result.ok && result.config.settings.appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps the good networks when one of them cannot be read', () => {
    const document = buildConfig(source());
    const result = parseConfig(
      JSON.stringify({ ...document, networks: [...document.networks, { name: 'Broken' }] }),
    );

    expect(result.ok && result.config.networks).toHaveLength(1);
    expect(result.ok && result.config.skippedNetworks).toBe(1);
  });
});

describe('text that is not a settings file', () => {
  it('asks for something to be pasted rather than complaining about nothing', () => {
    const result = parseConfig('   ');
    expect(result.ok).toBe(false);
    expect(result.ok || result.problem).toContain('Paste');
  });

  it('says what went wrong in words, not in parser errors', () => {
    const result = parseConfig('not json at all');
    expect(result.ok).toBe(false);
    expect(result.ok || result.problem).not.toContain('JSON.parse');
    expect(result.ok || result.problem).toContain('settings file');
  });

  it('refuses valid JSON that is somebody else’s', () => {
    const result = parseConfig('{"format":"something-else","networks":[]}');
    expect(result.ok).toBe(false);
    expect(result.ok || result.problem).toContain('not written by Marmotter');
  });

  it('refuses a bare array', () => {
    expect(parseConfig('[1,2,3]').ok).toBe(false);
  });
});

describe('what the import screen says it will do', () => {
  it('counts the networks and names the person', () => {
    expect(describeConfig(roundTrip())).toContain('1 network');
    expect(describeConfig(roundTrip())).toContain('tamsin');
  });

  it('says so when there are none', () => {
    expect(describeConfig(roundTrip({ networks: [] }))).toContain('no networks');
  });
});

describe('the settings themselves', () => {
  it('come back exactly as they went, folders aside', () => {
    const chosen = {
      appearance: { ...DEFAULT_APPEARANCE, theme: 'ember' as const, nickColumnWidth: 14 },
      ctcp: { ...DEFAULT_CTCP_POLICY, version: false, versionText: 'a marmot' },
      userOptions: { ...DEFAULT_USER_OPTIONS, toastSeconds: 9 },
      logging: { ...defaultLoggingPolicy, enabled: true, retentionDays: 30 },
    };

    const config = roundTrip({ settings: chosen });

    expect(config.settings.appearance.theme).toBe('ember');
    expect(config.settings.appearance.nickColumnWidth).toBe(14);
    expect(config.settings.ctcp.version).toBe(false);
    expect(config.settings.ctcp.versionText).toBe('a marmot');
    expect(config.settings.userOptions.toastSeconds).toBe(9);
    expect(config.settings.logging.enabled).toBe(true);
    expect(config.settings.logging.retentionDays).toBe(30);
  });

  it('records when it was written', () => {
    expect(roundTrip().exportedAt).toBe('2026-08-29T12:00:00.000Z');
  });
});
