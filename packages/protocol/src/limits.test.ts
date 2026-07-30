import { describe, expect, it } from 'vitest';
import { CRLF_BYTES, MAX_MESSAGE_BYTES, fitsMessageLimit, utf8ByteLength } from './limits.js';

describe('utf8ByteLength', () => {
  it('counts ASCII as one byte per character', () => {
    expect(utf8ByteLength('PRIVMSG #marmotter :hello')).toBe(25);
  });

  it('counts two-byte sequences', () => {
    expect(utf8ByteLength('é')).toBe(2);
  });

  it('counts three-byte sequences', () => {
    expect(utf8ByteLength('☃')).toBe(3);
  });

  it('counts a surrogate pair as one four-byte sequence', () => {
    expect(utf8ByteLength('🦫')).toBe(4);
  });

  it('counts a lone high surrogate as the replacement character', () => {
    expect(utf8ByteLength('\ud83e')).toBe(3);
  });

  it('counts a high surrogate followed by a non-surrogate as three bytes plus the next', () => {
    expect(utf8ByteLength('\ud83eA')).toBe(4);
  });

  it('returns zero for an empty string', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('fitsMessageLimit', () => {
  it('accepts a line exactly at the limit once CRLF is counted', () => {
    expect(fitsMessageLimit('a'.repeat(MAX_MESSAGE_BYTES - CRLF_BYTES))).toBe(true);
  });

  it('rejects a line one byte over the limit', () => {
    expect(fitsMessageLimit('a'.repeat(MAX_MESSAGE_BYTES - CRLF_BYTES + 1))).toBe(false);
  });

  it('measures multi-byte characters in bytes, not code units', () => {
    // 171 code units, well under the limit, but 513 bytes once encoded.
    expect(fitsMessageLimit('☃'.repeat(171))).toBe(false);
    expect(fitsMessageLimit('☃'.repeat(170))).toBe(true);
  });
});
