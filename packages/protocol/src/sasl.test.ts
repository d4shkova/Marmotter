import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64, utf8Decode, utf8Encode } from './base64.js';
import {
  AUTHENTICATE_CHUNK,
  AuthenticateReassembler,
  type CryptoProvider,
  chunkAuthenticate,
  createExternalMechanism,
  createMechanism,
  createPlainMechanism,
  createScramMechanism,
  parseMechanisms,
  parseScramAttributes,
  saslPrepUsername,
  selectMechanism,
  webCryptoProvider,
} from './sasl.js';

const provider: CryptoProvider = webCryptoProvider(
  webcrypto as unknown as Parameters<typeof webCryptoProvider>[0],
);

const decoded = (payload: readonly string[]) =>
  utf8Decode(decodeBase64(payload.join('').replace(/\+$/, '')) ?? new Uint8Array());

const sent = (step: Awaited<ReturnType<ReturnType<typeof createPlainMechanism>['start']>>) => {
  if (step.kind !== 'send') {
    throw new Error(`expected a send step, got ${step.kind}`);
  }
  return step.payload;
};

describe('chunkAuthenticate', () => {
  it('sends an empty payload as a lone plus', () => {
    expect(chunkAuthenticate('')).toEqual(['+']);
  });

  it('leaves a short payload in one piece', () => {
    expect(chunkAuthenticate('abc')).toEqual(['abc']);
  });

  it('splits at 400 characters', () => {
    const payload = 'a'.repeat(401);
    expect(chunkAuthenticate(payload)).toEqual(['a'.repeat(400), 'a']);
  });

  it('appends a terminator when the length is an exact multiple of the chunk size', () => {
    const payload = 'a'.repeat(AUTHENTICATE_CHUNK);
    expect(chunkAuthenticate(payload)).toEqual([payload, '+']);
  });

  it('appends a terminator for a longer exact multiple too', () => {
    const payload = 'a'.repeat(AUTHENTICATE_CHUNK * 2);
    expect(chunkAuthenticate(payload)).toEqual([
      'a'.repeat(AUTHENTICATE_CHUNK),
      'a'.repeat(AUTHENTICATE_CHUNK),
      '+',
    ]);
  });
});

describe('AuthenticateReassembler', () => {
  it('returns the payload from a single chunk', () => {
    const reassembler = new AuthenticateReassembler();
    expect(
      utf8Decode(reassembler.push(encodeBase64(utf8Encode('hello'))) ?? new Uint8Array()),
    ).toBe('hello');
  });

  it('waits for more when a chunk is exactly the maximum length', () => {
    const reassembler = new AuthenticateReassembler();
    const payload = encodeBase64(utf8Encode('x'.repeat(600)));
    const chunks = chunkAuthenticate(payload);

    for (const chunk of chunks.slice(0, -1)) {
      expect(reassembler.push(chunk)).toBeUndefined();
    }
    const result = reassembler.push(chunks[chunks.length - 1] ?? '');
    expect(utf8Decode(result ?? new Uint8Array())).toBe('x'.repeat(600));
  });

  it('treats a lone plus as an empty payload', () => {
    expect(new AuthenticateReassembler().push('+')).toEqual(new Uint8Array());
  });

  it('can be reset mid-exchange', () => {
    const reassembler = new AuthenticateReassembler();
    reassembler.push('a'.repeat(AUTHENTICATE_CHUNK));
    reassembler.reset();
    expect(
      utf8Decode(reassembler.push(encodeBase64(utf8Encode('fresh'))) ?? new Uint8Array()),
    ).toBe('fresh');
  });
});

describe('parseMechanisms and selectMechanism', () => {
  it('reads the sasl capability value', () => {
    expect(parseMechanisms('PLAIN,EXTERNAL,SCRAM-SHA-256')).toEqual([
      'PLAIN',
      'EXTERNAL',
      'SCRAM-SHA-256',
    ]);
  });

  it('uppercases and trims', () => {
    expect(parseMechanisms(' plain , external ')).toEqual(['PLAIN', 'EXTERNAL']);
  });

  it('picks the caller preference order, not the server order', () => {
    expect(selectMechanism(['PLAIN', 'SCRAM-SHA-256'], ['SCRAM-SHA-256', 'PLAIN'])).toBe(
      'SCRAM-SHA-256',
    );
  });

  it('falls back to the first supported mechanism when the server lists none', () => {
    expect(selectMechanism([], ['PLAIN'])).toBe('PLAIN');
  });

  it('returns nothing when there is no overlap', () => {
    expect(selectMechanism(['ANONYMOUS'], ['PLAIN'])).toBeUndefined();
  });
});

describe('PLAIN', () => {
  it('encodes authzid NUL authcid NUL password', async () => {
    const mechanism = createPlainMechanism({ account: 'marmot', password: 'hunter2' });
    const payload = sent(await mechanism.start());
    expect(decoded(payload)).toBe('\0marmot\0hunter2');
  });

  it('includes an authorization identity when given', async () => {
    const mechanism = createPlainMechanism({
      account: 'marmot',
      password: 'hunter2',
      authzid: 'other',
    });
    expect(decoded(sent(await mechanism.start()))).toBe('other\0marmot\0hunter2');
  });

  it('handles a non-ASCII password without corrupting it', async () => {
    const mechanism = createPlainMechanism({ account: 'marmot', password: 'pässwörd🦫' });
    expect(decoded(sent(await mechanism.start()))).toBe('\0marmot\0pässwörd🦫');
  });

  it('fails when no account is configured', async () => {
    const step = await createPlainMechanism({ password: 'x' }).start();
    expect(step.kind).toBe('failed');
  });

  it('chunks a long credential correctly', async () => {
    const mechanism = createPlainMechanism({ account: 'a'.repeat(400), password: 'b'.repeat(400) });
    const payload = sent(await mechanism.start());
    expect(payload.length).toBeGreaterThan(1);
    expect(payload[0]?.length).toBe(AUTHENTICATE_CHUNK);
    expect(decoded(payload)).toBe(`\0${'a'.repeat(400)}\0${'b'.repeat(400)}`);
  });
});

describe('EXTERNAL', () => {
  it('sends an empty payload by default', async () => {
    expect(sent(await createExternalMechanism().start())).toEqual(['+']);
  });

  it('sends the authorization identity when one is configured', async () => {
    const mechanism = createExternalMechanism({ authzid: 'marmot' });
    expect(decoded(sent(await mechanism.start()))).toBe('marmot');
  });
});

describe('SCRAM-SHA-256', () => {
  it('produces the RFC 7677 test vector', async () => {
    // RFC 7677 section 3, with the nonce fixed to the value from the RFC.
    const mechanism = createScramMechanism(
      { account: 'user', password: 'pencil' },
      provider,
      'rOprNGfwEbeRWgbNEkqO',
    );

    const first = sent(await mechanism.start());
    expect(decoded(first)).toBe('n,,n=user,r=rOprNGfwEbeRWgbNEkqO');

    const serverFirst =
      'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,' + 's=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
    const step = await mechanism.respond(utf8Encode(serverFirst));
    expect(step.kind).toBe('send');
    if (step.kind !== 'send') {
      return;
    }

    expect(decoded(step.payload)).toBe(
      'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,' +
        'p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=',
    );

    const serverFinal = 'v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=';
    expect(await mechanism.respond(utf8Encode(serverFinal))).toEqual({ kind: 'await-outcome' });
  });

  it('rejects a server nonce that does not extend the client nonce', async () => {
    const mechanism = createScramMechanism(
      { account: 'user', password: 'pencil' },
      provider,
      'clientnonce',
    );
    await mechanism.start();

    const step = await mechanism.respond(
      utf8Encode('r=different,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096'),
    );
    expect(step).toEqual({
      kind: 'failed',
      reason: 'Server nonce did not extend the client nonce',
    });
  });

  it('rejects a bad server signature, so a hostile server cannot complete the exchange', async () => {
    const mechanism = createScramMechanism(
      { account: 'user', password: 'pencil' },
      provider,
      'rOprNGfwEbeRWgbNEkqO',
    );
    await mechanism.start();
    await mechanism.respond(
      utf8Encode(
        'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,' +
          's=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
      ),
    );

    const step = await mechanism.respond(
      utf8Encode('v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
    );
    expect(step.kind).toBe('failed');
    if (step.kind === 'failed') {
      expect(step.reason).toContain('Server signature did not verify');
    }
  });

  it('reports a server error attribute', async () => {
    const mechanism = createScramMechanism({ account: 'user', password: 'x' }, provider, 'nonce');
    await mechanism.start();

    const step = await mechanism.respond(utf8Encode('e=unknown-user'));
    expect(step.kind).toBe('failed');
    if (step.kind === 'failed') {
      expect(step.reason).toContain('unknown-user');
    }
  });

  it('rejects a malformed challenge', async () => {
    const mechanism = createScramMechanism({ account: 'user', password: 'x' }, provider, 'nonce');
    await mechanism.start();

    const step = await mechanism.respond(utf8Encode('r=nonceXYZ,s=!!!notbase64,i=notanumber'));
    expect(step.kind).toBe('failed');
  });

  it('fails without an account', async () => {
    const mechanism = createScramMechanism({ password: 'x' }, provider);
    expect((await mechanism.start()).kind).toBe('failed');
  });

  it('generates a distinct nonce per exchange', async () => {
    const first = sent(await createScramMechanism({ account: 'u' }, provider).start());
    const second = sent(await createScramMechanism({ account: 'u' }, provider).start());
    expect(decoded(first)).not.toBe(decoded(second));
  });
});

describe('saslPrepUsername', () => {
  it('escapes the SCRAM separators', () => {
    expect(saslPrepUsername('a=b,c')).toBe('a=3Db=2Cc');
  });

  it('leaves an ordinary name alone', () => {
    expect(saslPrepUsername('marmot')).toBe('marmot');
  });
});

describe('parseScramAttributes', () => {
  it('splits key=value pairs, keeping values containing equals signs', () => {
    const attributes = parseScramAttributes('r=abc,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096');
    expect(attributes.get('r')).toBe('abc');
    expect(attributes.get('s')).toBe('W22ZaJ0SNY7soEsUEjb6gQ==');
    expect(attributes.get('i')).toBe('4096');
  });
});

describe('createMechanism', () => {
  it('builds each supported mechanism', () => {
    expect(createMechanism('PLAIN', { account: 'a' })?.name).toBe('PLAIN');
    expect(createMechanism('EXTERNAL', {})?.name).toBe('EXTERNAL');
    expect(createMechanism('SCRAM-SHA-256', { account: 'a' }, provider)?.name).toBe(
      'SCRAM-SHA-256',
    );
  });

  it('declines SCRAM when no crypto provider is available', () => {
    expect(createMechanism('SCRAM-SHA-256', { account: 'a' })).toBeUndefined();
  });
});
