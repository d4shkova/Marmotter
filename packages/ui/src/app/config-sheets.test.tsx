import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_IDENTITY } from '@marmotter/shared';
import { ExportConfig, ImportConfig } from './ConfigTransfer.js';
import { buildConfig, serializeConfig } from './config-transfer.js';
import { DEFAULT_SETTINGS } from './stored-settings.js';

afterEach(cleanup);

const noop = (): void => {};

const document = serializeConfig(
  buildConfig({
    identity: { ...EMPTY_IDENTITY, nick: 'tamsin' },
    networks: [
      {
        id: 'libera',
        name: 'Libera.Chat',
        servers: [{ host: 'irc.libera.chat', port: 6697, tls: { mode: 'tls', verifyCert: true } }],
        identity: { nick: 'tamsin', altNicks: [], username: 'tamsin', realname: 'tamsin' },
        autojoin: [],
        connectCommands: [],
        encoding: 'utf-8',
        autoReconnect: true,
      },
    ],
    settings: DEFAULT_SETTINGS,
    now: new Date('2026-08-29T12:00:00Z'),
  }),
);

/**
 * Copying is the feature and the file is the extra. A phone and a browser tab
 * can both put text on a clipboard; only a desktop can write a file, and a
 * feature that needed one would have been a desktop feature with a phone
 * footnote — which is the opposite of what this is for.
 */
describe('exporting your settings', () => {
  it('offers the text on every platform', () => {
    render(<ExportConfig open onClose={noop} text={document} onReport={noop} />);

    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByLabelText('Your settings')).toHaveProperty('value', document);
  });

  it('offers no Save where the platform has no save dialog', () => {
    render(<ExportConfig open onClose={noop} text={document} onReport={noop} />);

    expect(screen.queryByRole('button', { name: 'Save to a file' })).toBeNull();
  });

  it('writes the file where it has one, and says where it went', async () => {
    const onSaveFile = vi.fn(async () => '/home/tamsin/marmotter-settings.json');
    const onReport = vi.fn();
    render(
      <ExportConfig
        open
        onClose={noop}
        text={document}
        onSaveFile={onSaveFile}
        onReport={onReport}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save to a file' }));

    await waitFor(() => expect(onReport).toHaveBeenCalled());
    expect(onSaveFile).toHaveBeenCalledWith('marmotter-settings.json', document);
    expect(onReport.mock.calls[0]?.[0]).toContain('/home/tamsin/marmotter-settings.json');
  });

  it('says nothing when the save dialog was cancelled, which is not a failure', async () => {
    const onReport = vi.fn();
    render(
      <ExportConfig
        open
        onClose={noop}
        text={document}
        onSaveFile={async () => undefined}
        onReport={onReport}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save to a file' }));
    await Promise.resolve();

    expect(onReport).not.toHaveBeenCalled();
  });

  it('says what is not in the file, where somebody is deciding to trust it', () => {
    render(<ExportConfig open onClose={noop} text={document} onReport={noop} />);

    expect(screen.getByText(/Passwords and channel keys are not included/)).toBeTruthy();
  });
});

describe('importing settings', () => {
  const paste = (text: string): void => {
    fireEvent.change(screen.getByLabelText('Settings file'), { target: { value: text } });
  };

  it('will not replace anything until something has been pasted', () => {
    render(<ImportConfig open onClose={noop} onApply={noop} paths={{}} onReport={noop} />);

    expect(screen.getByRole('button', { name: 'Replace my settings' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows what the file contains before anything changes', () => {
    render(<ImportConfig open onClose={noop} onApply={noop} paths={{}} onReport={noop} />);

    paste(document);

    expect(screen.getByText(/1 network/)).toBeTruthy();
    expect(screen.getAllByText(/Libera\.Chat/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Replace my settings' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('says what is wrong with text that is not a settings file', () => {
    render(<ImportConfig open onClose={noop} onApply={noop} paths={{}} onReport={noop} />);

    paste('nonsense');

    expect(screen.getAllByText(/not a settings file/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Replace my settings' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('hands over the document it read, rather than the text it was given', () => {
    const onApply = vi.fn();
    render(<ImportConfig open onClose={noop} onApply={onApply} paths={{}} onReport={noop} />);

    paste(document);
    fireEvent.click(screen.getByRole('button', { name: 'Replace my settings' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({ identity: { nick: 'tamsin' } });
  });

  it('says nothing connects on its own afterwards', () => {
    render(<ImportConfig open onClose={noop} onApply={noop} paths={{}} onReport={noop} />);

    paste(document);

    expect(screen.getByText(/nothing connects on its own/)).toBeTruthy();
  });

  it('loads a file where the platform has an open dialog', async () => {
    const onOpenFile = vi.fn(async () => document);
    render(
      <ImportConfig
        open
        onClose={noop}
        onApply={noop}
        onOpenFile={onOpenFile}
        paths={{}}
        onReport={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load from a file' }));

    await waitFor(() => expect(screen.getByText(/1 network/)).toBeTruthy());
  });

  it('offers no file button where the platform has no dialog', () => {
    render(<ImportConfig open onClose={noop} onApply={noop} paths={{}} onReport={noop} />);

    expect(screen.queryByRole('button', { name: 'Load from a file' })).toBeNull();
  });
});
