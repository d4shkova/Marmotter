import { type NetworkState, initialNetworkState } from '@marmotter/client';
import { DEFAULT_ISUPPORT, applyISupport } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import { detectServices, servicesCommands } from './services.js';

const network = (overrides: Partial<NetworkState> = {}): NetworkState => ({
  ...initialNetworkState('n', 'TestNet', 'marmot'),
  phase: 'registered',
  ...overrides,
});

const withMotd = (...lines: string[]) => network({ motd: lines });

describe('working out which account system a network runs', () => {
  it('recognises Atheme from what the network says about itself', () => {
    expect(detectServices(withMotd('Services provided by Atheme IRC Services'))).toBe('atheme');
  });

  it('recognises Anope', () => {
    expect(detectServices(withMotd('This network runs Anope 2.0'))).toBe('anope');
  });

  // ergo names itself in ISUPPORT, which arrives before anybody has spoken —
  // the only signal available at connect time.
  it('recognises ergo from ISUPPORT before any notice arrives', () => {
    expect(
      detectServices(
        network({ support: applyISupport(DEFAULT_ISUPPORT, ['ERGO', 'CHANTYPES=#']) }),
      ),
    ).toBe('ergo');
  });

  it('recognises ergo under its old name', () => {
    expect(detectServices(withMotd('Powered by oragono'))).toBe('ergo');
  });

  // Guessing wrong is worse than not knowing: the panel that follows still
  // works, and says it is guessing.
  it('admits it cannot tell rather than picking one', () => {
    expect(detectServices(withMotd('Welcome to a network that says nothing useful'))).toBe(
      'unknown',
    );
  });
});

describe('what gets sent to the account service', () => {
  it('registers with the password first on Atheme and Anope', () => {
    expect(servicesCommands('atheme').register('hunter2xy', 'me@example.com')).toBe(
      'PRIVMSG NickServ :REGISTER hunter2xy me@example.com',
    );
    expect(servicesCommands('anope').register('hunter2xy', 'me@example.com')).toBe(
      'PRIVMSG NickServ :REGISTER hunter2xy me@example.com',
    );
  });

  // ergo takes the email first and needs a placeholder when there is none, so
  // sending the Atheme form would register the password as the email address.
  it('registers the other way round on ergo', () => {
    expect(servicesCommands('ergo').register('hunter2xy', 'me@example.com')).toBe(
      'PRIVMSG NickServ :REGISTER me@example.com hunter2xy',
    );
    expect(servicesCommands('ergo').register('hunter2xy', '')).toBe(
      'PRIVMSG NickServ :REGISTER * hunter2xy',
    );
  });

  it('changes a password with SET on Atheme and Anope, and asks for no old one', () => {
    expect(servicesCommands('atheme').passwordChangeNeedsCurrent).toBe(false);
    expect(servicesCommands('atheme').changePassword('', 'newpassword')).toBe(
      'PRIVMSG NickServ :SET PASSWORD newpassword',
    );
  });

  // ergo needs the current password, which is why the panel asks for it there
  // and only there.
  it('changes a password with the current one on ergo', () => {
    expect(servicesCommands('ergo').passwordChangeNeedsCurrent).toBe(true);
    expect(servicesCommands('ergo').changePassword('old', 'newpassword')).toBe(
      'PRIVMSG NickServ :PASSWD old newpassword',
    );
  });

  it('falls back to the form most networks accept when it cannot tell', () => {
    const unknown = servicesCommands('unknown');
    expect(unknown.name).toBeUndefined();
    expect(unknown.register('hunter2xy', 'me@example.com')).toBe(
      'PRIVMSG NickServ :REGISTER hunter2xy me@example.com',
    );
  });

  it('omits the trailing space when registering without an email', () => {
    expect(servicesCommands('atheme').register('hunter2xy', '')).toBe(
      'PRIVMSG NickServ :REGISTER hunter2xy',
    );
  });
});
