import type { Preview } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import '../src/styles.css';

const preview: Preview = {
  parameters: {
    // The interface is dark. A white canvas would show every component against
    // a background it never appears on.
    backgrounds: { disable: true },
    layout: 'centered',
    // Every story is checked, and a violation fails the run rather than being
    // noted in a panel nobody opens.
    a11y: { test: 'error' },
  },

  decorators: [
    (Story): ReactElement => (
      <div className="bg-[var(--bg-base)] p-6 text-[var(--label-primary)]">
        <Story />
      </div>
    ),
  ],
};

export default preview;
