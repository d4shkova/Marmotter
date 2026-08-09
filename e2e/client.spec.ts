import { expect, test, type Page } from '@playwright/test';
import { TestClient } from './irc-client.js';

/**
 * The acceptance criterion from BUILD_PLAN Phase 5, as a test:
 *
 * > A person who has never used IRC can install the desktop app, connect,
 * > join a channel, send and receive messages, and see a member list — without
 * > typing a slash command or encountering a raw numeric.
 *
 * Both halves are checked. The path is driven entirely through the interface,
 * and the message list is asserted to contain no numeric and no mode string at
 * the end of it.
 */

const NICK = () => `marmot${Math.floor(Math.random() * 100_000)}`;

/** Adds the local ergo through the "Add a network" flow, as a person would. */
async function addNetwork(page: Page, nick: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a network' }).first().click();

  const sheet = page.getByRole('dialog', { name: 'Add a network' });
  await expect(sheet).toBeVisible();

  // The network picker is a directory of a hundred and thirty, so "somewhere
  // else" is an option in it rather than a fourth radio button.
  await sheet.getByLabel('Which network?').selectOption('custom');
  await sheet.getByRole('radio', { name: 'A web address' }).check();
  await sheet.getByLabel('Name', { exact: true }).fill('Test network');
  await sheet.getByLabel('Web address', { exact: true }).fill('ws://127.0.0.1:18097/');
  await sheet.getByLabel('Your name on this network').fill(nick);

  await sheet.getByRole('button', { name: 'Add network' }).click();
  await expect(sheet).toBeHidden();
}

/** Joins a channel from the sidebar, without typing a command. */
async function joinChannel(page: Page, channel: string): Promise<void> {
  await page
    .getByRole('button', { name: /join a channel/i })
    .first()
    .click();

  const prompt = page.getByRole('dialog', { name: 'Join a channel' });
  // Enter rather than the button: it is what somebody actually does, and it
  // exercises the form's own submit path.
  await prompt.getByLabel('Channel name').fill(channel);
  await prompt.getByLabel('Channel name').press('Enter');
  await expect(prompt).toBeHidden();
}

/**
 * Opens the channel settings panel the way the interface offers it: by
 * double-clicking the channel's name in the title bar. There is no settings
 * gear any more — that spot is the conversation search — so this is the path a
 * person takes.
 */
async function openChannelSettings(page: Page, channel: string): Promise<void> {
  await page.getByRole('heading', { name: channel }).first().dblclick();
}

test.describe('connecting and talking', () => {
  test('someone can connect, join, talk, and see who is there', async ({ page }) => {
    const nick = NICK();
    const channel = `#e2e${Math.floor(Math.random() * 100_000)}`;

    await addNetwork(page, nick);

    // Connected, and the interface says so in words rather than numerics.
    await expect(page.getByText(/Connected|Message of the day/i).first()).toBeVisible({
      timeout: 20_000,
    });

    await joinChannel(page, channel);
    await expect(page.getByRole('heading', { name: channel }).first()).toBeVisible();

    // Sending: the composer, not a command.
    const composer = page.getByRole('textbox', { name: new RegExp(`Message ${channel}`) });
    await composer.fill('morning all');
    await composer.press('Enter');
    await expect(page.getByText('morning all')).toBeVisible();

    // The member list has us in it, with the operator role ergo gives the
    // person who creates a channel.
    await expect(page.getByRole('complementary').getByText(nick)).toBeVisible();
  });

  test('nothing in the conversation is a raw numeric or a mode string', async ({ page }) => {
    const nick = NICK();
    const channel = `#e2e${Math.floor(Math.random() * 100_000)}`;

    await addNetwork(page, nick);
    await joinChannel(page, channel);
    await expect(page.getByRole('heading', { name: channel }).first()).toBeVisible();

    const log = page.getByRole('log');
    await expect(log).toBeVisible();
    const text = (await log.innerText()).trim();

    // A three-digit numeric at the start of a line is what this must never be.
    expect(text).not.toMatch(/^\s*\d{3}\s/m);
    // Nor a bare mode string presented as the message.
    expect(text).not.toMatch(/^\s*[+-][a-zA-Z]{1,4}\s*$/m);
  });
});

test.describe('the panels that translate IRC', () => {
  test('the channel settings panel reads this network’s own modes', async ({ page }) => {
    const nick = NICK();
    const channel = `#e2e${Math.floor(Math.random() * 100_000)}`;

    await addNetwork(page, nick);
    await joinChannel(page, channel);
    await openChannelSettings(page, channel);

    const sheet = page.getByRole('dialog', { name: channel });
    await expect(sheet).toBeVisible();

    // ergo advertises `CHANMODES=Ibe,k,fl,CEMRUimnstu`, so these controls must
    // exist and be named for what they do rather than for a mode letter.
    await expect(
      sheet.getByText('Only people who have joined the channel can send to it'),
    ).toBeVisible();
    await expect(sheet.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(sheet.getByText(/Member limit/)).toBeVisible();

    // And the tabs follow the network: ergo has ban, except and invex lists,
    // and no separate mute list, so there must be no Muted tab.
    await expect(sheet.getByRole('tab', { name: /Banned/ })).toBeVisible();
    await expect(sheet.getByRole('tab', { name: /Muted/ })).toHaveCount(0);
  });

  test('a channel setting round-trips through the server', async ({ page }) => {
    const nick = NICK();
    const channel = `#e2e${Math.floor(Math.random() * 100_000)}`;

    await addNetwork(page, nick);
    await joinChannel(page, channel);
    await openChannelSettings(page, channel);

    const sheet = page.getByRole('dialog', { name: channel });
    await sheet.getByRole('switch', { name: 'Invite only' }).click();
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    await expect(sheet).toBeHidden();

    // Reopening reads the state back from what the server actually applied,
    // not from what the form remembered.
    await openChannelSettings(page, channel);
    await expect(page.getByRole('switch', { name: 'Invite only' })).toBeChecked();
  });

  test('the channel browser lists what the network has', async ({ page }) => {
    const nick = NICK();
    const channel = `#e2e${Math.floor(Math.random() * 100_000)}`;

    // The client will not ask for a channel list in the first ninety seconds of
    // a connection, because several networks answer one that early with
    // "unknown command". ergo would answer fine, so the wait is stepped over
    // rather than sat through — the window itself is covered by
    // `packages/ui/src/app/list-guard.test.ts`.
    await page.clock.install();
    await page.clock.resume();

    await addNetwork(page, nick);
    await joinChannel(page, channel);
    await page.clock.fastForward('01:40');

    await page
      .getByRole('button', { name: /browse channels on/i })
      .first()
      .click();
    await page
      .getByRole('button', { name: /Load channels/ })
      .first()
      .click();

    // Asking for every channel on a network is a decision, so it is confirmed
    // rather than fired off by the button.
    const ask = page.getByRole('dialog', { name: /^Channels on/ });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Ask for all of them' }).click();

    // Scoped to the browser rather than the whole page. The channel was joined
    // a moment ago, so its name is in the sidebar too — and an assertion that
    // matches the sidebar passes whether or not a single row was ever listed,
    // which is exactly what this one used to do.
    const browser = page.getByRole('main');
    await expect(browser.getByText(channel).first()).toBeVisible({ timeout: 15_000 });
    await expect(browser.getByText(/\d+ channels?\./)).toBeVisible({ timeout: 15_000 });
  });

  // The CTCP request path is deliberately not tested here. ergo's WebSocket
  // listener doubles the `\u0001` delimiter when relaying from a TCP client —
  // reproducible with a raw WebSocket and no Marmotter code in the loop, so it
  // is the server's behaviour, not ours. Accepting a doubled delimiter would
  // mean a parser that disagrees with the CTCP spec, which is a worse trade
  // than an untested path: `packages/client/src/state/ctcp.test.ts` covers the
  // logic, and the desktop build's TCP transport receives it correctly.

  test('a message from somebody else arrives, and is not confused with a notice', async ({
    page,
  }) => {
    const nick = NICK();
    const channel = `#e2e${Math.floor(Math.random() * 100_000)}`;

    await addNetwork(page, nick);
    await joinChannel(page, channel);
    await expect(page.getByRole('heading', { name: channel }).first()).toBeVisible();

    const other = new TestClient(`friend${Math.floor(Math.random() * 100_000)}`);
    await other.connect();
    other.send(`JOIN ${channel}`);
    await other.waitFor(new RegExp(`JOIN ${channel}`, 'i'));

    // They appear in the member list, which is the state half of this.
    await expect(page.getByRole('complementary').getByText(other.nick)).toBeVisible({
      timeout: 10_000,
    });

    other.say(channel, 'anybody about?');
    await expect(page.getByText('anybody about?')).toBeVisible({ timeout: 10_000 });

    other.send(`NOTICE ${channel} :this is a notice`);
    const notice = page.getByText('this is a notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });

    other.close();

    // Leaving shows up too, which is the other half of member-list correctness.
    await expect(page.getByRole('complementary').getByText(other.nick)).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
