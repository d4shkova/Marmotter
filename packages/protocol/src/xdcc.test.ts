import { describe, expect, it } from 'vitest';
import { parseHumanSize, parseXdccAnnounce } from './xdcc.js';

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
