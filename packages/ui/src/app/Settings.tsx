import type { NetworkState } from '@marmotter/client';
import { DEFAULT_VERSION_TEXT, type CtcpPolicy } from '@marmotter/protocol';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { StatusDot } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { ListRow } from '../primitives/ListRow.js';
import { Stepper } from '../primitives/Stepper.js';
import { TextField } from '../primitives/TextField.js';
import { Toggle } from '../primitives/Toggle.js';
import { ListGroup } from '../layout/ListGroup.js';
import { connectionStatus, connectionStatusText } from './network-status.js';
import { LoggingSettings, type LoggingSettingsProps } from './LoggingSettings.js';
import { ThemePicker } from './ThemePicker.js';
import {
  TOAST_SECONDS_RANGE,
  clampToastSeconds,
  type Appearance,
  type UserOptions,
} from './view-store.js';

export interface SettingsProps {
  readonly networks: readonly NetworkState[];
  readonly appearance: Appearance;
  readonly onAppearanceChange: (changes: Partial<Appearance>) => void;
  readonly ctcp: CtcpPolicy;
  readonly onCtcpChange: (changes: Partial<CtcpPolicy>) => void;
  readonly userOptions: UserOptions;
  readonly onUserOptionsChange: (changes: Partial<UserOptions>) => void;
  /**
   * The logging controls, or absent where the platform keeps nothing.
   *
   * Absent on web rather than disabled: there is no store there to configure,
   * and a greyed-out group would imply logging is a thing that could be
   * switched on in a browser tab. It cannot.
   */
  readonly logging?: LoggingSettingsProps;
  /** The name new networks start from, and a way back to the form that set it. */
  readonly identity?: { readonly nick: string; readonly onEdit: () => void };
  /**
   * Whether this platform can run the DCC file monitor at all.
   *
   * False on web, where the User Options group is left out entirely — a browser
   * tab has no folder to write to and cannot open the direct connection a
   * download needs.
   */
  readonly dccAvailable: boolean;
  /** Opens the platform folder picker for where downloads are saved. */
  /**
   * Opens the folder picker. Absent where the platform has none, and then the
   * row shows the folder the shell chose rather than a button that cannot open
   * anything.
   */
  readonly onChooseDownloadFolder?: () => void;
  /** Reconnects a network whose connection dropped or failed. */
  readonly onReconnect: (networkId: string) => void;
  readonly onDisconnect: (networkId: string) => void;
  /** Opens the network's saved settings for changing. */
  readonly onEdit: (networkId: string) => void;
  /** Forgets a network and tears its connection down. */
  readonly onRemove: (networkId: string) => void;
  readonly onAddNetwork: () => void;
  /**
   * Puts every setting on this screen back the way it shipped.
   *
   * Settings only. Networks, the saved name and anything already written to
   * disk are the user's data rather than a preference, and the copy says so —
   * a button that took those under this label would be a nasty surprise.
   */
  readonly onResetSettings: () => void;
  /**
   * Shows this device's settings as text to take to another one.
   *
   * Offered on every platform, including web, where it is the only way settings
   * outlive the tab. What travels is the configuration, never a password and
   * never a message — the sheet itself says so.
   */
  readonly onExportConfig: () => void;
  /** Takes settings exported from another Marmotter. */
  readonly onImportConfig: () => void;
  readonly className?: string;
}

/**
 * The settings screen.
 *
 * This is where a network is removed from — the one place a person expects to
 * manage the networks they have added — and where a failed connection can be
 * retried with the reason for the failure shown next to it, rather than a
 * server tab that says "connecting" forever.
 *
 * The appearance controls change the message list live, so a person can see
 * what right-aligned nicks or a wider nick column does to the density they are
 * about to read a thousand lines at.
 */
export function Settings({
  networks,
  appearance,
  onAppearanceChange,
  ctcp,
  onCtcpChange,
  userOptions,
  onUserOptionsChange,
  logging,
  identity,
  dccAvailable,
  onChooseDownloadFolder,
  onReconnect,
  onDisconnect,
  onEdit,
  onRemove,
  onAddNetwork,
  onResetSettings,
  onExportConfig,
  onImportConfig,
  className,
}: SettingsProps): ReactNode {
  // Two steps, like deleting the logs: it undoes every choice on this screen at
  // once, and a misplaced click should not be able to do that.
  const [confirmingReset, setConfirmingReset] = useState(false);

  const [section, setSection] = useState<SectionId>('networks');
  const shown = (id: SectionId): boolean => section === id;

  return (
    <div className={className} style={SETTINGS_CHROME}>
      <div className="mx-auto flex h-full max-w-5xl flex-col px-4 py-5">
        <h1 className="mb-4 text-title-3 font-semibold text-[var(--label-primary)]">Settings</h1>

        <div className="flex min-h-0 flex-1 gap-6 max-sm:flex-col">
          {/* The section rail. Uppercase and letter-spaced, with the active row
            carrying the accent — the shape NS3H uses for its sidebar, which is
            what stops a settings screen being one long scroll where nothing can
            be found twice. It becomes a scrolling strip on a phone, where there
            is no room beside the content for it. */}
          <nav
            aria-label="Settings sections"
            className={cn(
              'shrink-0 max-sm:-mx-1 max-sm:overflow-x-auto',
              'sm:w-44 sm:border-r sm:border-[var(--separator)] sm:pr-2',
            )}
          >
            <ul className="flex gap-0.5 max-sm:flex-row sm:flex-col">
              {SECTIONS.filter((entry) => entry.id !== 'logging' || logging !== undefined).map(
                (entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={shown(entry.id) ? 'page' : undefined}
                      onClick={() => setSection(entry.id)}
                      className={cn(
                        'w-full rounded-control px-2.5 py-1.5 text-left whitespace-nowrap',
                        'text-caption-1 font-semibold tracking-wide uppercase',
                        'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
                        shown(entry.id)
                          ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                          : 'text-[var(--label-tertiary)] hover:bg-[var(--fill-quaternary)] hover:text-[var(--label-secondary)]',
                      )}
                    >
                      {entry.label}
                    </button>
                  </li>
                ),
              )}
            </ul>
          </nav>

          {/* Capped rather than stretched: a settings row whose control sits a
              window's width from its label is harder to read, not easier. */}
          <div className="flex min-w-0 max-w-2xl flex-1 flex-col gap-5 overflow-y-auto pb-2">
            {!shown('networks') || identity === undefined ? null : (
              <ListGroup
                header="You"
                footer="The name new networks start from. Each network can still use a different one."
              >
                <ListRow
                  title="Your name"
                  subtitle={identity.nick === '' ? 'Not set' : identity.nick}
                  trailing={
                    <Button size="small" onClick={identity.onEdit}>
                      {identity.nick === '' ? 'Set' : 'Change'}
                    </Button>
                  }
                />
              </ListGroup>
            )}

            {!shown('networks') ? null : (
              <ListGroup
                header="Networks"
                footer="Networks are stored on this device only, and never sent anywhere."
              >
                {networks.length === 0 ? (
                  <ListRow title="No networks yet" subtitle="Add one to start talking." />
                ) : (
                  networks.map((network) => (
                    <ListRow
                      key={network.id}
                      leading={<StatusDot status={connectionStatus(network)} />}
                      title={network.name}
                      subtitle={connectionStatusText(network)}
                      trailing={
                        <div className="flex items-center gap-1.5">
                          {network.phase === 'registered' || network.phase === 'registering' ? (
                            <Button size="small" onClick={() => onDisconnect(network.id)}>
                              Disconnect
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              variant="secondary"
                              busy={network.phase === 'connecting'}
                              onClick={() => onReconnect(network.id)}
                            >
                              {network.phase === 'connecting' ? 'Connecting' : 'Connect'}
                            </Button>
                          )}
                          {/* Address, name, security and nick are all things that
                        turn out to be wrong after the first connection
                        attempt, and starting over with Remove and Add loses
                        everything else the profile holds. */}
                          <Button size="small" onClick={() => onEdit(network.id)}>
                            Edit
                          </Button>
                          <Button
                            size="small"
                            variant="destructive"
                            onClick={() => onRemove(network.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      }
                    />
                  ))
                )}
              </ListGroup>
            )}

            {!shown('networks') ? null : (
              <div className="px-1">
                <Button variant="primary" onClick={onAddNetwork}>
                  Add a network
                </Button>
              </div>
            )}

            {!shown('appearance') ? null : (
              <ListGroup
                header="Appearance"
                footer="The whole window changes at once, and the choice is kept for next time."
              >
                <ListRow
                  title="Theme"
                  subtitle="What Marmotter is drawn in."
                  trailing={
                    <ThemePicker
                      value={appearance.theme}
                      onChange={(theme) => onAppearanceChange({ theme })}
                    />
                  }
                />
              </ListGroup>
            )}

            {!shown('appearance') ? null : (
              <ListGroup
                header="Message list"
                footer="These change how messages are laid out. The window updates as you change them."
              >
                <div className="px-4 py-2.5">
                  <Toggle
                    label="Group join, part and quit messages"
                    hint="Folds a burst of them into one line, rather than showing each."
                    checked={appearance.foldEvents}
                    onChange={(foldEvents) => onAppearanceChange({ foldEvents })}
                  />
                </div>
                <div className="px-4 py-2.5">
                  <Toggle
                    label="Show timestamps"
                    checked={appearance.showTimestamps}
                    onChange={(showTimestamps) => onAppearanceChange({ showTimestamps })}
                  />
                </div>
                <div className="px-4 py-2.5">
                  <Toggle
                    label="Line names up against the message"
                    hint="Puts the name on the right edge of its column, as HexChat does."
                    checked={appearance.alignNicksRight}
                    onChange={(alignNicksRight) => onAppearanceChange({ alignNicksRight })}
                  />
                </div>
                <div className="px-4 py-2.5">
                  <Stepper
                    label="Name column width"
                    value={appearance.nickColumnWidth}
                    min={6}
                    max={24}
                    onChange={(nickColumnWidth) => onAppearanceChange({ nickColumnWidth })}
                  />
                </div>
              </ListGroup>
            )}

            {!shown('notifications') ? null : (
              <ListGroup
                header="Notifications"
                footer="Marmotter notifies you when somebody says your name or messages you directly, and only while the window is not in front."
              >
                <div className="px-4 py-2.5">
                  <Toggle
                    label="Notify me when I am mentioned"
                    hint="Your operating system asks for permission the first time one would be shown."
                    checked={appearance.notificationsEnabled}
                    onChange={(notificationsEnabled) =>
                      onAppearanceChange({ notificationsEnabled })
                    }
                  />
                </div>
                <div className="px-4 py-2.5">
                  <TextField
                    label="Other words that count as a mention"
                    hint="Separated by commas. Your own name always counts."
                    value={appearance.highlightWords.join(', ')}
                    onChange={(event) =>
                      onAppearanceChange({
                        highlightWords: event.target.value
                          .split(',')
                          .map((word) => word.trim())
                          .filter((word) => word !== ''),
                      })
                    }
                    placeholder="release, deploy"
                  />
                </div>
              </ListGroup>
            )}

            {!shown('privacy') ? null : (
              <ListGroup
                header="What strangers can ask"
                footer="Other people's clients can ask yours these questions automatically. Each answer tells them something, so each is a separate choice."
              >
                <div className="px-4 py-2.5">
                  <Toggle
                    label="Say what client I use"
                    hint="Answers with Marmotter and nothing about your computer."
                    checked={ctcp.version}
                    onChange={(version) => onCtcpChange({ version })}
                  />
                </div>
                <div className="px-4 py-2.5">
                  <Toggle
                    label="Answer round-trip checks"
                    hint="Confirms you are online and how long a message takes to reach you."
                    checked={ctcp.ping}
                    onChange={(ping) => onCtcpChange({ ping })}
                  />
                </div>
                <div className="px-4 py-2.5">
                  <Toggle
                    label="Say what my clock reads"
                    hint="Sends the time as an exact instant. Combined with a timezone this narrows down where you are."
                    checked={ctcp.time}
                    onChange={(time) => onCtcpChange({ time })}
                  />
                </div>
                <div className="px-4 py-2.5">
                  <Toggle
                    label="List what my client can answer"
                    hint="Only lists the answers you have left switched on."
                    checked={ctcp.clientinfo}
                    onChange={(clientinfo) => onCtcpChange({ clientinfo })}
                  />
                </div>
                {!ctcp.version ? null : (
                  <div className="px-4 py-2.5">
                    <TextField
                      label="What to say when asked"
                      value={ctcp.versionText ?? ''}
                      placeholder={DEFAULT_VERSION_TEXT}
                      hint="Leave it empty for the default."
                      onChange={(event) => onCtcpChange({ versionText: event.target.value })}
                    />
                  </div>
                )}
              </ListGroup>
            )}

            {!shown('privacy') ? null : (
              <ListGroup
                header="Links"
                footer="Marmotter never asks another site for a preview unless you turn this on: doing so would tell that site your address."
              >
                <div className="px-4 py-2.5">
                  <Toggle
                    label="Show a preview for links"
                    hint="Off by default. A preview means asking the linked site for it, which reveals your address to it."
                    checked={appearance.unfurlLinks}
                    onChange={(unfurlLinks) => onAppearanceChange({ unfurlLinks })}
                  />
                </div>
              </ListGroup>
            )}

            {!shown('logging') || logging === undefined ? null : <LoggingSettings {...logging} />}

            {!shown('advanced') ? null : (
              <ListGroup
                header="User options"
                footer="Small conveniences for how Marmotter behaves for you."
              >
                <div className="px-4 py-2.5">
                  <Toggle
                    label="Always show the Browse channels shortcut"
                    hint="Keeps the button under every network's channel list, not only when it is empty."
                    checked={appearance.showBrowseChannelsShortcut}
                    onChange={(showBrowseChannelsShortcut) =>
                      onAppearanceChange({ showBrowseChannelsShortcut })
                    }
                  />
                </div>

                <div className="px-4 py-2.5">
                  <Toggle
                    label="Put the channel and member buttons on the screen edges"
                    hint="On a phone. They sit at the ends of the bottom bar otherwise, where your thumb already is."
                    checked={appearance.sidePanelsAtEdges}
                    onChange={(sidePanelsAtEdges) => onAppearanceChange({ sidePanelsAtEdges })}
                  />
                </div>

                <div className="px-4 py-2.5">
                  <Stepper
                    label="How long notices stay"
                    value={userOptions.toastSeconds}
                    min={TOAST_SECONDS_RANGE.min}
                    max={TOAST_SECONDS_RANGE.max}
                    format={(seconds) => `${seconds} seconds`}
                    onChange={(toastSeconds) =>
                      onUserOptionsChange({ toastSeconds: clampToastSeconds(toastSeconds) })
                    }
                  />
                  <p className="mt-1 text-footnote text-[var(--label-tertiary)]">
                    The messages that appear at the bottom of the screen. Clicking one clears it
                    sooner, and pointing at one holds it until you look away.
                  </p>
                </div>

                {!dccAvailable ? null : (
                  <>
                    <ListRow
                      title={
                        onChooseDownloadFolder === undefined
                          ? 'Files are saved to'
                          : 'Download folder'
                      }
                      subtitle={
                        userOptions.downloadFolder ??
                        (onChooseDownloadFolder === undefined
                          ? 'Working out where files can be saved'
                          : 'Not set')
                      }
                      {...(onChooseDownloadFolder === undefined
                        ? {}
                        : {
                            trailing: (
                              <Button size="small" onClick={onChooseDownloadFolder}>
                                {userOptions.downloadFolder === undefined ? 'Choose' : 'Change'}
                              </Button>
                            ),
                          })}
                    />
                    <div className="px-4 py-2.5">
                      <Toggle
                        label="Watch for files offered over DCC"
                        hint={
                          userOptions.downloadFolder === undefined
                            ? onChooseDownloadFolder === undefined
                              ? 'Marmotter has nowhere it can save files on this device yet.'
                              : 'Choose a download folder first. Downloading connects directly to whoever offered the file, so it is off until you turn it on.'
                            : onChooseDownloadFolder === undefined
                              ? 'Shows a file monitor you can open from the channel list. It starts off: tap Start on it to begin collecting what people offer. Downloading connects directly to whoever offered the file, revealing your address to them, so nothing is fetched until you tap Download. Files are saved inside the app, and uninstalling it takes them with it.'
                              : 'Shows a file monitor in the right-hand column. It starts off: click Start on it to begin collecting what people offer. Downloading connects directly to whoever offered the file, revealing your address to them, so nothing is fetched until you click Download.'
                        }
                        checked={userOptions.dccMonitorEnabled}
                        disabled={userOptions.downloadFolder === undefined}
                        onChange={(dccMonitorEnabled) => onUserOptionsChange({ dccMonitorEnabled })}
                      />
                    </div>
                    {!userOptions.dccMonitorEnabled ? null : (
                      <div className="px-4 py-2.5">
                        <TextField
                          label="Your address for incoming transfers"
                          placeholder="Worked out automatically"
                          hint="Some senders cannot be connected to and ask Marmotter to listen instead. Leave this empty unless those transfers time out — then put in the address other people reach you on, and forward the port on your router."
                          value={userOptions.dccAddress ?? ''}
                          onChange={(event) =>
                            onUserOptionsChange({
                              dccAddress:
                                event.target.value.trim() === ''
                                  ? undefined
                                  : event.target.value.trim(),
                            })
                          }
                        />
                      </div>
                    )}
                  </>
                )}
              </ListGroup>
            )}

            {!shown('advanced') ? null : (
              <ListGroup
                header="Move your settings"
                footer="Marmotter runs on a desktop, a phone and in a browser, and this is how one of them catches up with another. Passwords and channel keys stay on the device that holds them — every network remembers how it signs in, so you type the password once on the other side."
              >
                <ListRow
                  title="Export your settings"
                  subtitle="Your networks, your name and everything on this screen, as text to copy or save."
                  trailing={
                    <Button size="small" onClick={onExportConfig}>
                      Export
                    </Button>
                  }
                />
                <ListRow
                  title="Import settings"
                  subtitle="Paste settings exported from another Marmotter. You see what is in them before anything changes."
                  trailing={
                    <Button size="small" onClick={onImportConfig}>
                      Import
                    </Button>
                  }
                />
              </ListGroup>
            )}

            {!shown('advanced') ? null : (
              <ListGroup
                header="Start over"
                footer="Your networks, your name and anything already saved to this device are left alone."
              >
                <ListRow
                  title="Reset settings to their defaults"
                  subtitle={
                    confirmingReset
                      ? 'Every choice on this screen goes back to how it shipped. This cannot be undone.'
                      : 'Puts everything on this screen back the way it was when you installed Marmotter.'
                  }
                  trailing={
                    confirmingReset ? (
                      <div className="flex items-center gap-1.5">
                        <Button size="small" onClick={() => setConfirmingReset(false)}>
                          Keep them
                        </Button>
                        <Button
                          size="small"
                          variant="destructive"
                          onClick={() => {
                            setConfirmingReset(false);
                            onResetSettings();
                          }}
                        >
                          Reset
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="small"
                        variant="destructive"
                        onClick={() => setConfirmingReset(true)}
                      >
                        Reset
                      </Button>
                    )
                  }
                />
              </ListGroup>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Which group of settings the rail is showing. */
type SectionId = 'networks' | 'appearance' | 'notifications' | 'privacy' | 'logging' | 'advanced';

/**
 * The rail, in the order somebody reaches for these.
 *
 * Networks first because it is the only section holding the user's own data
 * rather than a preference, and the only one with anything urgent in it — a
 * connection that failed is retried from here.
 *
 * `logging` stays in the list on a platform that cannot log: the section simply
 * renders nothing, which is a rail entry leading to an empty panel. That is
 * handled by the caller omitting `logging`, and the entry is filtered out with
 * it below.
 */
const SECTIONS: readonly { readonly id: SectionId; readonly label: string }[] = [
  { id: 'networks', label: 'Networks' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'logging', label: 'Logging' },
  { id: 'advanced', label: 'Advanced' },
];

/**
 * Settings' own type scale and geometry.
 *
 * Two things at once, both scoped to this screen rather than global.
 *
 * The text is one iOS-style step below the rest of the interface: these
 * controls sit still and are read rather than glanced at. Applied through the
 * tokens that back Tailwind's `text-*` utilities, so every primitive follows
 * without touching each one.
 *
 * The corners are tighter for the same reason NS3H's are — a dense
 * configuration screen full of small controls reads as software rather than as
 * a phone app, and a 14px radius on a 28px-tall row is most of the row. Set as
 * the same tokens the rest of the app uses, so nothing here hardcodes a shape
 * any more than it hardcodes a colour.
 */
const SETTINGS_CHROME = {
  '--text-body-size': '15px',
  '--text-body-line': '20px',
  '--text-callout-size': '15px',
  '--text-callout-line': '20px',
  '--text-subhead-size': '14px',
  '--text-subhead-line': '19px',

  '--corner-control': '6px',
  '--corner-card': '8px',
} as CSSProperties;
