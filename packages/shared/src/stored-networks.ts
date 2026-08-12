/**
 * Network profiles, written down and read back.
 *
 * A profile is configuration: an address, a port, how to secure it, a name to
 * use, which channels to join. All of that survives a restart, so somebody who
 * set up three networks last week finds three networks waiting for them.
 *
 * **No secret is ever written here.** A profile carries a `SecretRef`, which is
 * a key into the platform's secret store, not the password itself — and that
 * distinction is the whole reason the type exists. What is written is the key;
 * what the key opens lives in the OS keychain. A file full of IRC passwords in
 * somebody's app data folder is exactly the thing `SecretRef` was introduced to
 * prevent, and reading this module is how a future change to it gets noticed.
 *
 * Everything read back is validated. This is a file on somebody's own disk,
 * editable by hand and by anything else running as them, so a field of the
 * wrong shape drops the profile rather than putting `undefined` where the client
 * expects a string. A profile that will not load is better than one that loads
 * and then fails at connect time in a way nobody can explain.
 */

import type {
  AuthConfig,
  NetworkProfile,
  SecretRef,
  ServerEndpoint,
  TlsConfig,
} from './profile.js';

/** A field that has to be a string, or the profile is not usable. */
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function readSecretRef(value: unknown): SecretRef | undefined {
  const fields = record(value);
  const id = str(fields?.['id']);
  return fields?.['kind'] === 'secret-ref' && id !== undefined
    ? { kind: 'secret-ref', id }
    : undefined;
}

/**
 * The TLS settings for one endpoint.
 *
 * Anything unrecognised becomes verified TLS rather than being dropped. That is
 * the safe direction: a malformed record must never quietly downgrade somebody
 * to an unencrypted connection, or to one that accepts any certificate.
 */
function readTls(value: unknown): TlsConfig {
  const fields = record(value);
  const mode = str(fields?.['mode']);

  if (mode === 'off') {
    return { mode: 'off' };
  }
  if (mode === 'websocket') {
    const url = str(fields?.['url']);
    return url === undefined ? { mode: 'tls', verifyCert: true } : { mode: 'websocket', url };
  }
  if (mode === 'tls' && fields?.['verifyCert'] === false) {
    const pinned = str(fields['pinnedFingerprint']);
    return pinned === undefined
      ? { mode: 'tls', verifyCert: false }
      : { mode: 'tls', verifyCert: false, pinnedFingerprint: pinned };
  }
  return { mode: 'tls', verifyCert: true };
}

function readEndpoint(value: unknown): ServerEndpoint | undefined {
  const fields = record(value);
  const host = str(fields?.['host']);
  const port = fields?.['port'];
  if (host === undefined || host === '' || typeof port !== 'number' || !Number.isInteger(port)) {
    return undefined;
  }
  if (port < 1 || port > 65535) {
    return undefined;
  }
  return { host, port, tls: readTls(fields?.['tls']) };
}

/**
 * The sign-in settings.
 *
 * A method whose password is missing from the file comes back without one, and
 * the client asks for it when connecting — which is what happens when the
 * keychain has been cleared, or when the profile was written by a build that
 * could not reach one. Losing the password is recoverable; losing the knowledge
 * that this network uses SASL is not.
 */
function readAuth(value: unknown): AuthConfig | undefined {
  const fields = record(value);
  const type = str(fields?.['type']);
  if (fields === undefined || type === undefined) {
    return undefined;
  }

  const account = str(fields['account']) ?? '';
  const password = readSecretRef(fields['password']);

  switch (type) {
    case 'sasl-external': {
      const certPath = str(fields['certPath']);
      return certPath === undefined ? undefined : { type: 'sasl-external', certPath };
    }
    case 'sasl-plain':
    case 'sasl-scram':
    case 'nickserv':
      return password === undefined ? undefined : { type, account, password };
    case 'server-password':
      return password === undefined ? undefined : { type: 'server-password', password };
    default:
      return undefined;
  }
}

/**
 * A network's own logging policy, or nothing.
 *
 * Every field is checked because this decides whether conversations are written
 * to disk. A malformed record falls back to no override — following the global
 * policy — rather than to a policy of its own that nobody chose.
 */
function readLogging(value: unknown): NetworkProfile['logging'] {
  const fields = record(value);
  if (fields === undefined || typeof fields['enabled'] !== 'boolean') {
    return undefined;
  }
  const scope = record(fields['scope']) ?? {};
  const retention = fields['retentionDays'];
  const path = str(fields['path']);
  return {
    enabled: fields['enabled'],
    scope: {
      channels: bool(scope['channels'], true),
      privateMessages: bool(scope['privateMessages'], true),
      serverNotices: bool(scope['serverNotices'], false),
    },
    format: fields['format'] === 'plaintext' ? 'plaintext' : 'sqlite',
    retentionDays: typeof retention === 'number' && retention >= 0 ? retention : 'forever',
    ...(path === undefined ? {} : { path }),
  };
}

/** One profile, or undefined when the record is not one we can use. */
export function readStoredNetwork(value: unknown): NetworkProfile | undefined {
  const fields = record(value);
  if (fields === undefined) {
    return undefined;
  }

  const id = str(fields['id']);
  const name = str(fields['name']);
  const identity = record(fields['identity']);
  const nick = str(identity?.['nick']);
  if (id === undefined || name === undefined || nick === undefined || nick === '') {
    return undefined;
  }

  const servers = list(fields['servers'])
    .map(readEndpoint)
    .filter((endpoint): endpoint is ServerEndpoint => endpoint !== undefined);
  // A network with nowhere to connect is not a network. Dropping it is clearer
  // than restoring a row that can only ever fail.
  if (servers.length === 0) {
    return undefined;
  }

  const auth = readAuth(fields['auth']);
  // A network's own logging policy, where it has one. Absent means it follows
  // the global policy, which is what a network nobody has overridden does.
  const logging = readLogging(fields['logging']);

  return {
    id,
    name,
    servers,
    identity: {
      nick,
      altNicks: list(identity?.['altNicks'])
        .map(str)
        .filter((entry): entry is string => entry !== undefined && entry !== ''),
      username: str(identity?.['username']) ?? nick,
      realname: str(identity?.['realname']) ?? nick,
    },
    ...(auth === undefined ? {} : { auth }),
    autojoin: list(fields['autojoin'])
      .map((entry) => {
        const target = str(record(entry)?.['target']);
        if (target === undefined || target === '') {
          return undefined;
        }
        const key = readSecretRef(record(entry)?.['key']);
        return key === undefined ? { target } : { target, key };
      })
      .filter((entry): entry is { target: string; key?: SecretRef } => entry !== undefined),
    connectCommands: list(fields['connectCommands'])
      .map(str)
      .filter((entry): entry is string => entry !== undefined),
    encoding: str(fields['encoding']) ?? 'utf-8',
    autoReconnect: bool(fields['autoReconnect'], true),
    ...(fields['operatorCommands'] === true ? { operatorCommands: true } : {}),
    ...(logging === undefined ? {} : { logging }),
  };
}

/** Every profile in the file, skipping any that will not load. */
export function readStoredNetworks(value: unknown): readonly NetworkProfile[] {
  return list(value)
    .map(readStoredNetwork)
    .filter((profile): profile is NetworkProfile => profile !== undefined);
}

/**
 * A profile as it goes into the file.
 *
 * Written field by field rather than by spreading the profile, so a field added
 * to `NetworkProfile` later is not silently persisted without anybody deciding
 * it should be — which is how a secret ends up in a settings file.
 */
export function writeStoredNetwork(profile: NetworkProfile): unknown {
  return {
    id: profile.id,
    name: profile.name,
    servers: profile.servers.map((endpoint) => ({
      host: endpoint.host,
      port: endpoint.port,
      tls: endpoint.tls,
    })),
    identity: {
      nick: profile.identity.nick,
      altNicks: profile.identity.altNicks,
      username: profile.identity.username,
      realname: profile.identity.realname,
    },
    ...(profile.auth === undefined ? {} : { auth: profile.auth }),
    autojoin: profile.autojoin,
    connectCommands: profile.connectCommands,
    encoding: profile.encoding,
    autoReconnect: profile.autoReconnect,
    ...(profile.operatorCommands === true ? { operatorCommands: true } : {}),
    ...(profile.logging === undefined ? {} : { logging: profile.logging }),
  };
}
