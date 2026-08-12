import { describe, expect, it } from 'vitest';
import {
  EMPTY_IDENTITY,
  identityFrom,
  isValidNick,
  nickProblem,
  suggestedAlternates,
} from './preferences.js';

describe('what a network will accept as a name', () => {
  it('accepts the shapes RFC 2812 allows', () => {
    for (const nick of ['tamsin', 'Tamsin', 'tam-sin', 'tam_sin', '[tamsin]', '{tam|sin}', 'a']) {
      expect(isValidNick(nick), nick).toBe(true);
    }
  });

  it('refuses what a server would refuse', () => {
    for (const nick of ['', '1tamsin', '-tamsin', 'tam sin', 'tam,sin', 'tam@sin', 'tam!sin']) {
      expect(isValidNick(nick), nick).toBe(false);
    }
  });

  it('does not invent a length limit the network has not stated', () => {
    // Networks advertise their own in NICKLEN, and they disagree. Refusing at
    // nine characters here would be this client making up a rule.
    expect(isValidNick('a'.repeat(40))).toBe(true);
  });

  it('says what is wrong rather than that something is', () => {
    expect(nickProblem('tamsin')).toBeUndefined();
    expect(nickProblem('')).toBe('Enter a name.');
    expect(nickProblem('1tamsin')).toBe('A name cannot start with a number or a hyphen.');
    expect(nickProblem('tam sin')).toBe('A name cannot contain spaces.');
    expect(nickProblem('tam,sin')).toContain('letters, numbers');
  });
});

describe('suggesting the fallbacks', () => {
  it('offers the two the client used to generate on its own', () => {
    expect(suggestedAlternates('tamsin')).toEqual({ altNick: 'tamsin_', thirdNick: 'tamsin__' });
  });

  it('suggests nothing for an empty name', () => {
    expect(suggestedAlternates('')).toEqual({ altNick: '', thirdNick: '' });
  });
});

describe("a network's identity, built from the defaults", () => {
  const defaults = {
    nick: 'tamsin',
    altNick: 'tamsin_',
    thirdNick: 'tamsin__',
    realname: 'Tamsin',
    email: 'tamsin@example.com',
  };

  it('carries the name and both fallbacks', () => {
    expect(identityFrom(defaults)).toEqual({
      nick: 'tamsin',
      altNicks: ['tamsin_', 'tamsin__'],
      username: 'tamsin',
      realname: 'Tamsin',
    });
  });

  it('lets one network use a different name without losing the fallbacks', () => {
    // The nick field stays on the "Add a network" form for exactly this.
    const identity = identityFrom(defaults, 'tamsin|work');
    expect(identity.nick).toBe('tamsin|work');
    expect(identity.altNicks).toEqual(['tamsin_', 'tamsin__']);
  });

  it('drops a blank fallback rather than sending one', () => {
    const identity = identityFrom({ ...defaults, thirdNick: '' });
    expect(identity.altNicks).toEqual(['tamsin_']);
  });

  it('falls back to the generated pair when no alternates were given', () => {
    // A profile with no fallback at all cannot recover from a taken name.
    const identity = identityFrom({ ...EMPTY_IDENTITY, nick: 'tamsin' });
    expect(identity.altNicks).toEqual(['tamsin_', 'tamsin__']);
  });

  it('never offers a fallback identical to the name it falls back from', () => {
    const identity = identityFrom({ ...defaults, altNick: 'tamsin' });
    expect(identity.altNicks).toEqual(['tamsin__']);
  });

  it('uses the name as the real name when none was given', () => {
    // The real name is sent at registration and cannot be blank; using the nick
    // is what every client does and reveals nothing the nick did not.
    expect(identityFrom({ ...defaults, realname: '  ' }).realname).toBe('tamsin');
  });

  it('never puts the email anywhere the protocol would send it', () => {
    // An email is for services registration, not for the connection. Nothing in
    // an Identity carries it.
    expect(JSON.stringify(identityFrom(defaults))).not.toContain('example.com');
  });
});
