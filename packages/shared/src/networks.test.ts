import { describe, expect, it } from 'vitest';
import { NETWORKS, findNetwork, otherNetworks, popularNetworks } from './networks.js';

describe('the network directory', () => {
  it('lists enough networks to be worth calling a directory', () => {
    expect(NETWORKS.length).toBeGreaterThan(100);
  });

  it('gives every network a unique id', () => {
    expect(new Set(NETWORKS.map((network) => network.id)).size).toBe(NETWORKS.length);
  });

  it('gives every network a unique name', () => {
    expect(new Set(NETWORKS.map((network) => network.name)).size).toBe(NETWORKS.length);
  });

  it('points every one at a host and a usable port', () => {
    for (const network of NETWORKS) {
      expect(network.host, network.name).toMatch(/^[a-z0-9.-]+$/i);
      expect(network.host, network.name).toContain('.');
      expect(network.port, network.name).toBeGreaterThan(0);
      expect(network.port, network.name).toBeLessThanOrEqual(65535);
    }
  });

  it('offers the large networks first', () => {
    const names = popularNetworks().map((network) => network.name);
    for (const expected of ['Libera.Chat', 'EFnet', 'Undernet', 'Rizon']) {
      expect(names).toContain(expected);
    }
    expect(popularNetworks().length + otherNetworks().length).toBe(NETWORKS.length);
  });

  it('sorts everything below them alphabetically, so a name can be found', () => {
    const names = otherNetworks().map((network) => network.name.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  // The `+` in front of a port in the source list is what says "TLS here", and
  // getting it backwards would silently send somebody's password in the clear.
  it('marks the encrypted endpoints as encrypted', () => {
    expect(findNetwork('libera-chat')).toMatchObject({ port: 6697, tls: true });
    expect(findNetwork('efnet')).toMatchObject({ port: 6667, tls: false });
    expect(findNetwork('rizon')).toMatchObject({ port: 6697, tls: true });
    expect(findNetwork('undernet')).toMatchObject({ port: 6667, tls: false });
  });

  it('finds nothing for a network it does not have', () => {
    expect(findNetwork('not-a-network')).toBeUndefined();
  });
});
