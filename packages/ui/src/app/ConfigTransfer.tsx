import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { Field } from '../primitives/Field.js';
import { Sheet } from '../primitives/Sheet.js';
import {
  CONFIG_FILENAME,
  describeConfig,
  parseConfig,
  type ConfigImport,
  type DevicePaths,
} from './config-transfer.js';

/**
 * What the settings file does and does not carry, in the one place somebody is
 * deciding whether to trust it with their configuration.
 *
 * Said on both screens rather than only on the export: the person importing may
 * not be the person who exported — the same person an hour later, on a different
 * device, is close enough to a stranger — and "where did my passwords go" is a
 * question worth answering before it is asked.
 */
const CONTENTS = 'Your networks, your name, and everything on this screen.';
const EXCLUSIONS =
  'Passwords and channel keys are not included, and neither are your logs or any messages. ' +
  'Each network keeps how it signs in and under which account, so you type the password once on the other device.';

export interface ExportConfigProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The document, already serialized. */
  readonly text: string;
  /**
   * Saves it to a file the user picks, resolving to where it went.
   *
   * Absent where the platform has no save dialog — Android, where the settings
   * travel by copying the text. Every platform can copy; only some can save.
   */
  readonly onSaveFile?: (suggestedName: string, text: string) => Promise<string | undefined>;
  /** Says how it went, in the shell's own toast. */
  readonly onReport: (message: string, tone?: 'error') => void;
}

/**
 * The settings, as text to take to another device.
 *
 * A box of text with a Copy button, and a Save where the platform has somewhere
 * to save to. The text is the feature rather than the file: copying works on a
 * phone, in a browser tab and on a desktop alike, and a file that only two of
 * the three can write would have made this a desktop feature with a phone
 * footnote — which is the opposite of what it is for.
 */
export function ExportConfig({
  open,
  onClose,
  text,
  onSaveFile,
  onReport,
}: ExportConfigProps): ReactNode {
  const copy = (): void => {
    // `clipboard` is absent over plain HTTP and in a webview that withheld it,
    // in which case the text is on screen and selectable, which is the fallback.
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      onReport('Select the text and copy it — this device gave no clipboard.', 'error');
      return;
    }
    void clipboard
      .writeText(text)
      .then(() => onReport('Your settings are on the clipboard.'))
      .catch(() => onReport('Could not copy. Select the text and copy it instead.', 'error'));
  };

  const save = (): void => {
    if (onSaveFile === undefined) {
      return;
    }
    void onSaveFile(CONFIG_FILENAME, text)
      .then((path) => {
        if (path !== undefined) {
          onReport(`Settings written to ${path}.`);
        }
      })
      .catch((error: unknown) => onReport(`Could not write the file. ${String(error)}`, 'error'));
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Export your settings"
      size="wide"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
          {onSaveFile === undefined ? null : (
            <Button variant="secondary" onClick={save}>
              Save to a file
            </Button>
          )}
          <Button variant="primary" onClick={copy}>
            Copy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-footnote text-[var(--label-secondary)]">
          {CONTENTS} Take this to your other device and paste it into Import settings there.
        </p>
        <p className="text-footnote text-[var(--label-tertiary)]">{EXCLUSIONS}</p>

        <Field id="config-export" label="Your settings" labelHidden>
          <textarea
            id="config-export"
            readOnly
            spellCheck={false}
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            className={cn(
              'h-64 w-full resize-none rounded-control bg-[var(--fill-tertiary)] px-3 py-2',
              'font-mono text-caption-1 text-[var(--label-secondary)]',
              'border border-transparent focus:border-[var(--separator)]',
            )}
          />
        </Field>
      </div>
    </Sheet>
  );
}

export interface ImportConfigProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Applies a document that has already been read and understood. */
  readonly onApply: (config: ConfigImport) => void;
  /**
   * Reads a file the user picks, resolving to its text.
   *
   * Absent where the platform has no open dialog, exactly as on the export.
   */
  readonly onOpenFile?: () => Promise<string | undefined>;
  /** This device's folders, filled into a document that carries none. */
  readonly paths: DevicePaths;
  readonly onReport: (message: string, tone?: 'error') => void;
}

/**
 * Taking settings from another device.
 *
 * The document is read as it is typed, so what the file contains is on screen
 * before anything is replaced — and the button says how many networks it is
 * about to replace rather than "Import". Replacing somebody's whole
 * configuration is not a thing to find out about afterwards.
 */
export function ImportConfig({
  open,
  onClose,
  onApply,
  onOpenFile,
  paths,
  onReport,
}: ImportConfigProps): ReactNode {
  const [text, setText] = useState('');

  // Cleared whenever it reopens: the last import's document is not a draft
  // somebody wants back, and leaving it there invites applying it twice.
  useEffect(() => {
    if (open) {
      setText('');
    }
  }, [open]);

  const result = useMemo(() => parseConfig(text, paths), [text, paths]);

  const load = (): void => {
    if (onOpenFile === undefined) {
      return;
    }
    void onOpenFile()
      .then((loaded) => {
        if (loaded !== undefined) {
          setText(loaded);
        }
      })
      .catch((error: unknown) => onReport(`Could not read the file. ${String(error)}`, 'error'));
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Import settings"
      size="wide"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {onOpenFile === undefined ? null : (
            <Button variant="secondary" onClick={load}>
              Load from a file
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!result.ok}
            onClick={() => {
              if (result.ok) {
                onApply(result.config);
              }
            }}
          >
            Replace my settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-footnote text-[var(--label-secondary)]">
          Paste a settings file exported from another Marmotter. {CONTENTS} What is here now is
          replaced.
        </p>
        <p className="text-footnote text-[var(--label-tertiary)]">{EXCLUSIONS}</p>

        <Field
          id="config-import"
          label="Settings file"
          labelHidden
          {...(result.ok ? {} : text.trim() === '' ? {} : { error: result.problem })}
        >
          <textarea
            id="config-import"
            spellCheck={false}
            value={text}
            placeholder="Paste your settings here"
            onChange={(event) => setText(event.target.value)}
            className={cn(
              'h-48 w-full resize-none rounded-control bg-[var(--fill-tertiary)] px-3 py-2',
              'font-mono text-caption-1 text-[var(--label-primary)]',
              'placeholder:text-[var(--label-quaternary)]',
              'border border-transparent focus:border-[var(--separator)]',
              // Big enough to type into on a phone, where a 12px field makes a
              // mobile browser zoom the page on focus.
              'pointer-coarse:text-footnote',
            )}
          />
        </Field>

        <div aria-live="polite" className="text-footnote text-[var(--label-secondary)]">
          {text.trim() === '' ? (
            <p className="text-[var(--label-tertiary)]">
              Nothing pasted yet. Nothing is replaced until you choose to.
            </p>
          ) : result.ok ? (
            <Summary config={result.config} />
          ) : (
            <p className="text-[var(--danger)]">{result.problem}</p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** What is in the pasted document, before any of it is applied. */
function Summary({ config }: { config: ConfigImport }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <p>This will bring in {describeConfig(config)}</p>
      {config.networks.length === 0 ? null : (
        <p className="text-[var(--label-tertiary)]">
          {config.networks.map((network) => network.name).join(', ')}
        </p>
      )}
      {config.skippedNetworks === 0 ? null : (
        <p className="text-[var(--danger)]">
          {config.skippedNetworks === 1
            ? '1 network in this file could not be read and will be left out.'
            : `${config.skippedNetworks} networks in this file could not be read and will be left out.`}
        </p>
      )}
      {config.exportedAt === undefined ? null : (
        <p className="text-[var(--label-tertiary)]">
          Exported {new Date(config.exportedAt).toLocaleString()}
          {config.app === undefined ? '' : ` by Marmotter ${config.app}`}.
        </p>
      )}
      <p className="text-[var(--label-tertiary)]">
        Anything connected now closes, and nothing connects on its own afterwards — each network
        comes back as a row you can connect when you want to.
      </p>
    </div>
  );
}
