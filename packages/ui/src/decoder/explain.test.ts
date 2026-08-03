import { describe, expect, it } from 'vitest';
import {
  CHANNEL_FLAG_MODES,
  CHANNEL_LIST_MODES,
  CHANNEL_PARAMETER_MODES,
  CTCP_EXPLANATIONS,
  NUMERIC_EXPLANATIONS,
  ROLE_MODES,
  SERVICES_EXPLANATIONS,
  USER_MODES,
} from './dictionary.js';
import {
  explain,
  explainChannelModes,
  explainCtcp,
  explainNumeric,
  explainServices,
  explainToText,
  explainUserModes,
  isModeString,
} from './explain.js';

describe('the worked example from CLAUDE.md', () => {
  it('turns +mnt into three plain sentences', () => {
    const result = explainChannelModes('+mnt');

    expect(result.parts.map((part) => part.token)).toEqual(['+m', '+n', '+t']);
    expect(explainToText(result)).toBe(
      'Only people with voice or a higher role can send messages. ' +
        'Only people who have joined the channel can send to it. ' +
        'Only operators and above can change the topic.',
    );
  });
});

describe('mode strings', () => {
  it('recognises what is one', () => {
    expect(isModeString('+m')).toBe(true);
    expect(isModeString('+o-v')).toBe(true);
    expect(isModeString('mnt')).toBe(false);
    expect(isModeString('473')).toBe(false);
    expect(isModeString('')).toBe(false);
  });

  it('keeps each letter’s own sign through a compound change', () => {
    const result = explainChannelModes('+m-t');
    expect(result.parts.map((part) => part.token)).toEqual(['+m', '-t']);
  });

  it('says a removed mode is no longer in force rather than inverting the sentence', () => {
    const [part] = explainChannelModes('-m').parts;
    expect(part?.explanation.title).toBe('Moderated — removed');
    expect(part?.explanation.detail).toBe(
      'No longer in force: only people with voice or a higher role can send messages.',
    );
  });

  it('skips letters it has nothing to say about', () => {
    const result = explainChannelModes('+mZ9');
    expect(result.parts.map((part) => part.token)).toEqual(['+m']);
    expect(result.unknown).toBe(false);
  });

  it('reports a mode string it knows nothing about', () => {
    const result = explainChannelModes('+ÿ');
    expect(result.unknown).toBe(true);
    expect(explainToText(result)).toBe('');
  });

  it('explains user modes separately from channel modes', () => {
    expect(explainUserModes('+i').parts[0]?.explanation.title).toBe('Invisible');
    // The same letter on a channel means something entirely different, which is
    // why a caller that knows the kind should say so.
    expect(explainChannelModes('+i').parts[0]?.explanation.title).toBe('Invite only');
  });
});

describe('reading the network’s own mode grouping', () => {
  it('treats a role letter as a role when PREFIX says it is one', () => {
    const result = explainChannelModes('+q', { roleModes: 'qaohv' });
    expect(result.parts[0]?.explanation.title).toBe('Owner');
  });

  it('treats the same letter as a mute when CHANMODES lists it', () => {
    // `q` is ownership on some ircds and a mute list on others. Guessing is how
    // a decoder tells somebody the opposite of the truth.
    const result = explainChannelModes('+q', { listModes: 'beIq' });
    expect(result.parts[0]?.explanation.title).toBe('Mute');
  });

  it('falls back to the common reading with no context', () => {
    expect(explainChannelModes('+q').parts[0]?.explanation.title).toBe('Mute');
  });
});

describe('numerics', () => {
  it('explains one a person can act on', () => {
    expect(explainNumeric('473').parts[0]?.explanation).toEqual({
      title: 'Invite only',
      detail: 'You need an invitation from somebody already inside.',
    });
  });

  it('reports one it has nothing for', () => {
    expect(explainNumeric('999').unknown).toBe(true);
  });
});

describe('CTCP and services', () => {
  it('explains a CTCP request whatever case it arrived in', () => {
    expect(explainCtcp('version').parts[0]?.explanation.title).toBe('Version request');
    expect(explainCtcp('VERSION').parts[0]?.explanation.title).toBe('Version request');
  });

  it('explains a services concept', () => {
    expect(explainServices('CertFP').parts[0]?.explanation.title).toBe('Certificate login');
  });

  it('notes where networks disagree rather than picking one', () => {
    expect(SERVICES_EXPLANATIONS.get('extban')?.caveat).toContain('differs between networks');
  });
});

describe('explaining an unlabelled token', () => {
  it('recognises a numeric', () => {
    expect(explain('433').kind).toBe('numeric');
  });

  it('recognises a channel mode string', () => {
    expect(explain('+mnt').kind).toBe('channel-mode');
  });

  it('falls back to user modes when no channel mode matches', () => {
    expect(explain('+Z').kind).toBe('user-mode');
  });

  it('recognises a CTCP command', () => {
    expect(explain('ACTION').kind).toBe('ctcp');
  });

  it('reports something it cannot place', () => {
    expect(explain('wibble').unknown).toBe(true);
  });
});

describe('the dictionary itself', () => {
  const everyEntry = [
    ...CHANNEL_FLAG_MODES.values(),
    ...CHANNEL_PARAMETER_MODES.values(),
    ...CHANNEL_LIST_MODES.values(),
    ...ROLE_MODES.values(),
    ...USER_MODES.values(),
    ...NUMERIC_EXPLANATIONS.values(),
    ...SERVICES_EXPLANATIONS.values(),
    ...CTCP_EXPLANATIONS.values(),
  ];

  it('says something for every entry', () => {
    for (const entry of everyEntry) {
      expect(entry.title.length, entry.title).toBeGreaterThan(0);
      expect(entry.detail.length, entry.title).toBeGreaterThan(0);
    }
  });

  it('never explains arcana with more arcana', () => {
    // CLAUDE.md: no numeric, mode letter, or raw protocol token in the copy.
    // The decoder is where somebody goes when they do not know these words, so
    // using them in the answer defeats the entire feature.
    const forbidden = [
      /\bmode\s+[+-]/i,
      /(^|\s)[+-][a-zA-Z]{1,4}\b/,
      /\bERR_[A-Z]+\b/,
      /\bRPL_[A-Z]+\b/,
      /\bPRIVMSG\b|\bNOTICE\b|\bKICK\b|\bCHANMODES\b|\bPREFIX\b/,
      /\b\d{3}\b/,
    ];

    for (const entry of everyEntry) {
      const text = `${entry.title} ${entry.detail} ${entry.caveat ?? ''}`;
      for (const pattern of forbidden) {
        expect(pattern.test(text), `${entry.title}: "${text}"`).toBe(false);
      }
    }
  });

  it('ends every sentence, so two entries joined do not run together', () => {
    for (const entry of everyEntry) {
      expect(entry.detail.endsWith('.'), entry.title).toBe(true);
    }
  });

  it('covers every error CLAUDE.md names as needing plain English', () => {
    const named = [
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
      '473',
      '474',
      '475',
      '477',
      '482',
      '484',
    ];
    for (const numeric of named) {
      expect(NUMERIC_EXPLANATIONS.has(numeric), `missing ${numeric}`).toBe(true);
    }
  });

  it('covers every role a PREFIX can advertise', () => {
    for (const mode of ['q', 'a', 'o', 'h', 'v']) {
      expect(ROLE_MODES.has(mode), `missing ${mode}`).toBe(true);
    }
  });
});
