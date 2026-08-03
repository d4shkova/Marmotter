/**
 * Base64, over bytes.
 *
 * Hand-written rather than using `btoa`/`atob`, which operate on latin-1 strings
 * and mangle anything above U+00FF — SASL payloads are arbitrary bytes, and a
 * UTF-8 password would be silently corrupted.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const REVERSE = ((): Int16Array => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Encodes bytes to base64 with standard `=` padding. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    const remaining = bytes.length - i;

    out += ALPHABET[(triple >> 18) & 0x3f];
    out += ALPHABET[(triple >> 12) & 0x3f];
    out += remaining > 1 ? ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += remaining > 2 ? ALPHABET[triple & 0x3f] : '=';
  }

  return out;
}

/**
 * Decodes base64.
 *
 * Whitespace and padding are tolerated. Returns undefined for input containing
 * characters outside the alphabet, rather than guessing.
 */
export function decodeBase64(value: string): Uint8Array | undefined {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < value.length; i += 1) {
    const char = value.charCodeAt(i);
    if (char === 0x3d) {
      break; // padding
    }
    if (char === 0x20 || char === 0x09 || char === 0x0a || char === 0x0d) {
      continue;
    }
    const index = char < 128 ? (REVERSE[char] ?? -1) : -1;
    if (index === -1) {
      return undefined;
    }

    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return Uint8Array.from(bytes);
}

/** Encodes a string as UTF-8 bytes. */
export function utf8Encode(value: string): Uint8Array {
  const bytes: number[] = [];

  for (let i = 0; i < value.length; i += 1) {
    let code = value.codePointAt(i) ?? 0;
    if (code > 0xffff) {
      i += 1; // surrogate pair consumed
    } else if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd; // unpaired surrogate
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

/** Decodes UTF-8 bytes, replacing malformed sequences with U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;

  while (i < bytes.length) {
    const first = bytes[i] ?? 0;
    let code: number;
    let length: number;

    if (first < 0x80) {
      code = first;
      length = 1;
    } else if ((first & 0xe0) === 0xc0) {
      code = first & 0x1f;
      length = 2;
    } else if ((first & 0xf0) === 0xe0) {
      code = first & 0x0f;
      length = 3;
    } else if ((first & 0xf8) === 0xf0) {
      code = first & 0x07;
      length = 4;
    } else {
      out += '�';
      i += 1;
      continue;
    }

    if (i + length > bytes.length) {
      out += '�';
      break;
    }

    let valid = true;
    for (let k = 1; k < length; k += 1) {
      const next = bytes[i + k] ?? 0;
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (next & 0x3f);
    }

    if (!valid) {
      out += '�';
      i += 1;
      continue;
    }

    out += code > 0x10ffff ? '�' : String.fromCodePoint(code);
    i += length;
  }

  return out;
}
