import { type NetworkState, initialNetworkState } from '@marmotter/client';
import { DEFAULT_ISUPPORT, applyISupport } from '@marmotter/protocol';
import { describe, expect, it } from 'vitest';
import { detectServices, probeServices, servicesCommands, servicesProbed } from './services.js';

const network = (overrides: Partial<NetworkState> = {}): NetworkState => ({
  ...initialNetworkState('n', 'TestNet', 'marmot'),
  phase: 'registered',
  ...overrides,
});

const withMotd = (...lines: string[]) => network({ motd: lines });

/** A network that has answered a version question from NickServ. */
const answered = (version: string) => network({ ctcpVersions: new Map([['nickserv', version]]) });

describe('working out which account system a network runs', () => {
  // The authoritative source, and the only one that works on a network which
  // never mentions its services in prose — which, tested against a real
  // Anope-on-InspIRCd, is every network by default.
  it('reads the package out of the services version reply', () => {
    expect(
      detectServices(
        answered('Anope-2.0.12 services.example :InspIRCd 3 - (enc_sha256) -- build #1'),
      ),
    ).toBe('anope');
    expect(detectServices(answered('atheme-services-7.2.12. services.example'))).toBe('atheme');
  });

  it('asks NickServ, and only once', () => {
    expect(probeServices()).toBe('PRIVMSG NickServ :\u0001VERSION\u0001');
    expect(servicesProbed(network())).toBe(false);
    expect(servicesProbed(answered('Anope-2.0.12'))).toBe(true);
  });

  // ergo is its own ircd as well as its own services, and says so in `005`
  // before anybody has spoken.
  it('recognises ergo from ISUPPORT without asking', () => {
    expect(
      detectServices(
        network({ support: applyISupport(DEFAULT_ISUPPORT, ['ERGO', 'CHANTYPES=#']) }),
      ),
    ).toBe('ergo');
  });

  it('still reads a network that names its services in the MOTD', () => {
    expect(detectServices(withMotd('Services provided by Atheme IRC Services'))).toBe('atheme');
    expect(detectServices(withMotd('This network runs Anope 2.0'))).toBe('anope');
    expect(detectServices(withMotd('Powered by oragono'))).toBe('ergo');
  });

  // Guessing wrong is worse than not knowing: the panel that follows still
  // works, and says it is guessing.
  it('admits it cannot tell rather than picking one', () => {
    expect(detectServices(withMotd('Welcome to a network that says nothing useful'))).toBe(
      'unknown',
    );
  });

  it('lets the version reply overrule what the MOTD happened to say', () => {
    const confusing = {
      ...withMotd('Welcome. This channel is about Atheme development.'),
      ctcpVersions: new Map([['nickserv', 'Anope-2.0.12 services.example']]),
    };
    expect(detectServices(confusing)).toBe('anope');
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
