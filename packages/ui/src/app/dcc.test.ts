import { describe, expect, it } from 'vitest';
import { formatAge, formatBytes } from './dcc.js';

describe('formatBytes', () => {
  it('says when a size is unknown', () => {
    expect(formatBytes(undefined)).toBe('Unknown size');
  });

  it('shows small sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales up through the units', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2_411_520)).toBe('2.3 MB');
    expect(formatBytes(8_589_934_592)).toBe('8.0 GB');
  });

  it('drops the decimal once past ten of a unit', () => {
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
  });
});

describe('formatAge', () => {
  const now = 1_000_000_000_000;

  it('reads recent things as just now', () => {
    expect(formatAge(now - 5_000, now)).toBe('just now');
  });

  it('counts up in minutes, hours and days', () => {
    expect(formatAge(now - 3 * 60_000, now)).toBe('3m ago');
    expect(formatAge(now - 2 * 60 * 60_000, now)).toBe('2h ago');
    expect(formatAge(now - 3 * 24 * 60 * 60_000, now)).toBe('3d ago');
  });

  it('never reads negative for a clock that is slightly behind', () => {
    expect(formatAge(now + 5_000, now)).toBe('just now');
  });
});
