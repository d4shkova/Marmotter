import type { Message } from '@marmotter/client';
import { makeSource } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import { findMatches } from './MessageSearch.js';

const say = (
  id: string,
  text: string,
  kind: Message['kind'] = 'privmsg',
  nick = 'tamsin',
): Message => ({
  id,
  kind,
  at: new Date(0),
  fromServerTime: true,
  source: makeSource(nick, '~t', 'host.example'),
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

describe('findMatches by person', () => {
  const buffer = [
    say('1', 'morning all', 'privmsg', 'tamsin'),
    say('2', 'morning', 'privmsg', 'jonquil'),
    say('3', 'about tamsin, actually', 'privmsg', 'rowan'),
    say('4', 'still here', 'privmsg', 'Tamsin_'),
  ];

  it('pulls up everything one person wrote, whatever they wrote about', () => {
    expect(findMatches(buffer, 'tamsin', 'nick').map((match) => match.id)).toEqual(['1', '4']);
  });

  it('matches the name however it was capitalised', () => {
    expect(findMatches(buffer, 'TAMSIN', 'nick').map((match) => match.id)).toEqual(['1', '4']);
  });

  it('does not match a name mentioned in the middle of someone else', () => {
    expect(findMatches(buffer, 'quil', 'nick')).toEqual([]);
  });

  it('still searches the words when the scope is left alone', () => {
    expect(findMatches(buffer, 'tamsin').map((match) => match.id)).toEqual(['3']);
  });
});
