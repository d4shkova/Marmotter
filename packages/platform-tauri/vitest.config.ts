import { defineConfig } from 'vitest/config';
import { workspaceAlias } from '../../workspace.alias';

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    name: 'platform-tauri',
    // No DOM: what is tested here is the log stores and the preference parser,
    // which are file operations and string work. The shell itself is
    // `packages/ui`, tested there.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
