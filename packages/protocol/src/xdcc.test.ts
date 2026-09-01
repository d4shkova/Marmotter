import { describe, expect, it } from 'vitest';
import {
  parseHumanSize,
  parsePackRequest,
  parseXdccAnnounce,
  parseXdccRequest,
  parseXdccResponse,
} from './xdcc.js';

describe('parseXdccAnnounce', () => {
  it('parses a standard advertisement', () => {
    expect(
      parseXdccAnnounce('#70 1x [2.2G] Avatar The Last Airbender - S01E12 - The Storm.mkv'),
    ).toEqual({
      pack: 70,
      gets: 1,
      sizeText: '2.2G',
      sizeBytes: Math.round(2.2 * 1024 ** 3),
      filename: 'Avatar The Last Airbender - S01E12 - The Storm.mkv',
    });
  });

  it('keeps a filename that itself contains brackets', () => {
    const pack = parseXdccAnnounce('#13795 0x [11.9G] [ BlueTorrents.com ] The Great Arch 2025');
    expect(pack?.pack).toBe(13795);
    expect(pack?.filename).toBe('[ BlueTorrents.com ] The Great Arch 2025');
  });

  it('tolerates padding inside the size brackets', () => {
    const pack = parseXdccAnnounce('#170 0x [ 52G] Wayne.s.World.1992.tar');
    expect(pack?.sizeText).toBe('52G');
    expect(pack?.sizeBytes).toBe(52 * 1024 ** 3);
  });

  it('reads the gets count, including grouped thousands', () => {
    expect(parseXdccAnnounce('#1 1,234x [1M] a.bin')?.gets).toBe(1234);
  });

  it('handles small units', () => {
    const pack = parseXdccAnnounce('#209 0x [383K] Bonnie Poirier - Cold as Ice (epub).epub');
    expect(pack?.sizeBytes).toBe(383 * 1024);
    expect(pack?.filename).toBe('Bonnie Poirier - Cold as Ice (epub).epub');
  });

  it('is undefined when there is no size it can read', () => {
    // The bracket is there but empty; the pack is still listed, size unknown.
    const pack = parseXdccAnnounce('#5 0x [] mystery.bin');
    expect(pack?.sizeBytes).toBeUndefined();
    expect(pack?.sizeText).toBe('');
  });

  it('parses a colourised advertisement', () => {
    // A bot wrapping the line in mIRC colour codes must still be read.
    const coloured = '\x0304#70\x03 \x0300 1x\x03 [\x02 2.2G\x02] \x0312movie.mkv\x03';
    const pack = parseXdccAnnounce(coloured);
    expect(pack?.pack).toBe(70);
    expect(pack?.filename).toBe('movie.mkv');
    expect(pack?.sizeText).toBe('2.2G');
  });

  it('ignores ordinary chatter that merely mentions a number', () => {
    expect(parseXdccAnnounce('see #70 for details')).toBeUndefined();
    expect(parseXdccAnnounce('#general hello everyone')).toBeUndefined();
    expect(parseXdccAnnounce('#70 1x [2.2G]')).toBeUndefined(); // no filename
    expect(parseXdccAnnounce('')).toBeUndefined();
  });
});

describe('parseHumanSize', () => {
  it('reads binary units', () => {
    expect(parseHumanSize('1K')).toBe(1024);
    expect(parseHumanSize('2.2G')).toBe(Math.round(2.2 * 1024 ** 3));
    expect(parseHumanSize('52G')).toBe(52 * 1024 ** 3);
  });

  it('accepts a trailing B, as some bots write GB', () => {
    expect(parseHumanSize('1GB')).toBe(1024 ** 3);
  });

  it('treats a bare number as bytes', () => {
    expect(parseHumanSize('4096')).toBe(4096);
  });

  it('is undefined for nonsense', () => {
    expect(parseHumanSize('big')).toBeUndefined();
    expect(parseHumanSize('')).toBeUndefined();
  });
});

describe('parseXdccResponse', () => {
  it('reads a queue placement with its position and wait', () => {
    expect(
      parseXdccResponse(
        '** All slots full, Added you to the main queue for pack 123 in position 4. Estimated wait: 10m.',
      ),
    ).toEqual({
      kind: 'queued',
      pack: 123,
      position: 4,
      waitText: '10m',
      text: 'All slots full, Added you to the main queue for pack 123 in position 4. Estimated wait: 10m.',
    });
  });

  it('reads a send confirmation', () => {
    const answer = parseXdccResponse('** Sending you pack #70 ("thing.mkv"), which is 2.2GB.');
    expect(answer?.kind).toBe('sending');
    expect(answer?.pack).toBe(70);
  });

  it('does not mistake "already queued" for an acceptance', () => {
    const answer = parseXdccResponse('** You already have that item queued, Try Again Later');
    expect(answer?.kind).toBe('denied');
    expect(answer?.reason).toBe('already-queued');
  });

  it('reads the channel requirement, even when the bot wraps it in a disconnect', () => {
    const answer = parseXdccResponse(
      '** Closing Connection: You must be on a known channel to request a pack',
    );
    expect(answer?.kind).toBe('denied');
    expect(answer?.reason).toBe('not-in-channel');
  });

  it('reads a bad pack number', () => {
    expect(parseXdccResponse('** Invalid Pack Number, Try Again')?.reason).toBe('no-such-pack');
  });

  it('reads a per-user transfer limit', () => {
    expect(parseXdccResponse('** Denied, You already have 1 transfer running')?.reason).toBe(
      'transfer-limit',
    );
  });

  it('reads a full queue as a refusal when no position was given', () => {
    expect(
      parseXdccResponse('** All Slots Full, Main queue is full, try again later')?.reason,
    ).toBe('slots-full');
  });

  it('reads a bot that has closed its doors', () => {
    expect(
      parseXdccResponse('** The Bot Owner has requested that no new connections are made'),
    ).toMatchObject({ kind: 'denied', reason: 'closed' });
  });

  it('reads a removal from the queue', () => {
    expect(parseXdccResponse('** Removed you from the queue for pack #123')).toMatchObject({
      kind: 'dequeued',
      pack: 123,
    });
  });

  it('sees through mIRC colour codes', () => {
    expect(parseXdccResponse('\x0304**\x03 Sending you pack #5')?.kind).toBe('sending');
  });

  it('is undefined for a notice that says nothing it understands', () => {
    expect(parseXdccResponse('** Welcome to the pack list, type @find to search')).toBeUndefined();
    expect(parseXdccResponse('hello there')).toBeUndefined();
  });
});

describe('parseXdccRequest', () => {
  it('reads the line a search site hands you', () => {
    expect(parseXdccRequest('/msg bob xdcc send #123')).toEqual({ nick: 'bob', pack: 123 });
  });

  it('reads it without the slash, the hash, or the msg', () => {
    expect(parseXdccRequest('msg bob XDCC SEND 123')).toEqual({ nick: 'bob', pack: 123 });
    expect(parseXdccRequest('bob xdcc send #123')).toEqual({ nick: 'bob', pack: 123 });
  });

  it('reads a link and a message together', () => {
    expect(parseXdccRequest("irc://irc.abc.xyz/cool-stuff '/msg bob xdcc send #123'")).toEqual({
      nick: 'bob',
      pack: 123,
      host: 'irc.abc.xyz',
      channel: '#cool-stuff',
    });
  });

  it('reads the port, the TLS scheme and an escaped channel', () => {
    expect(parseXdccRequest('ircs://irc.abc.xyz:6697/%23warez /msg bob xdcc send #7')).toEqual({
      nick: 'bob',
      pack: 7,
      host: 'irc.abc.xyz',
      port: 6697,
      tls: true,
      channel: '#warez',
    });
  });

  it('treats the needssl flag as TLS', () => {
    expect(parseXdccRequest('irc://irc.abc.xyz/chan,needssl /msg bob xdcc send #7')?.tls).toBe(
      true,
    );
  });

  it('is undefined without a bot and a pack', () => {
    expect(parseXdccRequest('irc://irc.abc.xyz/cool-stuff')).toBeUndefined();
    expect(parseXdccRequest('xdcc send #123')).toBeUndefined();
  });
});

describe('a transfer the bot is waiting on', () => {
  it('reads the reminder that a transfer is sitting there unanswered', () => {
    expect(
      parseXdccResponse(
        '** You have a DCC pending, Set your client to receive the transfer. Type "/MSG [EWG]-[TB-DBi XDCC CANCEL" to abort the transfer. (90 seconds remaining until timeout)',
      ),
    ).toMatchObject({ kind: 'awaiting-connection' });
  });

  it('tells a transfer that timed out apart from a bot that is closed', () => {
    expect(parseXdccResponse('** Closing Connection: DCC Timeout (180 Sec Timeout)')).toMatchObject(
      { kind: 'denied', reason: 'dcc-timeout' },
    );
    expect(
      parseXdccResponse('** The Bot Owner has requested that no new connections are made'),
    ).toMatchObject({ reason: 'closed' });
  });
});

describe('parsePackRequest', () => {
  it('reads a request typed straight at a bot', () => {
    expect(parsePackRequest('xdcc send #26')).toBe(26);
    expect(parsePackRequest('XDCC SEND 26')).toBe(26);
    expect(parsePackRequest('  cdcc send #7 ')).toBe(7);
  });

  it('is undefined for anything else said to a bot', () => {
    expect(parsePackRequest('xdcc list')).toBeUndefined();
    expect(parsePackRequest('thanks, xdcc send #26 worked')).toBeUndefined();
    expect(parsePackRequest('send #26')).toBeUndefined();
  });
});
