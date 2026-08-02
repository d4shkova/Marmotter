import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config for Storybook only.
 *
 * The package itself is built with `tsc`, not Vite — it ships type
 * declarations and untranspiled modules for the apps to bundle. This exists so
 * Storybook can resolve JSX and process the Tailwind stylesheet.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
});
