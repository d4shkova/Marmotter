import { describe, expect, it } from 'vitest';
import { decodeCtcp } from './ctcp.js';
import {
  buildDccResume,
  buildPassiveAccept,
  isDialableHost,
  isPrivateAddress,
  parseDccAccept,
  parseDccSend,
  publicAddressFor,
  sanitizeDccFilename,
  type DccSend,
} from './dcc.js';

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

describe('resuming a transfer', () => {
  it('asks for a position, naming the offer by its port', () => {
    expect(buildDccResume({ filename: 'big.bin', port: 5000, position: 1024 })).toBe(
      'RESUME big.bin 5000 1024',
    );
  });

  it('names a passive offer by its token, since it has no port', () => {
    expect(buildDccResume({ filename: 'big.bin', port: 0, position: 1024, token: '998877' })).toBe(
      'RESUME big.bin 0 1024 998877',
    );
  });

  it('quotes a name that would otherwise split into two fields', () => {
    expect(buildDccResume({ filename: 'my file.bin', port: 1, position: 2 })).toBe(
      'RESUME "my file.bin" 1 2',
    );
  });

  it('reads the position the sender agreed to', () => {
    expect(parseDccAccept({ command: 'DCC', params: 'ACCEPT big.bin 5000 1024' })).toEqual({
      filename: 'big.bin',
      port: 5000,
      position: 1024,
    });
  });

  it('reads a passive acceptance, token and all', () => {
    expect(parseDccAccept({ command: 'DCC', params: 'ACCEPT "my file.bin" 0 512 998877' })).toEqual(
      { filename: 'my file.bin', port: 0, position: 512, token: '998877' },
    );
  });

  it('is undefined for anything that is not an acceptance', () => {
    expect(parseDccAccept({ command: 'DCC', params: 'SEND f 1 2 3' })).toBeUndefined();
    expect(parseDccAccept({ command: 'PING', params: 'ACCEPT f 1 2' })).toBeUndefined();
    expect(parseDccAccept({ command: 'DCC', params: 'ACCEPT f 1' })).toBeUndefined();
    expect(parseDccAccept({ command: 'DCC', params: 'ACCEPT f x y' })).toBeUndefined();
  });
});

describe('the address field', () => {
  it('accepts a hostname, which some senders advertise instead of an address', () => {
    const send = offer(`${CTCP}DCC SEND f.bin dcc.example.net 5000 1${CTCP}`);
    expect(send?.host).toBe('dcc.example.net');
  });

  it('still refuses something that is no kind of address at all', () => {
    expect(offer(`${CTCP}DCC SEND f.bin -- 5000 1${CTCP}`)).toBeUndefined();
    expect(offer(`${CTCP}DCC SEND f.bin ../etc 5000 1${CTCP}`)).toBeUndefined();
    expect(offer(`${CTCP}DCC SEND f.bin localhost 5000 1${CTCP}`)).toBeUndefined();
  });
});

describe('isPrivateAddress', () => {
  it('knows the addresses that only work on the sender’s own network', () => {
    expect(isPrivateAddress('192.168.1.103')).toBe(true);
    expect(isPrivateAddress('10.0.0.5')).toBe(true);
    expect(isPrivateAddress('172.16.4.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('169.254.10.1')).toBe(true);
    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
  });

  it('leaves a public address alone', () => {
    expect(isPrivateAddress('81.42.231.7')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2001:db8::1')).toBe(false);
    expect(isPrivateAddress('dcc.example.net')).toBe(false);
  });
});

describe('a sender that advertised an address only its own network can reach', () => {
  it("offers the sender's own host as the address to try instead", () => {
    expect(publicAddressFor('192.168.1.50', 'bot.example.net')).toBe('bot.example.net');
    expect(publicAddressFor('10.0.0.4', '203.0.113.25')).toBe('203.0.113.25');
    expect(publicAddressFor('172.16.3.9', 'files.example.org')).toBe('files.example.org');
  });

  // The important half. An offer whose address is publicly routable has nothing
  // wrong with it that a different address would fix, and a transfer that failed
  // for some other reason must not be retried elsewhere and then reported as
  // though the address had been the problem.
  it('leaves a publicly routable offer alone', () => {
    expect(publicAddressFor('203.0.113.25', 'bot.example.net')).toBeUndefined();
    expect(publicAddressFor('example.net', 'bot.example.net')).toBeUndefined();
  });

  // A cloak is a label the ircd made up to hide the real host. It resolves to
  // nothing, and dialling it is a lookup that cannot succeed.
  it.each(['user/bot', 'Rizon/staff/alice', 'unaffiliated/somebody'])(
    'will not dial the cloak %s',
    (cloak) => {
      expect(isDialableHost(cloak)).toBe(false);
      expect(publicAddressFor('192.168.1.50', cloak)).toBeUndefined();
    },
  );

  // Both addresses being on the sender's own network is one unreachable place,
  // not two — swapping them is a second attempt at the same failure.
  it('will not swap one private address for another', () => {
    expect(publicAddressFor('192.168.1.50', '10.0.0.1')).toBeUndefined();
    expect(publicAddressFor('192.168.1.50', '192.168.1.50')).toBeUndefined();
    expect(publicAddressFor('192.168.1.50', '127.0.0.1')).toBeUndefined();
  });

  it('has nothing to offer when the network gave no host', () => {
    expect(publicAddressFor('192.168.1.50', undefined)).toBeUndefined();
    expect(publicAddressFor('192.168.1.50', '')).toBeUndefined();
  });

  // A bare label is a name on the sender's own network and means exactly as
  // little to us as the private address it would be replacing.
  it('will not dial a bare label with no domain on it', () => {
    expect(isDialableHost('fileserver')).toBe(false);
    expect(publicAddressFor('192.168.1.50', 'fileserver')).toBeUndefined();
  });

  it('takes an address or a name that could be looked up', () => {
    expect(isDialableHost('203.0.113.25')).toBe(true);
    expect(isDialableHost('bot.example.net')).toBe(true);
    expect(isDialableHost('2001:db8::1')).toBe(true);
    expect(isDialableHost('a-b.example.co.uk')).toBe(true);
  });
});

/**
 * The hostmasks two real serving bots were wearing, neither of which is an
 * address.
 *
 * Both looked perfectly dialable to a check that only refused a slash, and both
 * resolve to nothing: the fallback spent a lookup that could not succeed and
 * then blamed a hostname the network had invented.
 */
describe('a hostmask that is a cloak rather than a host', () => {
  it.each([
    ['Rizon-B5D54D46.cust.smartspb.net', 'a network name spliced over the real leading label'],
    ['863933A7.7304A9F.C6F98C0D.IP', 'hex labels under a .IP pseudo-domain'],
    ['user/bot', 'the slash form'],
    ['Rizon/staff/alice', 'the slash form, nested'],
  ])('will not dial %s (%s)', (cloak) => {
    expect(isDialableHost(cloak)).toBe(false);
    expect(publicAddressFor('192.168.0.200', cloak)).toBeUndefined();
  });

  // The domain under a Rizon cloak is genuine, which is what makes that shape
  // worth naming: everything but the leading label reads as an ordinary host.
  it('still dials an ordinary name on the same kind of domain', () => {
    expect(isDialableHost('files.cust.smartspb.net')).toBe(true);
    expect(publicAddressFor('192.168.0.200', 'files.cust.smartspb.net')).toBe(
      'files.cust.smartspb.net',
    );
  });

  it('still dials a plain address or an ordinary hostname', () => {
    expect(isDialableHost('203.0.113.9')).toBe(true);
    expect(isDialableHost('bot.example.net')).toBe(true);
    expect(isDialableHost('files.example.co.uk')).toBe(true);
  });
});
