import { describe, expect, it } from 'vitest';
import { feed, registeredSession } from './harness.js';

const whoisReply = (nick = 'tamsin'): string[] => [
  `:irc.example.org 311 marmot ${nick} tam example.org * :Tamsin Real`,
  `:irc.example.org 319 marmot ${nick} :@#ops +#chat`,
  `:irc.example.org 312 marmot ${nick} irc.example.org :Example Server`,
  `:irc.example.org 317 marmot ${nick} 42 1700000000 :seconds idle, signon time`,
  `:irc.example.org 330 marmot ${nick} tamsin_acct :is logged in as`,
  `:irc.example.org 335 marmot ${nick} :is a bot`,
  `:irc.example.org 671 marmot ${nick} :is using a secure connection`,
  `:irc.example.org 318 marmot ${nick} :End of /WHOIS list`,
];

describe('whois', () => {
  it('assembles the numerics into one profile instead of dropping them', () => {
    const session = feed(registeredSession(), whoisReply());
    const profile = session.state.whois.get('tamsin');

    expect(profile).toBeDefined();
    expect(profile?.user).toBe('tam');
    expect(profile?.host).toBe('example.org');
    expect(profile?.realname).toBe('Tamsin Real');
    expect(profile?.account).toBe('tamsin_acct');
    expect(profile?.server).toBe('irc.example.org');
    expect(profile?.channels).toEqual(['@#ops', '+#chat']);
    expect(profile?.idleSeconds).toBe(42);
    expect(profile?.signonAt).toEqual(new Date(1_700_000_000 * 1000));
    expect(profile?.isBot).toBe(true);
    expect(profile?.secure).toBe(true);
  });

  it('marks the profile complete only when the reply ends', () => {
    const partial = feed(registeredSession(), whoisReply().slice(0, -1));
    expect(partial.state.whois.get('tamsin')?.complete).toBe(false);

    const full = feed(registeredSession(), whoisReply());
    expect(full.state.whois.get('tamsin')?.complete).toBe(true);
  });

  it('attaches an away message sent during the reply', () => {
    const session = feed(registeredSession(), [
      ':irc.example.org 311 marmot tamsin tam example.org * :Tamsin Real',
      ':irc.example.org 301 marmot tamsin :gone fishing',
      ':irc.example.org 318 marmot tamsin :End of /WHOIS list',
    ]);
    expect(session.state.whois.get('tamsin')?.away).toBe('gone fishing');
  });

  it('starts fresh on a repeat, keeping no stale fields', () => {
    // First WHOIS: a bot, in two channels.
    let session = feed(registeredSession(), whoisReply());
    expect(session.state.whois.get('tamsin')?.isBot).toBe(true);

    // Second WHOIS after they stopped being a bot and left the channels: the
    // 311 resets the profile, so the old flags do not linger.
    session = feed(session, [
      ':irc.example.org 311 marmot tamsin tam example.org * :Tamsin Real',
      ':irc.example.org 318 marmot tamsin :End of /WHOIS list',
    ]);
    const profile = session.state.whois.get('tamsin');
    expect(profile?.isBot).toBe(false);
    expect(profile?.channels).toEqual([]);
  });
});
