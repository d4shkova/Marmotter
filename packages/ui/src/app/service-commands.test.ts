import { describe, expect, it } from 'vitest';
import {
  serviceCommandBody,
  serviceCommands,
  serviceDisplayName,
  serviceForTarget,
} from './service-commands.js';

describe('serviceForTarget', () => {
  it('recognises NickServ and ChanServ, whatever the case', () => {
    expect(serviceForTarget('NickServ')).toBe('nickserv');
    expect(serviceForTarget('nickserv')).toBe('nickserv');
    expect(serviceForTarget('CHANSERV')).toBe('chanserv');
  });

  it('is undefined for anything else', () => {
    expect(serviceForTarget('tamsin')).toBeUndefined();
    expect(serviceForTarget('#marmotter')).toBeUndefined();
    expect(serviceForTarget(undefined)).toBeUndefined();
  });
});

describe('serviceCommands', () => {
  it('hides operator commands unless an operator is asking', () => {
    const common = serviceCommands('nickserv');
    expect(common.every((command) => command.operator !== true)).toBe(true);

    const withOperator = serviceCommands('nickserv', { operator: true });
    expect(withOperator.some((command) => command.operator === true)).toBe(true);
    expect(withOperator.length).toBeGreaterThan(common.length);
  });

  it('offers both services their own commands', () => {
    expect(serviceCommands('nickserv').some((command) => command.name === 'IDENTIFY')).toBe(true);
    expect(serviceCommands('chanserv').some((command) => command.name === 'REGISTER')).toBe(true);
    expect(serviceCommands('chanserv').some((command) => command.name === 'ACCESS')).toBe(true);
  });

  it('covers the account commands somebody actually reaches for', () => {
    const names = serviceCommands('nickserv', { operator: true }).map((command) => command.name);
    for (const name of ['ACCESS', 'AJOIN', 'ALIST', 'CERT', 'CONFIRM', 'DROP', 'GLIST']) {
      expect(names).toContain(name);
    }
  });

  it('covers the channel commands somebody actually reaches for', () => {
    const names = serviceCommands('chanserv', { operator: true }).map((command) => command.name);
    for (const name of ['BAN', 'UNBAN', 'DROP', 'GETKEY', 'HELP', 'INFO', 'LIST', 'REGISTER']) {
      expect(names).toContain(name);
    }
  });

  it('names each command once, so the menu has no duplicate rows', () => {
    for (const service of ['nickserv', 'chanserv'] as const) {
      const names = serviceCommands(service, { operator: true }).map((command) => command.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('groups the operator commands together at the end', () => {
    // The menu draws its separator where the first operator command starts, so
    // an ordinary command below one would land on the wrong side of the line.
    for (const service of ['nickserv', 'chanserv'] as const) {
      const commands = serviceCommands(service, { operator: true });
      const first = commands.findIndex((command) => command.operator === true);
      expect(first).toBeGreaterThan(-1);
      expect(commands.slice(first).every((command) => command.operator === true)).toBe(true);
    }
  });

  it('writes every summary as a sentence, not a syntax line', () => {
    // CLAUDE.md: plain verbs, sentence case, and never a raw protocol token in
    // primary copy. The shape goes in the label; the sentence explains it.
    for (const service of ['nickserv', 'chanserv'] as const) {
      for (const command of serviceCommands(service, { operator: true })) {
        expect(command.summary).toMatch(/^[A-Z].*\.$/);
        expect(command.summary).not.toContain('<');
      }
    }
  });
});

describe('serviceCommandBody', () => {
  it('is the command word with its argument placeholders', () => {
    expect(serviceCommandBody({ name: 'IDENTIFY', args: '<password>', summary: '' })).toBe(
      'IDENTIFY <password>',
    );
    expect(serviceCommandBody({ name: 'HELP', summary: '' })).toBe('HELP');
  });
});

describe('serviceDisplayName', () => {
  it('names each service as it is addressed', () => {
    expect(serviceDisplayName('nickserv')).toBe('NickServ');
    expect(serviceDisplayName('chanserv')).toBe('ChanServ');
  });
});
