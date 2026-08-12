import { describe, expect, it } from 'vitest';
import {
  MAX_NOTICES,
  foldNotice,
  noticeKey,
  shouldAnnounceDownload,
  type Notice,
  type ShellNotice,
} from './notices.js';

/** Raises a run of notices, giving each a predictable id. */
const raise = (notices: readonly Notice[]): readonly ShellNotice[] =>
  notices.reduce<readonly ShellNotice[]>(
    (current, notice, index) => foldNotice(current, notice, `id-${index}`),
    [],
  );

describe('notices that repeat', () => {
  it('folds an identical notice into the one already up', () => {
    // A serving bot re-offers a pack every few seconds. Each failed attempt used
    // to add its own notice, and with nothing clearing them the screen filled.
    const up = raise([
      { text: "Couldn't reach Libera.Chat.", tone: 'error' },
      { text: "Couldn't reach Libera.Chat.", tone: 'error' },
      { text: "Couldn't reach Libera.Chat.", tone: 'error' },
    ]);

    expect(up).toHaveLength(1);
    expect(up[0]?.repeats).toBe(3);
    expect(up[0]?.text).toBe("Couldn't reach Libera.Chat.");
  });

  it('gives the replacement a new id, so its countdown starts again', () => {
    // The toast times itself off its identity. Keeping the id would leave the
    // newest word on a situation inheriting a nearly spent countdown.
    const up = raise([{ text: 'Still trying.' }, { text: 'Still trying.' }]);

    expect(up[0]?.id).toBe('id-1');
  });

  it('keeps the same wording apart when the tone differs', () => {
    const up = raise([
      { text: 'Logs written to /tmp/log.txt.' },
      { text: 'Logs written to /tmp/log.txt.', tone: 'error' },
    ]);

    expect(up).toHaveLength(2);
  });

  it('replaces in place rather than jumping to the end of the stack', () => {
    // Moving it would shuffle the stack under somebody reading the notice above.
    const up = raise([{ text: 'First.' }, { text: 'Second.' }, { text: 'First.' }]);

    expect(up.map((entry) => entry.text)).toEqual(['First.', 'Second.']);
    expect(up[0]?.repeats).toBe(2);
  });
});

describe('notices grouped under a key', () => {
  const saved = (filename: string): Notice => ({
    key: 'dcc-saved',
    text: (files) => (files === 1 ? `Saved ${filename}.` : `Saved ${files} files.`),
  });

  it('counts a queue of downloads as one notice', () => {
    // A queue of twenty packs landing is one thing that happened, not twenty.
    const up = raise([saved('marmot.zip'), saved('otter.zip'), saved('badger.zip')]);

    expect(up).toHaveLength(1);
    expect(up[0]?.text).toBe('Saved 3 files.');
  });

  it('names the file when only one arrived', () => {
    expect(raise([saved('marmot.zip')])[0]?.text).toBe('Saved marmot.zip.');
  });

  it('keeps two different groups apart', () => {
    const up = raise([
      saved('marmot.zip'),
      { key: 'dcc-requested', text: (packs) => `Requested ${packs}.` },
    ]);

    expect(up).toHaveLength(2);
  });
});

describe('how tall the stack may get', () => {
  it('drops the oldest once it is full', () => {
    const up = raise(
      Array.from({ length: MAX_NOTICES + 2 }, (_, index) => ({ text: `Notice ${index}.` })),
    );

    expect(up).toHaveLength(MAX_NOTICES);
    expect(up[0]?.text).toBe('Notice 2.');
    expect(up.at(-1)?.text).toBe(`Notice ${MAX_NOTICES + 1}.`);
  });

  it('does not count a repeat against the ceiling', () => {
    // Four things happening is a full stack; one thing happening four times is
    // one notice, and must not push anything off.
    let up = raise([{ text: 'One.' }, { text: 'Two.' }]);
    for (let again = 0; again < 10; again += 1) {
      up = foldNotice(up, { text: 'Two.' }, `again-${again}`);
    }

    expect(up.map((entry) => entry.text)).toEqual(['One.', 'Two.']);
    expect(up[1]?.repeats).toBe(11);
  });
});

describe('what counts as the same notice', () => {
  it('is the message itself when nothing says otherwise', () => {
    expect(noticeKey({ text: 'Saved marmot.zip.' })).toBe('info:Saved marmot.zip.');
    expect(noticeKey({ text: 'Gone.', tone: 'error' })).toBe('error:Gone.');
  });

  it('is the key when one is given, whatever the wording', () => {
    expect(noticeKey({ key: 'dcc-saved', text: () => 'anything' })).toBe('dcc-saved');
  });
});

describe('a download reporting how it got on', () => {
  it('says nothing while the file list is showing it', () => {
    // The row already reads Requested, or Saved, or is back to a Download
    // button. Repeating that over the top of the list is noise.
    expect(shouldAnnounceDownload('dcc')).toBe(false);
  });

  it('says it anywhere else, where nothing else would', () => {
    for (const pane of ['chat', 'settings', 'people', 'raw-log'] as const) {
      expect(shouldAnnounceDownload(pane), pane).toBe(true);
    }
  });
});
