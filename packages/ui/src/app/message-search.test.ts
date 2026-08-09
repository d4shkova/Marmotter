import type { Message } from '@marmotter/client';
import { makeSource } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import { findMatches } from './MessageSearch.js';

const say = (id: string, text: string, kind: Message['kind'] = 'privmsg'): Message => ({
  id,
  kind,
  at: new Date(0),
  fromServerTime: true,
  source: makeSource('tamsin', '~t', 'host.example'),
  target: '#marmotter',
  text,
  account: undefined,
  replyTo: undefined,
  pending: false,
  tags: new Map(),
});

describe('findMatches', () => {
  it('finds messages containing the query, case-insensitively', () => {
    const messages = [say('1', 'the Build finished'), say('2', 'no news'), say('3', 'rebuild it')];
    const matches = findMatches(messages, 'build');
    expect(matches.map((match) => match.id)).toEqual(['1', '3']);
  });

  it('returns nothing for an empty or whitespace query', () => {
    const messages = [say('1', 'anything')];
    expect(findMatches(messages, '')).toEqual([]);
    expect(findMatches(messages, '   ')).toEqual([]);
  });

  it('skips folded events so every match has a row to scroll to', () => {
    const messages = [
      say('1', 'tamsin joined', 'join'),
      say('2', 'tamsin said build', 'privmsg'),
      say('3', 'tamsin left', 'part'),
    ];
    const matches = findMatches(messages, 'tamsin');
    expect(matches.map((match) => match.id)).toEqual(['2']);
  });

  it('keeps buffer order', () => {
    const messages = [say('a', 'find me'), say('b', 'skip'), say('c', 'find me too')];
    expect(findMatches(messages, 'find').map((match) => match.id)).toEqual(['a', 'c']);
  });
});
