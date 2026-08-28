import { useEffect, useState } from 'react';

/**
 * How much of the window the software keyboard is covering, in pixels.
 *
 * Zero on a desktop, and zero on a phone until somebody taps the composer.
 *
 * Two different things can happen when an Android keyboard opens, and which
 * one depends on the page's viewport meta. With `interactive-widget=
 * resizes-content` — what `apps/android/index.html` asks for — the layout
 * viewport itself shrinks, `100dvh` shrinks with it, and there is nothing left
 * for this hook to do: it measures zero and the layout has already adjusted.
 * Without it, or on a WebView too old to honour it, the layout viewport keeps
 * its full height and the keyboard is drawn over the bottom of it. The composer
 * is then underneath the keyboard, which is the one place it must never be.
 *
 * So this measures the gap directly, from `visualViewport` — the part of the
 * page actually on screen — rather than trusting either behaviour. What is
 * wanted is the strip of the layout viewport below the visible region, and the
 * visible region runs from `offsetTop` to `offsetTop + height`: the browser can
 * scroll the visual viewport within the layout viewport independently of the
 * page, and doing so moves the bottom of what is on screen down. Padding by
 * height alone would over-pad by exactly that scroll.
 *
 * A browser without `visualViewport` reports zero and the layout is left alone,
 * which is what it did before this existed.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (viewport === undefined || viewport === null) {
      return;
    }

    const measure = (): void => {
      const hidden = window.innerHeight - viewport.height - viewport.offsetTop;
      // Rounded and floored: sub-pixel viewport heights are normal, and a
      // fraction of a pixel of padding is a re-render for nothing. The small
      // threshold keeps a rounding difference from reading as a keyboard.
      setInset(hidden > 1 ? Math.round(hidden) : 0);
    };

    measure();
    viewport.addEventListener('resize', measure);
    // The visual viewport scrolls inside the layout viewport independently of
    // the page, and that scroll is not a window `scroll` event.
    viewport.addEventListener('scroll', measure);
    return () => {
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
    };
  }, []);

  return inset;
}
