import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    sourcemap: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
