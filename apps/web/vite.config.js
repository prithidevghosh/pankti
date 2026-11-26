import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: { proxy: { '/api': 'http://127.0.0.1:4100' } },
});
