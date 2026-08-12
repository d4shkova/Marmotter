import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

// jsdom implements neither CSS.escape nor scrollIntoView, both of which the
// suggestion popup uses to keep the highlighted row visible. Browsers have had
// both for years; this is the test environment being thin, not the component
// reaching for anything exotic.
beforeAll(() => {
  if (typeof globalThis.CSS?.escape !== 'function') {
    vi.stubGlobal('CSS', {
      ...globalThis.CSS,
      escape: (value: string) => value.replace(/[^\w-]/g, '\\$&'),
    });
  }
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

afterEach(cleanup);

const noop = (): void => {};

/** The composer as it stands in an ordinary conversation. */
function composer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  return (
    <Composer
      value=""
      onChange={noop}
      onSend={noop}
      target="#marmotter"
      nicks={[]}
      channels={[]}
      fold={(text) => text.toLowerCase()}
      {...overrides}
    />
  );
}

describe('right-clicking the message box', () => {
  it('offers the client commands where there is no service behind it', () => {
    render(composer());

    fireEvent.contextMenu(screen.getByRole('textbox'));
    // The slash-command list, which is what an empty box offers everywhere else.
    expect(screen.getByRole('listbox')).toBeDefined();
  });

  it("asks for the service's own commands in a services conversation", () => {
    const onServiceMenu = vi.fn();
    render(composer({ target: 'NickServ', onServiceMenu }));

    fireEvent.contextMenu(screen.getByRole('textbox'), { clientX: 120, clientY: 400 });

    expect(onServiceMenu).toHaveBeenCalledWith({ x: 120, y: 400 });
    // And the client's own command list stays out of the way, rather than both
    // appearing at once.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('leaves the platform menu alone once something has been typed', () => {
    // With text in the box, cut and copy are what the menu is for. This is the
    // existing rule and the service menu does not change it.
    const onServiceMenu = vi.fn();
    render(composer({ target: 'NickServ', value: 'IDENTIFY hunter2', onServiceMenu }));

    const event = fireEvent.contextMenu(screen.getByRole('textbox'));

    expect(onServiceMenu).not.toHaveBeenCalled();
    // `fireEvent` returns false when the handler called preventDefault.
    expect(event).toBe(true);
  });
});
