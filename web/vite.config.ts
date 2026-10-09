import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' }, fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
