import { Marmotter } from '@marmotter/ui';
import { open as openDialog, save } from '@tauri-apps/plugin-dialog';
import { type JSX, useMemo } from 'react';
import { createDesktopDcc } from './dcc';
import { createDesktopLogStore } from './logging';
import { createDesktopNotifier } from './notifier';
import { openExternalUrl } from './opener';
import { createDesktopTransport } from './transport';

/**
 * The desktop app.
 *
 * The shell itself lives in `@marmotter/ui` and is shared with the web build;
 * what differs here is the platform's own capabilities — a real socket through
 * Rust, notifications, the DCC file monitor, and somewhere to keep logs.
 */
export function App(): JSX.Element {
  const notifier = useMemo(() => createDesktopNotifier(), []);
  const dcc = useMemo(() => createDesktopDcc(), []);

  return (
    <Marmotter
      createTransport={() => createDesktopTransport()}
      notifier={notifier}
      dcc={dcc}
      openExternal={openExternalUrl}
      // The store the shell writes conversations to, in whichever format the
      // user has chosen. Web passes nothing here and must keep passing nothing:
      // that absence is what guarantees a browser tab cannot persist message
      // content. See CLAUDE.md.
      createLogStore={createDesktopLogStore}
      chooseLogFolder={async () => {
        const chosen = await openDialog({
          directory: true,
          multiple: false,
          title: 'Choose where logs are kept',
        });
        return typeof chosen === 'string' ? chosen : undefined;
      }}
      chooseExportFile={async () => {
        const chosen = await save({
          title: 'Export your logs',
          defaultPath: 'marmotter-logs.txt',
          filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
        });
        return chosen ?? undefined;
      }}
      persists
    />
  );
}
