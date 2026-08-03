import { describe, expect, it } from 'vitest';
import { defaultLoggingPolicy, defaultServerEndpoint } from './profile.js';

describe('profile defaults', () => {
  it('defaults a new endpoint to TLS on 6697 with verification on', () => {
    const endpoint = defaultServerEndpoint('irc.libera.chat');
    expect(endpoint.port).toBe(6697);
    expect(endpoint.tls).toEqual({ mode: 'tls', verifyCert: true });
  });

  it('leaves logging off by default', () => {
    expect(defaultLoggingPolicy.enabled).toBe(false);
  });
});
