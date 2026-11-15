import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import ui from '@nuxt/ui/vite';
import { fileURLToPath } from 'node:url';

// The project site publishes the playground under its own path: PLAYGROUND_BASE sets the base
// URL of the build and PLAYGROUND_OUT_DIR where it goes.
const base = process.env.PLAYGROUND_BASE ?? '/';
const outDir = process.env.PLAYGROUND_OUT_DIR ?? '../playground-dist';

export default defineConfig({
  base,
  root: fileURLToPath(new URL('./playground', import.meta.url)),
  // Color aliases of the playground theme.
  plugins: [vue(), ui({ ui: { colors: { primary: 'teal', neutral: 'neutral' } } })],
  server: { host: '127.0.0.1', port: 6010, strictPort: true },
  build: { outDir, emptyOutDir: true, target: 'es2022' },
});
