import { Marmotter } from '@marmotter/ui';
import { type JSX, useMemo } from 'react';
import { createDesktopDcc } from './dcc';
import { createDesktopNotifier } from './notifier';
import { createDesktopTransport } from './transport';

/**
 * The desktop app.
 *
 * The shell itself lives in `@marmotter/ui` and is shared with the web build;
 * the only thing that differs here is the transport, which goes through Rust to
 * a real socket.
 */
export function App(): JSX.Element {
  // Desktop keeps profiles and, when the user opts in, logs. Phase 7 adds the
  // storage behind both; the flag is what tells the shell not to promise the
  // web build's "nothing is kept" guarantee here.
  const notifier = useMemo(() => createDesktopNotifier(), []);
  const dcc = useMemo(() => createDesktopDcc(), []);

  return (
    <Marmotter
      createTransport={() => createDesktopTransport()}
      notifier={notifier}
      dcc={dcc}
      persists
    />
  );
}
