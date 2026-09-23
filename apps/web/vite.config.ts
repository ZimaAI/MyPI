import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve('apps/web'),
  plugins: [react()],
  build: { outDir: resolve('dist/web'), emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        headers: { origin: 'http://localhost:3000' },
      },
      '/health': { target: 'http://localhost:3000' },
    },
  },
});
