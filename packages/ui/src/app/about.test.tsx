import { DEFAULT_CTCP_POLICY } from '@marmotter/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings.js';
import { DEFAULT_APPEARANCE, DEFAULT_USER_OPTIONS } from './view-store.js';
import { APP_VERSION } from './version.js';

afterEach(cleanup);

const noop = (): void => {};

function open(onOpenLink?: (url: string) => void): void {
  render(
    <Settings
      networks={[]}
      appearance={DEFAULT_APPEARANCE}
      onAppearanceChange={noop}
      ctcp={DEFAULT_CTCP_POLICY}
      onCtcpChange={noop}
      userOptions={DEFAULT_USER_OPTIONS}
      onUserOptionsChange={noop}
      dccAvailable={false}
      onReconnect={noop}
      onDisconnect={noop}
      onEdit={noop}
      onRemove={noop}
      onAddNetwork={noop}
      onResetSettings={noop}
      onExportConfig={noop}
      onImportConfig={noop}
      {...(onOpenLink === undefined ? {} : { onOpenLink })}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'About' }));
}

describe('saying what this is and where it came from', () => {
  it('names the version it is running', () => {
    open();
    expect(screen.getByText('Version')).toBeTruthy();
    expect(screen.getByText(APP_VERSION ?? 'Development build')).toBeTruthy();
  });

  // The address is on the row whether or not this build can open it: a browser
  // tab with no opener still has to be able to tell somebody where the source
  // is, and a link that only works by being clicked cannot be read out.
  it('shows the address even where nothing can open it', () => {
    open();
    expect(screen.getByText('https://github.com/d4shkova/Marmotter')).toBeTruthy();
  });

  it('opens the repository through the same confirmation as any other link', () => {
    const onOpenLink = vi.fn();
    open(onOpenLink);

    fireEvent.click(screen.getByText('Source code'));
    expect(onOpenLink).toHaveBeenCalledWith('https://github.com/d4shkova/Marmotter');
  });
});
