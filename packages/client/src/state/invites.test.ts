import { describe, expect, it } from 'vitest';
import { feed, registeredSession } from './harness.js';

const invited = ':tamsin!~t@host.example INVITE marmot :#ircv3';

describe('invitations', () => {
  it('keeps one as something to act on, not only as a line that scrolls away', () => {
    const session = feed(registeredSession(), [invited]);
    expect(session.state.invites).toEqual([
      { channel: '#ircv3', from: 'tamsin', at: expect.any(Date) as Date },
    ]);
  });

  // `invite-notify` reports invitations sent to other people too. Those are
  // somebody else's business and must not appear as ours to accept.
  it('ignores one addressed to somebody else', () => {
    const session = feed(registeredSession(), [':tamsin!~t@host.example INVITE jonquil :#ircv3']);
    expect(session.state.invites).toEqual([]);
  });

  it('does not stack repeats of the same invitation', () => {
    const session = feed(registeredSession(), [invited, invited]);
    expect(session.state.invites).toHaveLength(1);
  });

  it('answers the invitation by walking in, however the join happened', () => {
    const session = feed(registeredSession(), [invited, ':marmot!~m@host JOIN #ircv3']);
    expect(session.state.invites).toEqual([]);
  });

  it('leaves it alone when somebody else joins the channel', () => {
    const session = feed(registeredSession(), [invited, ':tamsin!~t@host JOIN #ircv3']);
    expect(session.state.invites).toHaveLength(1);
  });

  it('matches the channel through the network’s casemapping, not by spelling', () => {
    const session = feed(registeredSession(), [invited, ':marmot!~m@host JOIN #IRCv3']);
    expect(session.state.invites).toEqual([]);
  });

  it('still shows the invitation in the server tab', () => {
    const session = feed(registeredSession(), [invited]);
    const notice = session.state.serverNotices.at(-1);
    expect(notice?.kind).toBe('invite');
    expect(notice?.text).toBe('tamsin invited you to #ircv3');
  });
});
