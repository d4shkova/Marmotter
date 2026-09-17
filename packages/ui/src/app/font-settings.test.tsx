import { DEFAULT_CTCP_POLICY } from '@marmotter/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTERFACE_FONTS, MESSAGE_FONTS } from '../fonts.js';
import { Settings } from './Settings.js';
import { DEFAULT_APPEARANCE, DEFAULT_USER_OPTIONS, type Appearance } from './view-store.js';

afterEach(cleanup);

const noop = (): void => {};

function open(onAppearanceChange: (changes: Partial<Appearance>) => void = noop): void {
  render(
    <Settings
      networks={[]}
      appearance={DEFAULT_APPEARANCE}
      onAppearanceChange={onAppearanceChange}
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
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
}

describe('choosing the type', () => {
  it('offers a face for each thing that needs one', () => {
    open();
    expect(screen.getByLabelText(/Interface font/)).toBeTruthy();
    expect(screen.getByLabelText(/Message font/)).toBeTruthy();
  });

  it('offers seven of each, which is what was asked for', () => {
    open();
    const interfaceFont = screen.getByLabelText(/Interface font/) as HTMLSelectElement;
    const messageFont = screen.getByLabelText(/Message font/) as HTMLSelectElement;

    expect(interfaceFont.options).toHaveLength(7);
    expect(messageFont.options).toHaveLength(7);
    expect([...interfaceFont.options].map((option) => option.value)).toEqual(
      INTERFACE_FONTS.map((font) => font.id),
    );
    expect([...messageFont.options].map((option) => option.value)).toEqual(
      MESSAGE_FONTS.map((font) => font.id),
    );
  });

  it('changes only the face that was chosen', () => {
    const onAppearanceChange = vi.fn();
    open(onAppearanceChange);

    fireEvent.change(screen.getByLabelText(/Interface font/), { target: { value: 'serif' } });
    expect(onAppearanceChange).toHaveBeenCalledWith({ interfaceFont: 'serif' });

    fireEvent.change(screen.getByLabelText(/Message font/), { target: { value: 'courier' } });
    expect(onAppearanceChange).toHaveBeenCalledWith({ messageFont: 'courier' });
  });

  // A native option cannot be drawn in the family it names — the platform draws
  // the popup — so without this a person is picking a font by its reputation.
  it('shows a line of each face, in that face', () => {
    open();
    const group = screen.getByText('Type').closest('section');
    const samples = [...(group?.querySelectorAll('p') ?? [])].filter(
      (node) => node.style.fontFamily !== '',
    );
    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(samples[0]?.style.fontFamily).toContain('-apple-system');
    expect(samples[1]?.style.fontFamily).toContain('SF Mono');
  });
});
