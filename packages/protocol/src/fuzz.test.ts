import { describe, expect, it } from 'vitest';
import { extractCtcp } from './ctcp.js';
import { applyISupport, DEFAULT_ISUPPORT } from './isupport.js';
import { parseChannelModes } from './modes.js';
import { interpretNumeric } from './numerics.js';
import { parseMessage } from './parse.js';
import { serializeMessage } from './serialize.js';
import { parseStandardReply } from './standard-replies.js';
import { parseTags } from './tags.js';

/**
 * The parser sits directly on the socket, so anything a hostile or simply
 * broken server sends reaches it first. It must never throw: a malformed line
 * becomes a typed failure and a raw-log entry, not a crashed connection.
 *
 * The generator is seeded so a failure is reproducible from the reported seed
 * rather than being a heisenbug.
 */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Characters chosen to hit the parser's decision points, not just any byte. */
const INTERESTING = [
  '@',
  ':',
  ' ',
  '!',
  '=',
  ';',
  '\\',
  '\r',
  '\n',
  '\0',
  '\x01',
  '\x10',
  '+',
  '-',
  '#',
  '*',
  ',',
  'a',
  'Z',
  '0',
  '9',
  'é',
  '☃',
  '🪫',
  '\ud83e', // lone surrogate
  '\udeab', // lone surrogate
];

const randomLine = (random: () => number): string => {
  const length = Math.floor(random() * 200);
  let line = '';
  for (let i = 0; i < length; i += 1) {
    if (random() < 0.75) {
      line += INTERESTING[Math.floor(random() * INTERESTING.length)] ?? 'a';
    } else {
      line += String.fromCharCode(Math.floor(random() * 0x2000));
    }
  }
  return line;
};

/** Lines shaped like real messages, then corrupted. */
const mutatedLine = (random: () => number): string => {
  const seeds = [
    '@time=2026-07-30T09:14:00.000Z;msgid=abc :nick!user@host PRIVMSG #chan :hello there',
    ':irc.example.com 005 me PREFIX=(ov)@+ CHANMODES=b,k,l,imnt :are supported',
    ':srv 353 me = #chan :@op +voice plain',
    ':nick!user@host MODE #chan +o-v+b one two mask',
    'CAP * LS :sasl=PLAIN server-time batch',
    ':srv BATCH +ref chathistory #chan',
    ':srv FAIL JOIN CHANNEL_FULL #chan :The channel is full.',
    'AUTHENTICATE +',
    ':nick PRIVMSG #chan :\x01ACTION waves\x01',
  ];

  let line = seeds[Math.floor(random() * seeds.length)] ?? '';
  const mutations = 1 + Math.floor(random() * 4);

  for (let i = 0; i < mutations; i += 1) {
    const at = Math.floor(random() * Math.max(line.length, 1));
    const roll = random();
    if (roll < 0.35) {
      line = line.slice(0, at); // truncate
    } else if (roll < 0.7) {
      const char = INTERESTING[Math.floor(random() * INTERESTING.length)] ?? 'a';
      line = line.slice(0, at) + char + line.slice(at); // insert
    } else {
      line = line.slice(0, at) + line.slice(at + 1); // delete
    }
  }
  return line;
};

const ISUPPORT = applyISupport(DEFAULT_ISUPPORT, [
  'PREFIX=(qaohv)~&@%+',
  'CHANMODES=beI,k,fl,imnpst',
]);

/** Runs the full downstream pipeline over a parsed message. */
const exercise = (line: string): void => {
  const result = parseMessage(line);
  expect(typeof result.ok).toBe('boolean');

  if (!result.ok) {
    expect(['empty', 'missing-command']).toContain(result.reason);
    expect(result.input).toBe(line);
    return;
  }

  const message = result.message;
  expect(typeof message.command).toBe('string');
  expect(Array.isArray(message.params)).toBe(true);

  // Everything a consumer would do with the message, on garbage input.
  serializeMessage(message);
  interpretNumeric(message, ISUPPORT);
  parseStandardReply(message);
  parseChannelModes(message.params[1] ?? '', message.params.slice(2), ISUPPORT);
  extractCtcp(message.params[message.params.length - 1] ?? '');
};

describe('parser fuzzing', () => {
  it('never throws on random input', () => {
    const random = mulberry32(0x9e3779b9);
    for (let i = 0; i < 20000; i += 1) {
      const line = randomLine(random);
      expect(() => exercise(line), `iteration ${i}: ${JSON.stringify(line)}`).not.toThrow();
    }
  });

  it('never throws on corrupted real-looking messages', () => {
    const random = mulberry32(0x1234567);
    for (let i = 0; i < 20000; i += 1) {
      const line = mutatedLine(random);
      expect(() => exercise(line), `iteration ${i}: ${JSON.stringify(line)}`).not.toThrow();
    }
  });

  it('never throws on pathological tag sections', () => {
    const random = mulberry32(0xabcdef);
    for (let i = 0; i < 5000; i += 1) {
      const section = randomLine(random);
      expect(() => parseTags(section), JSON.stringify(section)).not.toThrow();
      expect(() => exercise(`@${section} PRIVMSG #c :hi`)).not.toThrow();
    }
  });

  it.each([
    '',
    ' ',
    '\r\n',
    '@',
    '@ ',
    ':',
    ': ',
    '::',
    '@@@',
    '@=',
    '@=;=;=',
    '@a=\\',
    ':!@',
    ':@!',
    'A'.repeat(10000),
    `@${'a=b;'.repeat(5000)} PRIVMSG #c :hi`,
    ':nick!user@host',
    '\0\0\0',
    '\x01\x01',
    'PRIVMSG #c :\x01',
    'MODE #c +'.padEnd(600, 'o'),
    '@batch=;label= BATCH +',
  ])('never throws on the degenerate line %j', (line) => {
    expect(() => exercise(line)).not.toThrow();
  });

  it('produces params that are always strings', () => {
    const random = mulberry32(42);
    for (let i = 0; i < 5000; i += 1) {
      const result = parseMessage(randomLine(random));
      if (result.ok) {
        for (const param of result.message.params) {
          expect(typeof param).toBe('string');
        }
      }
    }
  });

  it('reserializes anything it parsed into something that parses again', () => {
    const random = mulberry32(0xfeed);
    for (let i = 0; i < 10000; i += 1) {
      const first = parseMessage(mutatedLine(random));
      if (!first.ok) {
        continue;
      }
      const serialized = serializeMessage(first.message);
      if (!serialized.ok) {
        continue;
      }

      const second = parseMessage(serialized.line);
      expect(second.ok, `lost on reserialize: ${JSON.stringify(serialized.line)}`).toBe(true);
      if (second.ok) {
        expect(second.message.command).toBe(first.message.command);
        expect(second.message.params).toEqual(first.message.params);
      }
    }
  });
});
