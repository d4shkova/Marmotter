import { describe, expect, it } from 'vitest';
import { fitsMessageLimit } from '@marmotter/protocol';
import { defaultServerEndpoint } from '@marmotter/shared';

/**
 * Phase 0 smoke test: the workspace graph resolves. `pnpm test` runs before
 * `pnpm build`, so this also proves tests read package sources, not `dist/`.
 */
describe('workspace wiring', () => {
  it('resolves @marmotter/protocol', () => {
    expect(fitsMessageLimit('PING :marmotter')).toBe(true);
  });

  it('resolves @marmotter/shared', () => {
    expect(defaultServerEndpoint('irc.dashkova.co.uk').host).toBe('irc.dashkova.co.uk');
  });
});
