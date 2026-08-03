import { describe, expect, it } from 'vitest';
import {
  RPL_AWAY,
  RPL_WHOISACCOUNT,
  RPL_WHOISACTUALLY,
  RPL_WHOISBOT,
  RPL_WHOISCHANNELS,
  RPL_WHOISIDLE,
  RPL_WHOISOPERATOR,
  RPL_WHOISSECURE,
  RPL_WHOISSERVER,
  RPL_WHOISUSER,
} from './numerics.js';
import { type WhoisProfile, applyWhoisNumeric, emptyWhois } from './whois.js';

// The whois event's `params` field: the subject's nick, then the fields, with
// our own nick already stripped. Numerics as they arrive from a server.
const apply = (profile: WhoisProfile, numeric: string, ...fields: string[]): WhoisProfile =>
  applyWhoisNumeric(profile, numeric, ['tamsin', ...fields]);

describe('assembling a whois', () => {
  it('starts empty and knows nothing yet', () => {
    const profile = emptyWhois('tamsin');
    expect(profile.nick).toBe('tamsin');
    expect(profile.complete).toBe(false);
    expect(profile.channels).toEqual([]);
    expect(profile.secure).toBe(false);
  });

  it('reads the user line into name, host, and real name', () => {
    const profile = apply(
      emptyWhois('tamsin'),
      RPL_WHOISUSER,
      'tam',
      'example.org',
      '*',
      'Tamsin Real',
    );
    expect(profile.user).toBe('tam');
    expect(profile.host).toBe('example.org');
    expect(profile.realname).toBe('Tamsin Real');
  });

  it('reads the server and its description', () => {
    const profile = apply(
      emptyWhois('tamsin'),
      RPL_WHOISSERVER,
      'irc.example.org',
      'Example Server',
    );
    expect(profile.server).toBe('irc.example.org');
    expect(profile.serverInfo).toBe('Example Server');
  });

  it('records the services account', () => {
    const profile = apply(emptyWhois('tamsin'), RPL_WHOISACCOUNT, 'tamsin_acct', 'is logged in as');
    expect(profile.account).toBe('tamsin_acct');
  });

  it('flags operator, bot, and a secure connection', () => {
    let profile = apply(emptyWhois('tamsin'), RPL_WHOISOPERATOR, 'is an IRC operator');
    profile = apply(profile, RPL_WHOISBOT, 'is a bot');
    profile = apply(profile, RPL_WHOISSECURE, 'is using a secure connection');
    expect(profile.isOperator).toBe(true);
    expect(profile.isBot).toBe(true);
    expect(profile.secure).toBe(true);
  });

  it('parses idle seconds and a signon time', () => {
    const signon = 1_700_000_000;
    const profile = apply(
      emptyWhois('tamsin'),
      RPL_WHOISIDLE,
      '42',
      String(signon),
      'seconds idle',
    );
    expect(profile.idleSeconds).toBe(42);
    expect(profile.signonAt).toEqual(new Date(signon * 1000));
  });

  it('leaves idle unset when the field is not a number', () => {
    const profile = apply(emptyWhois('tamsin'), RPL_WHOISIDLE, 'nonsense');
    expect(profile.idleSeconds).toBeUndefined();
    expect(profile.signonAt).toBeUndefined();
  });

  it('splits the channel list, keeping status prefixes', () => {
    const profile = apply(emptyWhois('tamsin'), RPL_WHOISCHANNELS, '@#ops +#chat #lobby');
    expect(profile.channels).toEqual(['@#ops', '+#chat', '#lobby']);
  });

  it('accumulates channels split across several lines', () => {
    let profile = apply(emptyWhois('tamsin'), RPL_WHOISCHANNELS, '@#ops');
    profile = apply(profile, RPL_WHOISCHANNELS, '+#chat');
    expect(profile.channels).toEqual(['@#ops', '+#chat']);
  });

  it('captures the real host from the actually line', () => {
    const profile = apply(
      emptyWhois('tamsin'),
      RPL_WHOISACTUALLY,
      '203.0.113.7',
      'actually using host',
    );
    expect(profile.actualHost).toBe('203.0.113.7');
  });

  it('ignores a numeric it does not model', () => {
    const before = emptyWhois('tamsin');
    // 301 (away) is handled by the reducer, not here; passing it through leaves
    // the profile untouched rather than corrupting a field.
    const after = applyWhoisNumeric(before, RPL_AWAY, ['tamsin', 'gone fishing']);
    expect(after).toEqual(before);
  });

  it('does not overwrite a known field with a missing one', () => {
    let profile = apply(emptyWhois('tamsin'), RPL_WHOISUSER, 'tam', 'example.org', '*', 'Tamsin');
    // A later, sparser line must not blank out what we already learned.
    profile = applyWhoisNumeric(profile, RPL_WHOISSERVER, ['tamsin']);
    expect(profile.user).toBe('tam');
    expect(profile.server).toBeUndefined();
  });
});
