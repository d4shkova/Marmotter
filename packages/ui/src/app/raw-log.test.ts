import { describe, expect, it } from 'vitest';
import { visible } from './RawLog.js';

describe('what the raw log shows', () => {
  it('makes the CTCP delimiter visible, since that is the distinction', () => {
    // Without this a `DCC SEND` and somebody typing the words "DCC SEND" are
    // the same line on screen — which is exactly the question this tab gets
    // opened to answer.
    expect(visible('\x01DCC SEND f.bin 3232235879 45859 1\x01')).toBe(
      '␁DCC SEND f.bin 3232235879 45859 1␁',
    );
  });

  it('shows the formatting codes a bot colours its packlist with', () => {
    expect(visible('\x0304#26 0x [1.8G] test.tar\x03')).toBe('␃04#26 0x [1.8G] test.tar␃');
  });

  it('leaves an ordinary line exactly as it was', () => {
    const line = ':nick!user@host PRIVMSG #chan :hello there';
    expect(visible(line)).toBe(line);
  });
});
