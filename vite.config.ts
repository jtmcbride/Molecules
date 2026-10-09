import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  server: { host: '0.0.0.0' },
  build: { chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
