/**
 * Keeping a floating thing inside the window.
 *
 * A menu opened from a click lands wherever the pointer was, and on a small
 * window that is regularly close enough to an edge that the menu runs off it.
 * What falls off is the end of the list — which is where the destructive
 * actions live, so the failure is not merely cosmetic.
 *
 * Pure arithmetic, deliberately: the measuring is the component's job and the
 * deciding is testable without a DOM.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly left: number;
  readonly top: number;
  /** What the thing may grow to before it has to scroll inside itself. */
  readonly maxHeight: number;
}

/** How close to the window edge anything is allowed to sit. */
const MARGIN = 8;

/** The least usable height, below which scrolling inside is better than flipping. */
const MIN_HEIGHT = 120;

/**
 * Where to draw something of `size`, anchored at `at`, inside `viewport`.
 *
 * Prefers down and to the right of the anchor, which is what a pointer user
 * expects. Flips to the other side when that side has no room, and clamps when
 * neither side does — a menu wider than the window is pinned to the margin and
 * scrolls rather than being pushed off.
 */
export function fit(at: Point, size: Size, viewport: Size): Placement {
  const left =
    at.x + size.width + MARGIN > viewport.width
      ? Math.max(MARGIN, Math.min(at.x - size.width, viewport.width - size.width - MARGIN))
      : at.x;

  const below = viewport.height - at.y - MARGIN;
  const above = at.y - MARGIN;
  // Flipping up is only an improvement when there is genuinely more room up
  // there; otherwise the menu stays where it was asked for and scrolls.
  const flip = size.height > below && above > below;
  const maxHeight = Math.max(MIN_HEIGHT, flip ? above : below);
  const height = Math.min(size.height, maxHeight);

  const top = flip
    ? Math.max(MARGIN, at.y - height)
    : Math.max(MARGIN, Math.min(at.y, viewport.height - height - MARGIN));

  return { left, top, maxHeight };
}
