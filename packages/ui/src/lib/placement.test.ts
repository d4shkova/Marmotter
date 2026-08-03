import { describe, expect, it } from 'vitest';
import { fit } from './placement.js';

const viewport = { width: 1000, height: 700 };
const menu = { width: 220, height: 300 };

describe('fitting a menu into the window', () => {
  it('opens down and to the right when there is room', () => {
    expect(fit({ x: 100, y: 100 }, menu, viewport)).toMatchObject({ left: 100, top: 100 });
  });

  // The failure this exists for: a menu opened near the right edge used to run
  // off it, and what fell off was the end of the list — where the destructive
  // actions are.
  it('flips to the left of the pointer rather than off the right edge', () => {
    expect(fit({ x: 950, y: 100 }, menu, viewport).left).toBe(730);
  });

  it('flips above the pointer rather than off the bottom', () => {
    expect(fit({ x: 100, y: 650 }, menu, viewport).top).toBe(350);
  });

  it('pins to the margin when neither side has room', () => {
    const tight = fit({ x: 10, y: 10 }, { width: 1200, height: 300 }, viewport);
    expect(tight.left).toBe(8);
  });

  it('offers a height to scroll within rather than growing past the window', () => {
    const short = fit({ x: 100, y: 100 }, { width: 220, height: 5_000 }, viewport);
    expect(short.maxHeight).toBeLessThanOrEqual(viewport.height);
    expect(short.top).toBeGreaterThanOrEqual(8);
  });

  it('never places anything above the top of the window', () => {
    expect(fit({ x: 100, y: 4 }, menu, viewport).top).toBeGreaterThanOrEqual(0);
  });
});
