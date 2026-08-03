/**
 * Network profile schema, as specified in CLAUDE.md.
 *
 * Multi-network is a day-one requirement: everything downstream is keyed by
 * `NetworkProfile.id`. There is deliberately no "current server" concept here.
 */

/**
 * An opaque handle to a secret. The secret itself never lives in profile state.
 *
 * On desktop and Android it resolves against the OS keychain; on web it resolves
 * against an in-memory session store that is discarded when the tab closes.
 */
export interface SecretRef {
  readonly kind: 'secret-ref';
  /** Stable key within the platform's secret store. */
  readonly id: string;
}

export type TlsConfig =
  | { mode: 'off' }
  | { mode: 'tls'; verifyCert: true }
  | { mode: 'tls'; verifyCert: false; pinnedFingerprint?: string }
  | { mode: 'websocket'; url: string };

export interface ServerEndpoint {
  host: string;
  port: number;
  tls: TlsConfig;
}

export interface Identity {
  nick: string;
  altNicks: string[];
  username: string;
  realname: string;
}

export type AuthConfig =
  | { type: 'sasl-plain'; account: string; password: SecretRef }
  | { type: 'sasl-external'; certPath: string }
  | { type: 'sasl-scram'; account: string; password: SecretRef }
  | { type: 'server-password'; password: SecretRef }
  | { type: 'nickserv'; account: string; password: SecretRef };

export interface AutojoinTarget {
  target: string;
  key?: SecretRef;
}

export interface LoggingPolicy {
  enabled: boolean;
  scope: {
    channels: boolean;
    privateMessages: boolean;
    serverNotices: boolean;
  };
  /** `plaintext` mirrors HexChat's on-disk layout. */
  format: 'sqlite' | 'plaintext';
  retentionDays: number | 'forever';
  /** Defaults to the platform app-data directory when unset. */
  path?: string;
}

export interface NetworkProfile {
  id: string;
  /** Display name, e.g. "Libera.Chat". */
  name: string;
  /** Tried in order, with backoff. */
  servers: ServerEndpoint[];
  identity: Identity;
  auth?: AuthConfig;
  autojoin: AutojoinTarget[];
  /** Raw lines sent after registration completes. */
  connectCommands: string[];
  /** Defaults to 'utf-8'; overridable for legacy networks. */
  encoding: string;
  autoReconnect: boolean;
  logging: LoggingPolicy;
}

/** Logging is off by default, everywhere. The user opts in explicitly. */
export const defaultLoggingPolicy: LoggingPolicy = {
  enabled: false,
  scope: { channels: true, privateMessages: true, serverNotices: false },
  format: 'sqlite',
  retentionDays: 'forever',
};

/** A new endpoint defaults to TLS on port 6697 with certificate verification on. */
export const defaultServerEndpoint = (host: string): ServerEndpoint => ({
  host,
  port: 6697,
  tls: { mode: 'tls', verifyCert: true },
});
