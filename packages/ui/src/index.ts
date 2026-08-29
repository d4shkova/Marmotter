/**
 * @marmotter/ui — design system and React components.
 *
 * Import the stylesheet once per app:
 *
 *   import '@marmotter/ui/styles.css';
 *
 * Phase 4 of BUILD_PLAN.md: the primitives, the iOS grouped-list conventions,
 * the nav and tab bars, and the decoder.
 *
 * Every component references design tokens through `var()` and never a literal
 * colour, so a theme is a token swap rather than a refactor. `tokens.test.ts`
 * and `no-literals.test.ts` enforce that rather than trusting it.
 */

export * from './themes.js';
export * from './lib/cn.js';
export * from './lib/focus.js';
export * from './lib/keyboard.js';
export * from './lib/long-press.js';
export * from './lib/nick-color.js';

export * from './primitives/Avatar.js';
export * from './primitives/Badge.js';
export * from './primitives/Button.js';
export * from './primitives/Checkbox.js';
export * from './primitives/ContextMenu.js';
export * from './primitives/EmptyState.js';
export * from './primitives/Field.js';
export * from './primitives/IconButton.js';
export * from './primitives/ListRow.js';
export * from './primitives/Modal.js';
export * from './primitives/Popover.js';
export * from './primitives/Radio.js';
export * from './primitives/SearchField.js';
export * from './primitives/SegmentedControl.js';
export * from './primitives/Select.js';
export * from './primitives/Sheet.js';
export * from './primitives/Spinner.js';
export * from './primitives/Stepper.js';
export * from './primitives/SwipeRow.js';
export * from './primitives/Table.js';
export * from './primitives/Tabs.js';
export * from './primitives/TextField.js';
export * from './primitives/Toast.js';
export * from './primitives/Toggle.js';
export * from './primitives/Tooltip.js';

export * from './layout/ListGroup.js';
export * from './layout/NavBar.js';
export * from './layout/TitleBar.js';
export * from './layout/WindowResizeHandles.js';
export * from './layout/TabBar.js';

export * from './app/index.js';

export * from './decoder/Decoder.js';
export * from './decoder/dictionary.js';
export * from './decoder/explain.js';
