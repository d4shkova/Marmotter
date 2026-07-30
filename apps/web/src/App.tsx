import type { JSX } from 'react';

/**
 * Phase 0 shell. Phase 5 of BUILD_PLAN.md replaces this with the three-column
 * layout, sidebar, message list, composer, and member list.
 */
export function App(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-bg-base p-4 text-label-primary">
      <h1 className="text-title-1 font-bold">Marmotter</h1>
      <p className="text-subhead text-label-secondary">
        The scaffold is in place. No networks are configured yet.
      </p>
    </main>
  );
}
