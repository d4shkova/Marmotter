import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'android',
    // No DOM and no workspace imports: what is checked here are the Android
    // project's own resource files, which are read off disk as text.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
