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
