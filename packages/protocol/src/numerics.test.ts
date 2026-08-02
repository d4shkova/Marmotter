import { describe, expect, it } from 'vitest';
import { DEFAULT_ISUPPORT, applyISupport } from './isupport.js';
import { parseMessage } from './parse.js';
import {
  ERR_BADCHANNELKEY,
  ERR_CHANOPRIVSNEEDED,
  ERR_INVITEONLYCHAN,
  ERR_NICKNAMEINUSE,
  ERR_NOMOTD,
  ERR_NOSUCHNICK,
  NICK_UNAVAILABLE,
  NUMERICS,
  REGISTRATION_COMPLETE,
  RPL_ENDOFMOTD,
  describeError,
  interpretNumeric,
  numericName,
} from './numerics.js';

const support = applyISupport(DEFAULT_ISUPPORT, ['PREFIX=(qaohv)~&@%+', 'CHANTYPES=#']);

const event = (line: string) => {
  const result = parseMessage(line);
  if (!result.ok) {
    throw new Error(`fixture failed to parse: ${line}`);
  }
  return interpretNumeric(result.message, support);
};

describe('the numeric table', () => {
  it('names every numeric CLAUDE.md enumerates', () => {
    const required = [
      // registration
      '001',
      '002',
      '003',
      '004',
      '005',
      '251',
      '252',
      '253',
      '254',
      '255',
      '265',
      '266',
      // names and topic
      '332',
      '333',
      '353',
      '366',
      // motd
      '372',
      '375',
      '376',
      '422',
      // whois and whowas
      '311',
      '312',
      '313',
      '314',
      '317',
      '318',
      '319',
      '330',
      '338',
      '671',
      // lists
      '367',
      '368',
      '346',
      '347',
      '348',
      '349',
      '728',
      '729',
      // errors
      '401',
      '403',
      '404',
      '421',
      '432',
      '433',
      '437',
      '441',
      '442',
      '461',
      '471',
      '472',
      '473',
      '474',
      '475',
      '476',
      '477',
      '478',
      '482',
      '484',
    ];

    for (const numeric of required) {
      expect(NUMERICS.has(numeric), `missing ${numeric}`).toBe(true);
      expect(numericName(numeric)).toMatch(/^(RPL|ERR)_/);
    }
  });

  it('returns nothing for an unknown numeric', () => {
    expect(numericName('999')).toBeUndefined();
  });

  it('marks error numerics so they get plain-English copy', () => {
    expect(NUMERICS.get(ERR_INVITEONLYCHAN)?.disposition).toBe('error');
    expect(NUMERICS.get(RPL_ENDOFMOTD)?.disposition).toBe('state');
  });
});

describe('registration and names', () => {
  it('reads RPL_WELCOME', () => {
    expect(event(':srv 001 d4shkova :Welcome to Libera.Chat')).toEqual({
      kind: 'welcome',
      nick: 'd4shkova',
      text: 'Welcome to Libera.Chat',
    });
  });

  it('strips the nick and the trailing sentence from RPL_ISUPPORT', () => {
    const result = event(
      ':srv 005 d4shkova PREFIX=(ov)@+ CHANTYPES=# :are supported by this server',
    );
    expect(result).toEqual({ kind: 'isupport', tokens: ['PREFIX=(ov)@+', 'CHANTYPES=#'] });
  });

  it('reads the topic and who set it', () => {
    expect(event(':srv 332 me #marmotter :Building a GUI IRC client')).toEqual({
      kind: 'topic',
      channel: '#marmotter',
      topic: 'Building a GUI IRC client',
    });

    const setBy = event(':srv 333 me #marmotter jonquil 1699999999');
    expect(setBy).toEqual({
      kind: 'topic-set-by',
      channel: '#marmotter',
      setBy: 'jonquil',
      at: new Date(1699999999000),
    });
  });

  it('reports an absent topic', () => {
    expect(event(':srv 331 me #empty :No topic is set')).toEqual({
      kind: 'no-topic',
      channel: '#empty',
    });
  });

  it('splits NAMES entries using the advertised prefixes', () => {
    const result = event(':srv 353 me = #marmotter :~jonquil &emilyp @tamsin %rho +me plain');
    expect(result).toEqual({
      kind: 'names',
      channel: '#marmotter',
      members: [
        { prefixes: '~', nick: 'jonquil' },
        { prefixes: '&', nick: 'emilyp' },
        { prefixes: '@', nick: 'tamsin' },
        { prefixes: '%', nick: 'rho' },
        { prefixes: '+', nick: 'me' },
        { prefixes: '', nick: 'plain' },
      ],
    });
  });

  it('handles multi-prefix entries', () => {
    const result = event(':srv 353 me = #c :@+both');
    expect(result).toEqual({
      kind: 'names',
      channel: '#c',
      members: [{ prefixes: '@+', nick: 'both' }],
    });
  });

  it('ends the NAMES burst', () => {
    expect(event(':srv 366 me #marmotter :End of /NAMES list')).toEqual({
      kind: 'names-end',
      channel: '#marmotter',
    });
  });

  it('reads the channel mode reply', () => {
    expect(event(':srv 324 me #marmotter +nt')).toEqual({
      kind: 'channel-modes',
      channel: '#marmotter',
      modeString: '+nt',
      params: [],
    });
  });
});

describe('MOTD', () => {
  it('categorises the whole block so it can collapse into one item', () => {
    expect(event(':srv 375 me :- srv Message of the Day -').kind).toBe('motd-start');
    expect(event(':srv 372 me :- hello there').kind).toBe('motd-line');
    expect(event(':srv 376 me :End of /MOTD command.').kind).toBe('motd-end');
    expect(event(':srv 422 me :MOTD File is missing').kind).toBe('no-motd');
  });

  it('treats both MOTD endings as the end of registration', () => {
    expect(REGISTRATION_COMPLETE.has(RPL_ENDOFMOTD)).toBe(true);
    expect(REGISTRATION_COMPLETE.has(ERR_NOMOTD)).toBe(true);
  });
});

describe('list numerics', () => {
  it('reads a ban entry with who set it and when', () => {
    expect(event(':srv 367 me #c *!*@host.example tamsin 1699999999')).toEqual({
      kind: 'list-entry',
      list: 'ban',
      channel: '#c',
      mask: '*!*@host.example',
      setBy: 'tamsin',
      at: new Date(1699999999000),
    });
  });

  it('distinguishes the four list kinds', () => {
    expect(event(':srv 367 me #c mask').kind).toBe('list-entry');
    for (const [line, list] of [
      [':srv 367 me #c mask', 'ban'],
      [':srv 348 me #c mask', 'except'],
      [':srv 346 me #c mask', 'invite'],
    ] as const) {
      const result = event(line);
      expect(result.kind === 'list-entry' && result.list).toBe(list);
    }
  });

  it('skips the mode letter some networks put in a quiet entry', () => {
    const withLetter = event(':srv 728 me #c q *!*@host tamsin 1699999999');
    expect(withLetter).toEqual({
      kind: 'list-entry',
      list: 'quiet',
      channel: '#c',
      mask: '*!*@host',
      setBy: 'tamsin',
      at: new Date(1699999999000),
    });
  });

  it('ends each list', () => {
    const result = event(':srv 368 me #c :End of channel ban list');
    expect(result).toEqual({ kind: 'list-end', list: 'ban', channel: '#c' });
  });

  it('leaves the timestamp undefined when it is missing or malformed', () => {
    const result = event(':srv 367 me #c mask tamsin notatime');
    expect(result.kind === 'list-entry' && result.at).toBeUndefined();
  });
});

describe('channel browser', () => {
  it('reads a LIST entry', () => {
    expect(event(':srv 322 me #marmotter 34 :Building a GUI IRC client')).toEqual({
      kind: 'channel-list-entry',
      channel: '#marmotter',
      members: 34,
      topic: 'Building a GUI IRC client',
    });
  });

  it('falls back to zero for an unparseable member count', () => {
    const result = event(':srv 322 me #c lots :topic');
    expect(result.kind === 'channel-list-entry' && result.members).toBe(0);
  });

  it('ends the list', () => {
    expect(event(':srv 323 me :End of /LIST').kind).toBe('channel-list-end');
  });
});

describe('WHOIS', () => {
  it('routes every WHOIS numeric to the profile card', () => {
    for (const line of [
      ':srv 311 me tamsin user host * :Real Name',
      ':srv 312 me tamsin lithium.libera.chat :Sweden',
      ':srv 313 me tamsin :is an IRC operator',
      ':srv 317 me tamsin 42 1699999999 :seconds idle',
      ':srv 319 me tamsin :@#marmotter +#ircv3',
      ':srv 330 me tamsin tamsin_account :is logged in as',
      ':srv 338 me tamsin 10.0.0.1 :actually using host',
      ':srv 671 me tamsin :is using a secure connection',
    ]) {
      const result = event(line);
      expect(result.kind).toBe('whois');
      expect(result.kind === 'whois' && result.nick).toBe('tamsin');
    }
  });

  it('ends the profile', () => {
    expect(event(':srv 318 me tamsin :End of /WHOIS list')).toEqual({
      kind: 'whois-end',
      nick: 'tamsin',
    });
  });
});

describe('away and SASL', () => {
  it('reads another user being away', () => {
    expect(event(':srv 301 me dunlin :Back in an hour')).toEqual({
      kind: 'away',
      nick: 'dunlin',
      reason: 'Back in an hour',
    });
  });

  it('tracks our own away state', () => {
    expect(event(':srv 306 me :You have been marked as being away')).toEqual({
      kind: 'away-state',
      away: true,
    });
    expect(event(':srv 305 me :You are no longer marked as being away')).toEqual({
      kind: 'away-state',
      away: false,
    });
  });

  it('reads the account from RPL_LOGGEDIN', () => {
    expect(event(':srv 900 me nick!user@host d4shkova :You are now logged in as d4shkova')).toEqual(
      { kind: 'sasl-success', account: 'd4shkova' },
    );
  });

  it('reads the offered mechanisms', () => {
    expect(event(':srv 908 me PLAIN,EXTERNAL,SCRAM-SHA-256 :are available')).toEqual({
      kind: 'sasl-mechanisms',
      mechanisms: ['PLAIN', 'EXTERNAL', 'SCRAM-SHA-256'],
    });
  });
});

describe('MONITOR', () => {
  it('reads online and offline bursts', () => {
    expect(event(':srv 730 me :tamsin!u@h,jonquil!u@h')).toEqual({
      kind: 'monitor',
      online: true,
      targets: ['tamsin!u@h', 'jonquil!u@h'],
    });
    expect(event(':srv 731 me :dunlin')).toEqual({
      kind: 'monitor',
      online: false,
      targets: ['dunlin'],
    });
  });
});

describe('errors as plain English', () => {
  it('turns 473 into the sentence from CLAUDE.md, with an action', () => {
    expect(describeError(ERR_INVITEONLYCHAN, ['me', '#channel'])).toEqual({
      message:
        "#channel is invite-only. You'll need an invitation from someone already in the channel.",
      action: 'request-invite',
    });
  });

  it('offers a password prompt for a keyed channel', () => {
    expect(describeError(ERR_BADCHANNELKEY, ['me', '#secret']).action).toBe(
      'enter-channel-password',
    );
  });

  it('offers another nick when the chosen one is taken', () => {
    expect(describeError(ERR_NICKNAMEINUSE, ['me', 'marmot']).action).toBe('choose-another-nick');
  });

  it('names the channel when operator rights are missing', () => {
    const report = describeError(ERR_CHANOPRIVSNEEDED, ['me', '#marmotter']);
    expect(report.message).toContain('#marmotter');
    expect(report.action).toBe('ask-an-operator');
  });

  it('never surfaces a numeric, a mode letter, or a raw token in the copy', () => {
    for (const numeric of [...NUMERICS.keys()]) {
      if (NUMERICS.get(numeric)?.disposition !== 'error') {
        continue;
      }
      const { message } = describeError(numeric, ['me', '#channel', 'someone']);

      expect(message, `${numeric} leaks its numeric`).not.toContain(numeric);
      expect(message, `${numeric} mentions a mode`).not.toMatch(/\bmode\b/i);
      // A standalone `+mnt`, not a hyphen inside an ordinary word like "sign-in".
      expect(message, `${numeric} names a protocol token`).not.toMatch(/(^|\s)[+-][a-zA-Z]{1,4}\b/);
      expect(message.length, `${numeric} has no copy`).toBeGreaterThan(10);
      // Copy rule: errors never apologise.
      expect(message, `${numeric} apologises`).not.toMatch(/sorry|apolog|oops|unfortunately/i);
      expect(message.endsWith('.'), `${numeric} is not a sentence`).toBe(true);
    }
  });

  it('falls back to the server text rather than inventing copy', () => {
    const report = describeError('999', ['me', 'thing', 'A server-specific explanation']);
    expect(report).toEqual({ message: 'A server-specific explanation', action: 'none' });
  });

  it('still produces a sentence when the server sends no text', () => {
    expect(describeError('999', []).message).toBe('The network refused that request.');
  });

  it('wraps error numerics as typed events', () => {
    const result = event(':srv 473 me #private :Cannot join channel (+i)');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.numeric).toBe(ERR_INVITEONLYCHAN);
      expect(result.report.action).toBe('request-invite');
    }
  });

  it('names people rather than codes for a missing nick', () => {
    const result = event(':srv 401 me ghost :No such nick');
    expect(result.kind === 'error' && result.report.message).toContain('ghost');
    expect(NUMERICS.get(ERR_NOSUCHNICK)?.category).toBe('error');
  });
});

describe('nick collision', () => {
  it('recognises every numeric that means the nick was refused', () => {
    for (const numeric of ['433', '436', '437', '432']) {
      expect(NICK_UNAVAILABLE.has(numeric), `missing ${numeric}`).toBe(true);
    }
  });
});

describe('degenerate input', () => {
  // A server that truncates a reply, or a hostile one that sends a numeric with
  // no parameters at all, must not be able to crash the interpreter.
  it.each([...NUMERICS.keys()])('interprets %s with no parameters without throwing', (numeric) => {
    const result = parseMessage(`:srv ${numeric}`);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const interpreted = interpretNumeric(result.message, support);
    expect(interpreted.kind).toBeTruthy();
    // Every field a consumer reads is defined, even with nothing to read from.
    expect(JSON.stringify(interpreted)).toBeTypeOf('string');
  });

  it.each([...NUMERICS.keys()])('interprets %s with only a nick without throwing', (numeric) => {
    const result = parseMessage(`:srv ${numeric} me`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(interpretNumeric(result.message, support).kind).toBeTruthy();
    }
  });

  it('survives a NAMES reply with an empty member list', () => {
    expect(event(':srv 353 me = #c :')).toEqual({ kind: 'names', channel: '#c', members: [] });
  });

  it('survives a quiet entry with neither a mode letter nor a mask', () => {
    const result = event(':srv 728 me #c');
    expect(result.kind === 'list-entry' && result.mask).toBe('');
  });

  it('survives a MONITOR burst with an empty target list', () => {
    expect(event(':srv 730 me :')).toEqual({ kind: 'monitor', online: true, targets: [] });
  });

  it('survives a SASL mechanism list with no mechanisms', () => {
    expect(event(':srv 908 me')).toEqual({ kind: 'sasl-mechanisms', mechanisms: [] });
  });

  it('rejects a topic timestamp that is out of range', () => {
    const result = event(':srv 333 me #c setter 99999999999999999999');
    expect(result.kind === 'topic-set-by' && result.at).toBeUndefined();
  });
});

describe('unrecognised numerics', () => {
  it('come back typed, carrying their parameters, and never as a raw line', () => {
    const result = event(':srv 999 me some param :text');
    expect(result).toEqual({
      kind: 'unhandled',
      numeric: '999',
      params: ['me', 'some', 'param', 'text'],
    });
  });
});
