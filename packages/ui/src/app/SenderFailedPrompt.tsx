import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../primitives/Button.js';
import { Sheet } from '../primitives/Sheet.js';
import { isTransferInFlight, useView } from './view-store.js';

/** The failure being asked about. */
export interface FailedSender {
  readonly networkId: string;
  readonly networkName: string;
  /** The sender's nick, which is what its rows are grouped by. */
  readonly nick: string;
  /** The file that could not be fetched, named in the title. */
  readonly filename: string;
  /** Why, in the row's own words. */
  readonly error: string | undefined;
}

export interface SenderFailedPromptProps {
  readonly sender: FailedSender | undefined;
  /** Leaves the list as it is. */
  readonly onKeep: () => void;
  /** Removes this sender's rows and nothing else. */
  readonly onRemove: () => void;
  /** Removes this sender's rows and ignores its offers from now on. */
  readonly onBlock: () => void;
}

/**
 * The question after a file could not be fetched.
 *
 * A sender that fails one transfer usually fails the rest — a misconfigured bot
 * hands everybody the same unreachable address — so the useful thing to offer
 * is to clear what it is offering, and, for a sender that keeps doing it, to
 * stop listing it altogether. Nobody else's rows are touched by either.
 *
 * It counts the sender's rows itself rather than being told, so the shell does
 * not have to subscribe to the whole list of offers to ask one question about
 * it.
 */
export function SenderFailedPrompt({
  sender,
  onKeep,
  onRemove,
  onBlock,
}: SenderFailedPromptProps): ReactNode {
  const { removable, running } = useView(
    useShallow((state) => {
      let removable = 0;
      let running = 0;
      if (sender !== undefined) {
        for (const entry of state.dccOffers) {
          if (entry.networkId === sender.networkId && entry.from === sender.nick) {
            if (isTransferInFlight(entry.status)) {
              running += 1;
            } else {
              removable += 1;
            }
          }
        }
      }
      return { removable, running };
    }),
  );

  if (sender === undefined) {
    return null;
  }
  const { nick, networkName } = sender;

  return (
    <Sheet
      open
      onClose={onKeep}
      title={`Couldn't get ${sender.filename}`}
      footer={
        <>
          <Button onClick={onKeep}>Keep them</Button>
          <Button onClick={onRemove}>Remove {nick}&rsquo;s files</Button>
          <Button variant="destructive" onClick={onBlock}>
            Remove and block
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pt-2 text-subhead text-[var(--label-secondary)]">
        <p>
          The file could not be retrieved from {nick} on {networkName}.
          {sender.error === undefined ? null : <> {sender.error}</>}
        </p>
        <p>
          {removable === 1
            ? `Remove the 1 file in the file monitor from ${nick}?`
            : `Remove all ${removable.toLocaleString()} files in the file monitor from ${nick}?`}{' '}
          Files from everyone else stay where they are
          {running === 0
            ? '.'
            : `, and so ${running === 1 ? 'does the download' : 'do the downloads'} from ${nick} still running.`}
        </p>
        <p>
          Blocking {nick} also stops anything it offers from being listed again. You can unblock it
          in Settings, under Advanced.
        </p>
      </div>
    </Sheet>
  );
}
