import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LoggingPolicy } from '@marmotter/shared';
import { LoggingSettings } from './LoggingSettings.js';

afterEach(cleanup);

const policy: LoggingPolicy = {
  enabled: true,
  scope: { channels: true, privateMessages: true, serverNotices: false },
  format: 'plaintext',
  retentionDays: 30,
};

const required = {
  policy,
  onChange: () => {},
  location: undefined,
  onClear: () => {},
  onPurgeNow: () => {},
  onSearch: () => {},
};

/**
 * Android has no folder picker, no save dialog, and no file manager that will
 * open an app's own storage. A button for any of those would be a control that
 * looks live and does nothing, which is worse than its absence — so each one is
 * drawn only where the platform passed something to back it.
 */
describe('the logging settings on a platform without file pickers', () => {
  it('offers every control where the platform backs them all', () => {
    render(
      <LoggingSettings
        {...required}
        onChooseFolder={() => {}}
        onOpenFolder={() => {}}
        onExport={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
  });

  it('draws none of them where it backs none', () => {
    render(<LoggingSettings {...required} />);

    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });

  it('still says where the logs are kept', () => {
    render(<LoggingSettings {...required} />);

    expect(screen.getByText('Where they are kept')).toBeTruthy();
  });
});
