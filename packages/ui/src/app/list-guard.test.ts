import { describe, expect, it } from 'vitest';
import { LIST_SETTLE_MS, describeWait, listReadiness } from './list-guard.js';

const at = (offsetMs: number) => new Date(Date.UTC(2026, 7, 3, 12, 0, 0) + offsetMs);

describe('when a channel list is worth asking for', () => {
  it('is not, before the server has signed us in', () => {
    expect(listReadiness({ registeredAt: undefined }, at(0)).ready).toBe(false);
  });

  // The failure this exists for: a LIST sent in the first seconds comes back as
  // `421`, which reads as "this network doesn't recognise LIST" — untrue, and
  // it teaches somebody the feature is broken rather than early.
  it('is not, in the first moments of a connection', () => {
    const readiness = listReadiness({ registeredAt: at(0) }, at(10_000));
    expect(readiness.ready).toBe(false);
    expect(readiness.waitSeconds).toBe(80);
  });

  it('is, once the network has settled', () => {
    expect(listReadiness({ registeredAt: at(0) }, at(LIST_SETTLE_MS)).ready).toBe(true);
    expect(listReadiness({ registeredAt: at(0) }, at(LIST_SETTLE_MS + 1)).waitSeconds).toBe(0);
  });

  it('rounds the wait up, so it never says zero while still waiting', () => {
    expect(listReadiness({ registeredAt: at(0) }, at(LIST_SETTLE_MS - 1)).waitSeconds).toBe(1);
  });

  it('says what happened and what to do, without naming a numeric', () => {
    const message = describeWait('Libera.Chat', 42);
    expect(message).toContain('Libera.Chat');
    expect(message).toContain('42 seconds');
    expect(message).not.toMatch(/421|LIST/);
  });

  it('counts one second as one second', () => {
    expect(describeWait('OFTC', 1)).toContain('1 second.');
  });
});
