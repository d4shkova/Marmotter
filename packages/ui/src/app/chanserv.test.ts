import { describe, expect, it } from 'vitest';
import { accessCommands, flagDiff, parseAccessListing, roleForLevel } from './chanserv.js';

describe('translating permissions to whichever service the network runs', () => {
  it('uses capabilities on Atheme and roles elsewhere', () => {
    expect(accessCommands('atheme').model).toBe('flags');
    expect(accessCommands('anope').model).toBe('roles');
    expect(accessCommands('ergo').model).toBe('roles');
  });

  // Guessing here sends a command that either fails confusingly or grants the
  // wrong thing. Neither is worth it.
  it('refuses to guess at an unrecognised package', () => {
    expect(accessCommands('unknown').model).toBe('unsupported');
  });

  it('grants and revokes in one change on Atheme', () => {
    expect(accessCommands('atheme').setFlags('#marmotter', 'tamsin', 'ov', 'b')).toBe(
      'PRIVMSG ChanServ :FLAGS #marmotter tamsin +ov-b',
    );
    expect(accessCommands('atheme').setFlags('#marmotter', 'tamsin', 'v', '')).toBe(
      'PRIVMSG ChanServ :FLAGS #marmotter tamsin +v',
    );
    expect(accessCommands('atheme').setFlags('#marmotter', 'tamsin', '', 'o')).toBe(
      'PRIVMSG ChanServ :FLAGS #marmotter tamsin -o',
    );
  });

  it('sets a role through the right command on Anope and ergo', () => {
    expect(accessCommands('anope').setRole('#marmotter', 'tamsin', 'AOP')).toBe(
      'PRIVMSG ChanServ :AOP #marmotter ADD tamsin',
    );
    expect(accessCommands('ergo').setRole('#marmotter', 'tamsin', '+o')).toBe(
      'PRIVMSG ChanServ :AMODE #marmotter +o tamsin',
    );
  });
});

describe('reading a service’s reply', () => {
  it('reads an Atheme flags listing', () => {
    const entries = parseAccessListing(
      [
        'Entry Nickname/Host          Flags',
        '----- ---------------------- -----',
        '1     tamsin                 +AFORefiorstv (FOUNDER)',
        '2     jonquil                +AVvo',
        'End of #marmotter FLAGS listing.',
      ],
      'flags',
    );

    expect(entries).toEqual([
      { target: 'tamsin', flags: 'AFORefiorstv', role: '', founder: true },
      { target: 'jonquil', flags: 'AVvo', role: '', founder: false },
    ]);
  });

  // Captured verbatim from Anope 2.0.12 with its XOP module loaded, which is
  // what a real network runs. The level column holds the role's own name here,
  // not a number — reading it as a number found nothing at all, and the panel
  // showed an empty grid on a channel that had entries.
  it('reads an Anope access listing that names the role', () => {
    const entries = parseAccessListing(
      [
        'Access list for #marmotter:',
        'Number  Level  Mask',
        '1       AOP    tamsin',
        '2       VOP    jonquil',
        'End of access list',
      ],
      'roles',
    );
    expect(entries).toEqual([
      { target: 'tamsin', flags: '', role: 'AOP', founder: false },
      { target: 'jonquil', flags: '', role: 'VOP', founder: false },
    ]);
  });

  // The same command prints a bare number where access is kept by level rather
  // than by XOP, and a number on its own means nothing to anybody.
  it('reads an Anope access listing that gives a bare level', () => {
    const entries = parseAccessListing(
      ['Access list for #marmotter:', '  Num   Level    Mask', '  1     10       tamsin'],
      'roles',
    );
    expect(entries).toEqual([{ target: 'tamsin', flags: '', role: 'SOP', founder: false }]);
  });

  // Anope brackets the name in bold when it confirms a change, and a mask read
  // with the code still on it would be sent back as a name it does not have.
  it('strips the formatting services put in their tables', () => {
    expect(parseAccessListing(['1       AOP    \u0002tamsin\u0002'], 'roles')).toEqual([
      { target: 'tamsin', flags: '', role: 'AOP', founder: false },
    ]);
  });

  it('does not read the header row as somebody’s access', () => {
    expect(parseAccessListing(['Number  Level  Mask', 'End of access list'], 'roles')).toEqual([]);
  });

  it('reads an ergo AMODE listing', () => {
    expect(parseAccessListing(['+o  tamsin'], 'roles')).toEqual([
      { target: 'tamsin', flags: '', role: '+o', founder: false },
    ]);
  });

  // Services output is not a protocol. A confidently wrong table is worse than
  // showing nothing and letting the person read the reply themselves.
  it('returns nothing for a reply it does not recognise', () => {
    expect(parseAccessListing(['Something entirely different'], 'flags')).toEqual([]);
    expect(
      parseAccessListing(['You are not authorised to perform this operation.'], 'roles'),
    ).toEqual([]);
  });

  it('maps Anope’s default levels onto its own roles', () => {
    expect(roleForLevel(3)).toBe('VOP');
    expect(roleForLevel(4)).toBe('HOP');
    expect(roleForLevel(5)).toBe('AOP');
    expect(roleForLevel(10)).toBe('SOP');
    // Anope's founder level, which is a rank rather than a role.
    expect(roleForLevel(10_000)).toBe('QOP');
  });
});

describe('changing one column of the grid', () => {
  it('adds only what was ticked and removes only what was unticked', () => {
    expect(flagDiff('vo', new Set(['v', 'o', 't']))).toEqual({ add: 't', remove: '' });
    expect(flagDiff('vot', new Set(['v', 'o']))).toEqual({ add: '', remove: 't' });
  });

  // Sending the whole desired set would clear flags this grid does not show,
  // which is how a panel quietly strips permissions somebody set by hand.
  it('never touches a capability the grid does not display', () => {
    expect(flagDiff('AFvo', new Set(['v']))).toEqual({ add: '', remove: 'o' });
  });

  it('sends nothing when nothing moved', () => {
    expect(flagDiff('vo', new Set(['v', 'o']))).toEqual({ add: '', remove: '' });
  });
});
