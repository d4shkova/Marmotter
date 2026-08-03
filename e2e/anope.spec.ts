import { expect, test } from '@playwright/test';
import { parseAccessListing } from '../packages/ui/src/app/chanserv.js';
import { TestClient } from './irc-client.js';

/**
 * The second half of Phase 6's acceptance: the same translation layer against a
 * different services package on a different ircd.
 *
 * The criterion is not about Anope in particular — it is about two
 * implementations that disagree, so that a panel shaped around one of them gets
 * caught. It earned its keep immediately. Real Anope names the role in the
 * level column of its access list rather than giving a number, so the parser
 * found nothing and the grid showed empty on a channel that had entries; and
 * nothing a client sees during registration names the services package at all,
 * so detection had to be rebuilt around the version reply.
 *
 * InspIRCd has no WebSocket listener and a browser cannot open a TCP socket, so
 * this drives the protocol and translation layers directly. The interface is
 * covered against ergo in `client.spec.ts`.
 */

const suffix = (): number => Math.floor(Math.random() * 1_000_000);

// Services link a moment after the ircd starts listening, so the first test to
// run waits for NickServ rather than racing it.
test.beforeAll(async () => {
  const probe = new TestClient(`wait${suffix()}`);
  await probe.connect(16668);
  await probe.waitForNick('NickServ');
  probe.close();
});

/** Registers an account and returns the client holding it. */
async function registered(nick: string): Promise<TestClient> {
  const client = new TestClient(nick);
  await client.connect(16668);
  client.send(`PRIVMSG NickServ :REGISTER pass12345 ${nick}@example.invalid`);
  await client.waitFor(/registered/i);
  return client;
}

/** Service replies, with the wrapper stripped, as the panels read them. */
const noticesFrom = (client: TestClient): readonly string[] =>
  client
    .linesSoFar()
    .filter((line) => /NOTICE/.test(line))
    .map((line) => line.replace(/^:\S+ NOTICE \S+ :?/, ''));

test.describe('against Anope', () => {
  test('says what it is when asked, which is the only way to tell', async () => {
    const probe = new TestClient(`probe${suffix()}`);
    await probe.connect(16668);

    // Checked rather than assumed, because detection used to depend on it:
    // nothing a client is told during registration names the package.
    expect(probe.linesSoFar().join('\n')).not.toMatch(/anope/i);

    probe.ctcp('NickServ', 'VERSION');
    expect(await probe.waitFor(/NOTICE .*VERSION/)).toMatch(/Anope/);

    probe.close();
  });

  test('accepts the account commands the panel builds', async () => {
    const client = await registered(`acct${suffix()}`);

    client.send('PRIVMSG NickServ :SET PASSWORD newpassword1');
    expect(await client.waitFor(/Password for .* changed/i)).toBeTruthy();

    client.send('PRIVMSG NickServ :SET EMAIL other@example.invalid');
    expect(await client.waitFor(/E-mail address .* changed/i)).toBeTruthy();

    client.send('PRIVMSG HostServ :REQUEST somewhere/nice');
    expect(await client.waitFor(/vHost has been requested/i)).toBeTruthy();

    client.close();
  });

  test('accepts the permissions commands, and answers in the shape we parse', async () => {
    const channel = `#acc${suffix()}`;
    const owner = await registered(`owner${suffix()}`);
    const member = await registered(`member${suffix()}`);

    owner.send(`JOIN ${channel}`);
    await owner.waitFor(new RegExp(`JOIN :?${channel}`, 'i'));
    owner.send(`PRIVMSG ChanServ :REGISTER ${channel}`);
    await owner.waitFor(/registered under your account/i);

    owner.send(`PRIVMSG ChanServ :AOP ${channel} ADD ${member.nick}`);
    await owner.waitFor(new RegExp(`added to ${channel} AOP list`, 'i'));

    owner.clear();
    owner.send(`PRIVMSG ChanServ :ACCESS ${channel} LIST`);
    await owner.waitFor(/End of access list/i);

    // The rows exactly as the service printed them, through the parser the
    // panel uses. This is the assertion the whole file exists for.
    const entries = parseAccessListing(noticesFrom(owner), 'roles');
    expect(entries.map((entry) => entry.target)).toContain(member.nick);
    expect(entries.find((entry) => entry.target === member.nick)?.role).toBe('AOP');

    owner.close();
    member.close();
  });
});
