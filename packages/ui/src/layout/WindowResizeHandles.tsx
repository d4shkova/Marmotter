import type { ReactNode } from 'react';

/**
 * An edge or corner of the window, as somewhere to drag from.
 *
 * Named for where it is rather than by compass point, so the layout stays in
 * the language the rest of this package uses; the desktop shell maps these onto
 * whatever its window API calls them.
 */
export type WindowEdge =
  'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface WindowResizeHandlesProps {
  /** Begins a resize from that edge. Called on press, not on click. */
  readonly onResize: (edge: WindowEdge) => void;
}

/**
 * How wide the grab area is along an edge, and how big the corner squares are.
 *
 * Kept to a few pixels on purpose: a strip along the right-hand edge sits over
 * whatever scrollbar is there, and a wide one would take the scrollbar's thumb
 * with it. Four is enough to aim at and narrow enough to leave the rest.
 */
const EDGE = 4;
const CORNER = 12;

/**
 * The eight invisible grips around the window's border.
 *
 * The window is drawn without the OS's decorations — the title bar is ours —
 * and that takes the resize border away with them: there is nothing along the
 * window's edge for a pointer to grab, so it could only be resized by
 * maximising it. These put that back. They are strips a few pixels wide, fixed
 * to the frame above everything else, carrying nothing but a cursor and a
 * pointer-down that hands the drag to the window manager.
 *
 * Only a build with a window to resize renders them; the web build passes no
 * handler and nothing is drawn, since a browser tab is sized by the browser.
 */
export function WindowResizeHandles({ onResize }: WindowResizeHandlesProps): ReactNode {
  const grip = (
    edge: WindowEdge,
    cursor: string,
    style: Readonly<Record<string, string | number>>,
  ): ReactNode => (
    <div
      key={edge}
      aria-hidden="true"
      data-window-resize={edge}
      onPointerDown={(event) => {
        // Left button only, and never a press that began inside something else:
        // starting a window drag out of a click on a control would swallow it.
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        onResize(edge);
      }}
      // Above the sheets and modals: a window stays resizable while a dialog
      // is open, and a 4px strip is not how anybody dismisses one.
      className="fixed z-[60]"
      style={{ cursor, ...style }}
    />
  );

  return (
    <>
      {grip('top', 'ns-resize', { top: 0, left: CORNER, right: CORNER, height: EDGE })}
      {grip('bottom', 'ns-resize', { bottom: 0, left: CORNER, right: CORNER, height: EDGE })}
      {grip('left', 'ew-resize', { left: 0, top: CORNER, bottom: CORNER, width: EDGE })}
      {grip('right', 'ew-resize', { right: 0, top: CORNER, bottom: CORNER, width: EDGE })}
      {grip('top-left', 'nwse-resize', { top: 0, left: 0, width: CORNER, height: CORNER })}
      {grip('top-right', 'nesw-resize', { top: 0, right: 0, width: CORNER, height: CORNER })}
      {grip('bottom-left', 'nesw-resize', { bottom: 0, left: 0, width: CORNER, height: CORNER })}
      {grip('bottom-right', 'nwse-resize', { bottom: 0, right: 0, width: CORNER, height: CORNER })}
    </>
  );
}
