import { describe, expect, it } from 'vitest';
import { decodeCtcp } from './ctcp.js';
import { buildPassiveAccept, parseDccSend, sanitizeDccFilename, type DccSend } from './dcc.js';

/** Parses the CTCP out of a raw PRIVMSG body, as the reducer does. */
function offer(body: string): DccSend | undefined {
  const ctcp = decodeCtcp(body);
  return ctcp === undefined ? undefined : parseDccSend(ctcp);
}

const CTCP = '\x01';

describe('parseDccSend', () => {
  it('parses the classic integer-address form', () => {
    // 3232235777 = 192.168.1.1
    const send = offer(`${CTCP}DCC SEND holiday.jpg 3232235777 5000 204800${CTCP}`);
    expect(send).toEqual({
      filename: 'holiday.jpg',
      host: '192.168.1.1',
      port: 5000,
      size: 204800,
      passive: false,
      secure: false,
      turbo: false,
    });
  });

  it('converts the low and high ends of the integer range', () => {
    expect(offer(`${CTCP}DCC SEND a 0 1 1${CTCP}`)?.host).toBe('0.0.0.0');
    expect(offer(`${CTCP}DCC SEND a 4294967295 1 1${CTCP}`)?.host).toBe('255.255.255.255');
  });

  it('accepts a dotted IPv4 address unchanged', () => {
    expect(offer(`${CTCP}DCC SEND a 203.0.113.9 6000 10${CTCP}`)?.host).toBe('203.0.113.9');
  });

  it('accepts an IPv6 address, with or without brackets', () => {
    expect(offer(`${CTCP}DCC SEND a 2001:db8::1 6000 10${CTCP}`)?.host).toBe('2001:db8::1');
    expect(offer(`${CTCP}DCC SEND a [2001:db8::1] 6000 10${CTCP}`)?.host).toBe('2001:db8::1');
  });

  it('reads a quoted filename that contains spaces', () => {
    const send = offer(`${CTCP}DCC SEND "my holiday photos.zip" 3232235777 5000 1${CTCP}`);
    expect(send?.filename).toBe('my holiday photos.zip');
    expect(send?.port).toBe(5000);
  });

  it('treats an unterminated quote as running to the end of the name', () => {
    // Without the trailing quote there is nothing after the filename; such a
    // line has no address and is not a usable offer.
    expect(offer(`${CTCP}DCC SEND "no closing quote 1 2 3${CTCP}`)).toBeUndefined();
  });

  it('marks a passive (reverse) offer and keeps its token', () => {
    const send = offer(`${CTCP}DCC SEND file.bin 3232235777 0 4096 998877${CTCP}`);
    expect(send?.passive).toBe(true);
    expect(send?.port).toBe(0);
    expect(send?.token).toBe('998877');
  });

  it('tolerates a missing size', () => {
    const send = offer(`${CTCP}DCC SEND file.bin 3232235777 5000${CTCP}`);
    expect(send?.size).toBeUndefined();
    expect(send?.host).toBe('192.168.1.1');
  });

  it('accepts the TSEND and SSEND variants', () => {
    expect(offer(`${CTCP}DCC TSEND f 3232235777 5000 1${CTCP}`)?.filename).toBe('f');
    expect(offer(`${CTCP}DCC SSEND f 3232235777 5000 1${CTCP}`)?.filename).toBe('f');
  });

  it('is case-insensitive on the subcommand', () => {
    expect(offer(`${CTCP}DCC send f 3232235777 5000 1${CTCP}`)?.filename).toBe('f');
  });

  it('returns undefined for a non-SEND DCC subcommand', () => {
    expect(offer(`${CTCP}DCC CHAT chat 3232235777 5000${CTCP}`)).toBeUndefined();
    expect(offer(`${CTCP}DCC RESUME f 5000 100${CTCP}`)).toBeUndefined();
  });

  it('returns undefined for a non-DCC CTCP', () => {
    expect(offer(`${CTCP}VERSION${CTCP}`)).toBeUndefined();
    expect(offer(`${CTCP}ACTION waves${CTCP}`)).toBeUndefined();
  });

  it('rejects a bare DCC with no subcommand', () => {
    const ctcp = decodeCtcp(`${CTCP}DCC${CTCP}`);
    expect(ctcp === undefined ? undefined : parseDccSend(ctcp)).toBeUndefined();
  });

  it('rejects a garbage address', () => {
    expect(offer(`${CTCP}DCC SEND f not-an-address 5000 1${CTCP}`)).toBeUndefined();
  });

  it('rejects an integer address beyond the 32-bit range', () => {
    expect(offer(`${CTCP}DCC SEND f 4294967296 5000 1${CTCP}`)).toBeUndefined();
  });

  it('rejects a non-numeric or out-of-range port', () => {
    expect(offer(`${CTCP}DCC SEND f 3232235777 notaport 1${CTCP}`)).toBeUndefined();
    expect(offer(`${CTCP}DCC SEND f 3232235777 70000 1${CTCP}`)).toBeUndefined();
  });

  it('rejects an offer with no address at all', () => {
    expect(offer(`${CTCP}DCC SEND lonely${CTCP}`)).toBeUndefined();
  });
});

describe('sanitizeDccFilename', () => {
  it('keeps an ordinary name', () => {
    expect(sanitizeDccFilename('holiday.jpg')).toBe('holiday.jpg');
  });

  it('strips any directory part so a file cannot escape the folder', () => {
    expect(sanitizeDccFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeDccFilename('/absolute/path/thing.txt')).toBe('thing.txt');
    expect(sanitizeDccFilename('..\\..\\windows\\system32\\evil.dll')).toBe('evil.dll');
  });

  it('removes reserved punctuation but keeps spaces, which are legitimate', () => {
    expect(sanitizeDccFilename('a b:c*.txt')).toBe('a bc.txt');
  });

  it('falls back to a safe name for empty or dot names', () => {
    expect(sanitizeDccFilename('')).toBe('download');
    expect(sanitizeDccFilename('..')).toBe('download');
    expect(sanitizeDccFilename('.')).toBe('download');
    expect(sanitizeDccFilename('/')).toBe('download');
  });
});

describe('the send variants', () => {
  it('marks a secure offer, which is a TLS socket rather than a plain one', () => {
    const send = offer(`${CTCP}DCC SSEND f 3232235777 5000 1${CTCP}`);
    expect(send?.secure).toBe(true);
    expect(send?.turbo).toBe(false);
  });

  it('marks a turbo offer, where the sender never reads our acknowledgements', () => {
    const send = offer(`${CTCP}DCC TSEND f 3232235777 5000 1${CTCP}`);
    expect(send?.turbo).toBe(true);
    expect(send?.secure).toBe(false);
  });

  it('reads an offer that is both', () => {
    expect(offer(`${CTCP}DCC TSSEND f 3232235777 5000 1${CTCP}`)).toMatchObject({
      secure: true,
      turbo: true,
    });
  });

  it('leaves an ordinary send as neither', () => {
    expect(offer(`${CTCP}DCC SEND f 3232235777 5000 1${CTCP}`)).toMatchObject({
      secure: false,
      turbo: false,
    });
  });
});

describe('buildPassiveAccept', () => {
  it('answers with our own address and port, and the offer’s token', () => {
    expect(
      buildPassiveAccept({
        filename: 'holiday.jpg',
        host: '192.168.1.1',
        port: 5000,
        size: 204800,
        token: '998877',
      }),
    ).toBe('SEND holiday.jpg 3232235777 5000 204800 998877');
  });

  it('quotes a name that would otherwise split into two fields', () => {
    const reply = buildPassiveAccept({
      filename: 'my holiday.jpg',
      host: '10.0.0.1',
      port: 1,
      token: 't',
    });
    expect(reply).toBe('SEND "my holiday.jpg" 167772161 1 t');
  });

  it('sends an IPv6 address as the literal, having no integer form', () => {
    expect(buildPassiveAccept({ filename: 'f', host: '2001:db8::1', port: 2, token: 't' })).toBe(
      'SEND f 2001:db8::1 2 t',
    );
  });

  it('round-trips through the parser', () => {
    const params = buildPassiveAccept({
      filename: 'f.bin',
      host: '203.0.113.9',
      port: 6000,
      size: 42,
      token: 'abc',
    });
    expect(parseDccSend({ command: 'DCC', params })).toMatchObject({
      filename: 'f.bin',
      host: '203.0.113.9',
      port: 6000,
      size: 42,
      token: 'abc',
      passive: false,
    });
  });
});
