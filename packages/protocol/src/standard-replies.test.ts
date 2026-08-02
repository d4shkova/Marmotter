import { describe, expect, it } from 'vitest';
import { parseMessage } from './parse.js';
import {
  describeStandardReply,
  isFatalReply,
  isStandardReply,
  parseStandardReply,
} from './standard-replies.js';

const reply = (line: string) => {
  const result = parseMessage(line);
  if (!result.ok) {
    throw new Error(`fixture failed to parse: ${line}`);
  }
  return parseStandardReply(result.message);
};

const message = (line: string) => {
  const result = parseMessage(line);
  if (!result.ok) {
    throw new Error(`fixture failed to parse: ${line}`);
  }
  return result.message;
};

describe('isStandardReply', () => {
  it.each(['FAIL', 'WARN', 'NOTE'])('recognises %s', (command) => {
    expect(isStandardReply(message(`:srv ${command} * CODE :text`))).toBe(true);
  });

  it('does not recognise an ordinary command', () => {
    expect(isStandardReply(message(':srv PRIVMSG #c :hi'))).toBe(false);
  });
});

describe('parseStandardReply', () => {
  it('reads command, code, and description', () => {
    expect(reply(':srv FAIL JOIN CHANNEL_FULL :The channel is full.')).toEqual({
      severity: 'fail',
      command: 'JOIN',
      code: 'CHANNEL_FULL',
      context: [],
      description: 'The channel is full.',
    });
  });

  it('reads context values between the code and the description', () => {
    expect(
      reply(':srv FAIL JOIN CHANNEL_FULL #marmotter :Cannot join, the channel is full.'),
    ).toEqual({
      severity: 'fail',
      command: 'JOIN',
      code: 'CHANNEL_FULL',
      context: ['#marmotter'],
      description: 'Cannot join, the channel is full.',
    });
  });

  it('reads several context values', () => {
    const parsed = reply(':srv WARN REHASH CONFIG_OUTDATED a b c :Config is out of date.');
    expect(parsed?.context).toEqual(['a', 'b', 'c']);
  });

  it('reads each severity', () => {
    expect(reply(':srv FAIL * X :t')?.severity).toBe('fail');
    expect(reply(':srv WARN * X :t')?.severity).toBe('warn');
    expect(reply(':srv NOTE * X :t')?.severity).toBe('note');
  });

  it('keeps a reply that carries no description', () => {
    // The code is the useful half; dropping the reply would lose it.
    expect(reply(':srv FAIL JOIN CHANNEL_FULL')).toEqual({
      severity: 'fail',
      command: 'JOIN',
      code: 'CHANNEL_FULL',
      context: [],
      description: '',
    });
  });

  it('accepts * as the command', () => {
    expect(reply(':srv FAIL * ACCOUNT_REQUIRED_TO_CONNECT :Register to connect.')?.command).toBe(
      '*',
    );
  });

  it('returns nothing for a malformed reply', () => {
    expect(reply(':srv FAIL')).toBeUndefined();
    expect(reply(':srv FAIL JOIN')).toBeUndefined();
  });

  it('returns nothing for a command that is not a standard reply', () => {
    expect(reply(':srv PRIVMSG #c :hi')).toBeUndefined();
  });
});

describe('isFatalReply', () => {
  it('marks failures that will not change on retry', () => {
    const parsed = reply(':srv FAIL * ACCOUNT_REQUIRED_TO_CONNECT :Register to connect.');
    expect(parsed && isFatalReply(parsed)).toBe(true);
  });

  it('does not mark an ordinary failure fatal', () => {
    const parsed = reply(':srv FAIL JOIN CHANNEL_FULL :Full.');
    expect(parsed && isFatalReply(parsed)).toBe(false);
  });

  it('never marks a warning or a note fatal', () => {
    const warn = reply(':srv WARN * BANNED :x');
    expect(warn && isFatalReply(warn)).toBe(false);
  });
});

describe('describeStandardReply', () => {
  it("prefers the server's own prose", () => {
    const parsed = reply(':srv FAIL JOIN CHANNEL_FULL :Cannot join, the channel is full.');
    expect(parsed && describeStandardReply(parsed)).toBe('Cannot join, the channel is full.');
  });

  it('turns a bare code into a sentence rather than showing it raw', () => {
    const parsed = reply(':srv FAIL JOIN NEED_REGISTRATION');
    expect(parsed && describeStandardReply(parsed)).toBe('Need registration.');
  });

  it('falls back to a sentence when the code is empty too', () => {
    const parsed = reply(':srv FAIL JOIN ""');
    expect(parsed && describeStandardReply(parsed)).toMatch(/\.$/);
  });

  it('never surfaces an underscored code to a person', () => {
    for (const code of ['NEED_REGISTRATION', 'ACCOUNT_REQUIRED_TO_CONNECT', 'INVALID_UTF8']) {
      const parsed = reply(`:srv FAIL * ${code}`);
      const text = parsed === undefined ? '' : describeStandardReply(parsed);
      expect(text).not.toContain('_');
      expect(text.endsWith('.')).toBe(true);
    }
  });
});
