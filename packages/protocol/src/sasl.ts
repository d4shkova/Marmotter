/**
 * SASL authentication: PLAIN, EXTERNAL, and SCRAM-SHA-256.
 *
 * https://ircv3.net/specs/extensions/sasl-3.1
 *
 * The AUTHENTICATE payload is base64 and is chunked at 400 bytes. A payload
 * whose length is an exact multiple of 400 must be followed by a lone `+`, or
 * the server cannot tell the message ended.
 *
 * SCRAM uses WebCrypto for hashing and key derivation. That is a platform API,
 * not a package dependency, and hand-rolling SHA-256 or PBKDF2 would be a far
 * worse idea than depending on the platform's vetted implementation.
 */

import { decodeBase64, encodeBase64, utf8Decode, utf8Encode } from './base64.js';

/** Maximum bytes of base64 payload per AUTHENTICATE line. */
export const AUTHENTICATE_CHUNK = 400;

export type SaslMechanismName = 'PLAIN' | 'EXTERNAL' | 'SCRAM-SHA-256';

export interface SaslCredentials {
  /** Authentication identity. Unused by EXTERNAL. */
  readonly account?: string;
  readonly password?: string;
  /** Authorization identity, when it differs from the account. */
  readonly authzid?: string;
}

/** What the caller should do next after a step. */
export type SaslStep =
  /** Send this payload, already chunked into AUTHENTICATE arguments. */
  | { readonly kind: 'send'; readonly payload: readonly string[] }
  /** The mechanism has said all it needs to; wait for the server's verdict. */
  | { readonly kind: 'await-outcome' }
  /** Authentication failed locally, before the server replied. */
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * A SASL mechanism as a resumable exchange.
 *
 * `start` produces the initial response; `respond` handles each server
 * challenge. Both are async because SCRAM needs WebCrypto.
 */
export interface SaslMechanism {
  readonly name: SaslMechanismName;
  start(): Promise<SaslStep>;
  respond(challenge: Uint8Array): Promise<SaslStep>;
  /** Verifies the server's final message, where the mechanism defines one. */
  finish?(): SaslStep;
}

/**
 * Splits a base64 payload into AUTHENTICATE arguments.
 *
 * An empty payload is sent as `+`. A payload that divides exactly by the chunk
 * size gets a trailing `+` so the server sees an explicit terminator.
 */
export function chunkAuthenticate(payload: string): readonly string[] {
  if (payload === '') {
    return ['+'];
  }

  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += AUTHENTICATE_CHUNK) {
    chunks.push(payload.slice(i, i + AUTHENTICATE_CHUNK));
  }
  if (payload.length % AUTHENTICATE_CHUNK === 0) {
    chunks.push('+');
  }
  return chunks;
}

/**
 * Reassembles AUTHENTICATE arguments into payload bytes.
 *
 * Returns undefined while the payload is still incomplete — a chunk of exactly
 * the maximum length means more is coming.
 */
export class AuthenticateReassembler {
  private buffer = '';

  /** Feeds one AUTHENTICATE argument. Returns the payload once complete. */
  push(argument: string): Uint8Array | undefined {
    if (argument === '+') {
      const decoded = decodeBase64(this.buffer);
      this.buffer = '';
      return decoded ?? new Uint8Array();
    }

    this.buffer += argument;
    if (argument.length === AUTHENTICATE_CHUNK) {
      return undefined;
    }

    const decoded = decodeBase64(this.buffer);
    this.buffer = '';
    return decoded ?? new Uint8Array();
  }

  reset(): void {
    this.buffer = '';
  }
}

/** Which mechanisms the server advertises via the `sasl` capability value. */
export function parseMechanisms(capValue: string): readonly string[] {
  return capValue
    .split(',')
    .map((name) => name.trim().toUpperCase())
    .filter((name) => name !== '');
}

/**
 * Picks the strongest mechanism both sides support.
 *
 * SCRAM is preferred because it never sends the password; EXTERNAL is only
 * chosen when the profile is configured for a client certificate.
 */
export function selectMechanism(
  advertised: readonly string[],
  supported: readonly SaslMechanismName[],
): SaslMechanismName | undefined {
  // An empty advertisement means the server did not say, so try anyway.
  if (advertised.length === 0) {
    return supported[0];
  }
  return supported.find((name) => advertised.includes(name));
}

/** SASL PLAIN: `authzid NUL authcid NUL password`. */
export function createPlainMechanism(credentials: SaslCredentials): SaslMechanism {
  return {
    name: 'PLAIN',
    start: () => {
      const account = credentials.account ?? '';
      const password = credentials.password ?? '';
      if (account === '') {
        return Promise.resolve<SaslStep>({ kind: 'failed', reason: 'No account name configured' });
      }

      const authzid = credentials.authzid ?? '';
      const bytes = utf8Encode(`${authzid}\0${account}\0${password}`);
      return Promise.resolve<SaslStep>({
        kind: 'send',
        payload: chunkAuthenticate(encodeBase64(bytes)),
      });
    },
    respond: () => Promise.resolve<SaslStep>({ kind: 'await-outcome' }),
  };
}

/** SASL EXTERNAL: the TLS client certificate is the credential (CertFP). */
export function createExternalMechanism(credentials: SaslCredentials = {}): SaslMechanism {
  return {
    name: 'EXTERNAL',
    start: () => {
      const authzid = credentials.authzid ?? '';
      return Promise.resolve<SaslStep>({
        kind: 'send',
        payload: chunkAuthenticate(authzid === '' ? '' : encodeBase64(utf8Encode(authzid))),
      });
    },
    respond: () => Promise.resolve<SaslStep>({ kind: 'await-outcome' }),
  };
}

/** The WebCrypto surface SCRAM needs, so tests can supply their own. */
export interface CryptoProvider {
  digest(data: Uint8Array): Promise<Uint8Array>;
  hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  pbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array>;
  randomBytes(length: number): Uint8Array;
}

/**
 * `BufferSource` lives in the DOM library, which this package deliberately does
 * not load — protocol code must compile against the ES2022 core alone.
 */
type BinarySource = ArrayBufferView | ArrayBuffer;

interface SubtleLike {
  digest(algorithm: string, data: BinarySource): Promise<ArrayBuffer>;
  importKey(
    format: string,
    keyData: BinarySource,
    algorithm: unknown,
    extractable: boolean,
    usages: readonly string[],
  ): Promise<unknown>;
  sign(algorithm: unknown, key: unknown, data: BinarySource): Promise<ArrayBuffer>;
  deriveBits(algorithm: unknown, key: unknown, length: number): Promise<ArrayBuffer>;
}

interface CryptoLike {
  subtle: SubtleLike;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/**
 * The platform WebCrypto implementation.
 *
 * Resolved lazily so importing this module never fails on a platform without
 * it; only SCRAM needs it, and SCRAM is optional.
 */
export function webCryptoProvider(crypto: CryptoLike): CryptoProvider {
  const view = (buffer: ArrayBuffer): Uint8Array => new Uint8Array(buffer);
  const source = (bytes: Uint8Array): BinarySource => bytes as unknown as BinarySource;

  return {
    digest: async (data) => view(await crypto.subtle.digest('SHA-256', source(data))),
    hmac: async (key, data) => {
      const imported = await crypto.subtle.importKey(
        'raw',
        source(key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      return view(await crypto.subtle.sign('HMAC', imported, source(data)));
    },
    pbkdf2: async (password, salt, iterations) => {
      const imported = await crypto.subtle.importKey('raw', source(password), 'PBKDF2', false, [
        'deriveBits',
      ]);
      return view(
        await crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: source(salt), iterations },
          imported,
          256,
        ),
      );
    },
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  };
}

const xor = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return out;
};

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
};

/** Escapes `=` and `,` in a SCRAM username, which uses them as separators. */
export function saslPrepUsername(value: string): string {
  return value.replace(/=/g, '=3D').replace(/,/g, '=2C');
}

/** Splits a SCRAM message into its `key=value` attributes. */
export function parseScramAttributes(message: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const part of message.split(',')) {
    const equals = part.indexOf('=');
    if (equals > 0) {
      attributes.set(part.slice(0, equals), part.slice(equals + 1));
    }
  }
  return attributes;
}

/**
 * SCRAM-SHA-256, per RFC 5802 and RFC 7677.
 *
 * The password never leaves the client: the server sees only proofs derived
 * from it, and the client verifies the server's proof in return, so a hostile
 * server cannot complete the exchange.
 */
export function createScramMechanism(
  credentials: SaslCredentials,
  provider: CryptoProvider,
  nonceOverride?: string,
): SaslMechanism {
  let clientNonce = '';
  let clientFirstBare = '';
  let expectedServerSignature: Uint8Array | undefined;
  let failed: string | undefined;

  const gs2Header = 'n,,';

  return {
    name: 'SCRAM-SHA-256',

    start: () => {
      const account = credentials.account ?? '';
      if (account === '') {
        return Promise.resolve<SaslStep>({ kind: 'failed', reason: 'No account name configured' });
      }

      clientNonce = nonceOverride ?? encodeBase64(provider.randomBytes(24));
      clientFirstBare = `n=${saslPrepUsername(account)},r=${clientNonce}`;

      return Promise.resolve<SaslStep>({
        kind: 'send',
        payload: chunkAuthenticate(encodeBase64(utf8Encode(gs2Header + clientFirstBare))),
      });
    },

    respond: async (challenge) => {
      if (failed !== undefined) {
        return { kind: 'failed', reason: failed };
      }

      const text = utf8Decode(challenge);

      // The final server message carries the signature, not another challenge.
      if (expectedServerSignature !== undefined) {
        const attributes = parseScramAttributes(text);
        const error = attributes.get('e');
        if (error !== undefined) {
          return { kind: 'failed', reason: `Server rejected authentication: ${error}` };
        }

        const verifier = decodeBase64(attributes.get('v') ?? '');
        if (verifier === undefined || !equalBytes(verifier, expectedServerSignature)) {
          return {
            kind: 'failed',
            reason: 'Server signature did not verify; the server does not know the password',
          };
        }
        return { kind: 'await-outcome' };
      }

      const attributes = parseScramAttributes(text);
      const error = attributes.get('e');
      if (error !== undefined) {
        return { kind: 'failed', reason: `Server rejected authentication: ${error}` };
      }

      const serverNonce = attributes.get('r') ?? '';
      const saltValue = attributes.get('s') ?? '';
      const iterationValue = attributes.get('i') ?? '';

      if (serverNonce === '' || !serverNonce.startsWith(clientNonce)) {
        return { kind: 'failed', reason: 'Server nonce did not extend the client nonce' };
      }

      const salt = decodeBase64(saltValue);
      const iterations = Number.parseInt(iterationValue, 10);
      if (salt === undefined || !Number.isSafeInteger(iterations) || iterations < 1) {
        return { kind: 'failed', reason: 'Server sent a malformed SCRAM challenge' };
      }

      const password = utf8Encode(credentials.password ?? '');
      const saltedPassword = await provider.pbkdf2(password, salt, iterations);

      const clientKey = await provider.hmac(saltedPassword, utf8Encode('Client Key'));
      const storedKey = await provider.digest(clientKey);
      const serverKey = await provider.hmac(saltedPassword, utf8Encode('Server Key'));

      const channelBinding = encodeBase64(utf8Encode(gs2Header));
      const clientFinalWithoutProof = `c=${channelBinding},r=${serverNonce}`;
      const authMessage = `${clientFirstBare},${text},${clientFinalWithoutProof}`;

      const clientSignature = await provider.hmac(storedKey, utf8Encode(authMessage));
      const clientProof = xor(clientKey, clientSignature);
      expectedServerSignature = await provider.hmac(serverKey, utf8Encode(authMessage));

      const clientFinal = `${clientFinalWithoutProof},p=${encodeBase64(clientProof)}`;
      return { kind: 'send', payload: chunkAuthenticate(encodeBase64(utf8Encode(clientFinal))) };
    },
  };
}

/** Builds the mechanism named, or undefined when it is not supported. */
export function createMechanism(
  name: SaslMechanismName,
  credentials: SaslCredentials,
  provider?: CryptoProvider,
): SaslMechanism | undefined {
  switch (name) {
    case 'PLAIN':
      return createPlainMechanism(credentials);
    case 'EXTERNAL':
      return createExternalMechanism(credentials);
    case 'SCRAM-SHA-256':
      return provider === undefined ? undefined : createScramMechanism(credentials, provider);
  }
}
