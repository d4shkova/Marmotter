/**
 * The logging settings.
 *
 * The whole surface is built around one rule from CLAUDE.md: the user owns
 * their logs, and Marmotter is never a custodian. So it is off until somebody
 * switches it on; the copy says plainly what switching it on does and where the
 * files go; the folder is theirs to choose and to open; and deleting everything
 * is one button rather than a support question.
 *
 * Absent entirely on web, where the platform supplies no store. There is
 * nothing to configure there and a disabled group of controls would imply
 * otherwise.
 */

import type { LoggingPolicy } from '@marmotter/shared';
import { type ReactNode, useState } from 'react';
import { ListGroup } from '../layout/ListGroup.js';
import { Button } from '../primitives/Button.js';
import { ListRow } from '../primitives/ListRow.js';
import { RadioGroup } from '../primitives/Radio.js';
import { Stepper } from '../primitives/Stepper.js';
import { Toggle } from '../primitives/Toggle.js';

export interface LoggingSettingsProps {
  readonly policy: LoggingPolicy;
  readonly onChange: (changes: Partial<LoggingPolicy>) => void;
  /** Where the logs are and what they cost, once the store has been asked. */
  readonly location: { readonly path: string; readonly bytes: number } | undefined;
  readonly onChooseFolder: () => void;
  readonly onOpenFolder: () => void;
  readonly onExport: () => void;
  /** Deletes everything now. Confirmed here rather than acted on immediately. */
  readonly onClear: () => void;
  /** Applies the retention rule now, rather than at the next hourly sweep. */
  readonly onPurgeNow: () => void;
  readonly onSearch: () => void;
}

/** Bytes as something a person reads, rather than a number with ten digits. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }
  const units = ['kB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The retention setting as a sentence, since "0" would read as "delete all". */
export function retentionLabel(days: number | 'forever'): string {
  if (days === 'forever') {
    return 'Kept forever';
  }
  return days === 1 ? 'Kept for a day' : `Kept for ${days} days`;
}

export function LoggingSettings({
  policy,
  onChange,
  location,
  onChooseFolder,
  onOpenFolder,
  onExport,
  onClear,
  onPurgeNow,
  onSearch,
}: LoggingSettingsProps): ReactNode {
  // Deleting every log is not a thing to do on one click. Held here rather than
  // in a modal because it is a two-step within one row, not a question.
  const [confirmingClear, setConfirmingClear] = useState(false);

  const forever = policy.retentionDays === 'forever';
  const days = typeof policy.retentionDays === 'number' ? policy.retentionDays : 30;

  return (
    <ListGroup
      header="Logging"
      footer="Logs are written to this device and never sent anywhere. Marmotter keeps no copy of them and cannot read them once they are on your disk."
    >
      <div className="px-4 py-3">
        <Toggle
          label="Keep a log of conversations"
          hint="Off until you turn it on. Once on, what you choose below is written to files on this device — including private messages, if you include them."
          checked={policy.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
      </div>

      {!policy.enabled ? null : (
        <>
          <div className="flex flex-col gap-3 px-4 py-3">
            <p className="text-footnote text-[var(--label-secondary)]">What to write down</p>
            <Toggle
              label="Channels"
              checked={policy.scope.channels}
              onChange={(channels) => onChange({ scope: { ...policy.scope, channels } })}
            />
            <Toggle
              label="Private messages"
              checked={policy.scope.privateMessages}
              onChange={(privateMessages) =>
                onChange({ scope: { ...policy.scope, privateMessages } })
              }
            />
            <Toggle
              label="Server notices"
              hint="The network's own announcements, which most people do not need kept."
              checked={policy.scope.serverNotices}
              onChange={(serverNotices) => onChange({ scope: { ...policy.scope, serverNotices } })}
            />
          </div>

          <div className="px-4 py-3">
            <RadioGroup
              legend="How it is stored"
              value={policy.format}
              onChange={(format) => onChange({ format: format as LoggingPolicy['format'] })}
              options={[
                {
                  value: 'sqlite',
                  label: 'One searchable file',
                  description:
                    'A database. Searching years of logs is instant, and it is the better choice unless you want to read the files yourself.',
                },
                {
                  value: 'plaintext',
                  label: 'Plain text files',
                  description:
                    'One file per conversation, in the layout HexChat uses, so anything you already use to read logs still works.',
                },
              ]}
            />
          </div>

          <div className="flex flex-col gap-3 px-4 py-3">
            <Toggle
              label="Keep logs forever"
              hint="Off means older lines are deleted on a schedule you set."
              checked={forever}
              onChange={(keep) => onChange({ retentionDays: keep ? 'forever' : 30 })}
            />
            {forever ? null : (
              <Stepper
                label="Delete lines older than"
                value={days}
                min={1}
                max={3650}
                onChange={(retentionDays) => onChange({ retentionDays })}
                format={(value) => (value === 1 ? '1 day' : `${value} days`)}
              />
            )}
          </div>

          <ListRow
            title="Where they are kept"
            subtitle={
              location === undefined
                ? (policy.path ?? 'The app data folder')
                : `${location.path} — ${formatBytes(location.bytes)}`
            }
            trailing={
              <div className="flex items-center gap-1.5">
                <Button size="small" onClick={onChooseFolder}>
                  Change
                </Button>
                <Button size="small" onClick={onOpenFolder}>
                  Open
                </Button>
              </div>
            }
          />

          <ListRow
            title="Search your logs"
            subtitle="Find something said in any conversation, on any network."
            trailing={
              <Button size="small" onClick={onSearch}>
                Search
              </Button>
            }
          />

          <ListRow
            title="Export"
            subtitle="Write the logs out as one file you keep."
            trailing={
              <Button size="small" onClick={onExport}>
                Export
              </Button>
            }
          />

          {forever ? null : (
            <ListRow
              title="Apply the retention rule now"
              subtitle={retentionLabel(policy.retentionDays)}
              trailing={
                <Button size="small" onClick={onPurgeNow}>
                  Delete old lines
                </Button>
              }
            />
          )}

          <ListRow
            title="Delete every log"
            subtitle={
              confirmingClear
                ? 'This cannot be undone. The files are yours, so nothing else has a copy.'
                : 'Removes everything Marmotter has written to this device.'
            }
            trailing={
              confirmingClear ? (
                <div className="flex items-center gap-1.5">
                  <Button size="small" onClick={() => setConfirmingClear(false)}>
                    Keep them
                  </Button>
                  <Button
                    size="small"
                    variant="destructive"
                    onClick={() => {
                      setConfirmingClear(false);
                      onClear();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                <Button size="small" variant="destructive" onClick={() => setConfirmingClear(true)}>
                  Delete
                </Button>
              )
            }
          />
        </>
      )}
    </ListGroup>
  );
}
