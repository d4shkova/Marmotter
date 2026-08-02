import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64, utf8Decode, utf8Encode } from './base64.js';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('encodeBase64', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j as %j (RFC 4648 vectors)', (input, expected) => {
    expect(encodeBase64(utf8Encode(input))).toBe(expected);
  });

  it('encodes bytes above 0x7f without mangling them', () => {
    expect(encodeBase64(bytes(0xff, 0xfe, 0xfd))).toBe('//79');
  });

  it('encodes NUL bytes, which SASL PLAIN depends on', () => {
    expect(encodeBase64(bytes(0x00, 0x61, 0x00, 0x62))).toBe('AGEAYg==');
  });
});

describe('decodeBase64', () => {
  it.each(['', 'Zg==', 'Zm8=', 'Zm9v', 'Zm9vYg==', 'Zm9vYmE=', 'Zm9vYmFy'])(
    'round-trips %j',
    (encoded) => {
      const decoded = decodeBase64(encoded);
      expect(decoded).toBeDefined();
      expect(encodeBase64(decoded ?? new Uint8Array())).toBe(encoded);
    },
  );

  it('tolerates whitespace', () => {
    expect(utf8Decode(decodeBase64('Zm9v YmFy') ?? new Uint8Array())).toBe('foobar');
  });

  it('tolerates missing padding', () => {
    expect(utf8Decode(decodeBase64('Zm9vYmE') ?? new Uint8Array())).toBe('fooba');
  });

  it('rejects characters outside the alphabet rather than guessing', () => {
    expect(decodeBase64('not base64!')).toBeUndefined();
    expect(decodeBase64('Zm9v#')).toBeUndefined();
  });
});

describe('utf8Encode and utf8Decode', () => {
  it.each(['', 'ascii', 'héllo', '☃ snowman', '🦫 marmot', 'mixed é☃🦫 text'])(
    'round-trips %j',
    (value) => {
      expect(utf8Decode(utf8Encode(value))).toBe(value);
    },
  );

  it('matches the expected byte lengths', () => {
    expect(utf8Encode('a').length).toBe(1);
    expect(utf8Encode('é').length).toBe(2);
    expect(utf8Encode('☃').length).toBe(3);
    expect(utf8Encode('🦫').length).toBe(4);
  });

  it('replaces an unpaired surrogate rather than emitting invalid UTF-8', () => {
    const encoded = utf8Encode('\ud83e');
    expect(encoded.length).toBe(3);
    expect(utf8Decode(encoded)).toBe('�');
  });

  it('replaces malformed input on decode rather than throwing', () => {
    expect(utf8Decode(bytes(0xff))).toBe('�');
    expect(utf8Decode(bytes(0xc3))).toBe('�');
    expect(utf8Decode(bytes(0xe2, 0x28, 0xa1))).toContain('�');
  });

  it('preserves NUL bytes', () => {
    expect(utf8Encode('a\0b')).toEqual(bytes(0x61, 0x00, 0x62));
    expect(utf8Decode(bytes(0x61, 0x00, 0x62))).toBe('a\0b');
  });
});
