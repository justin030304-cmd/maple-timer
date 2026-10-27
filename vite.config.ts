import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Keep built assets relative so both / and GitHub Pages /maple-timer/ work.
  base: './',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
});
