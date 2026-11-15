import { posix } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import ui from '@nuxt/ui/vite';

export default defineConfig({
  base: './',
  experimental: {
    renderBuiltUrl(filename, { hostId, hostType, type }) {
      if (
        hostType !== 'js' ||
        type !== 'asset' ||
        !filename.startsWith('assets/browser-worker-') ||
        !filename.endsWith('.js')
      ) {
        return { relative: true };
      }
      const relativePath = posix.relative(posix.dirname(hostId), filename);
      const url = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
      return { runtime: `new URL(${JSON.stringify(url)}, import.meta.url).href` };
    },
  },
  plugins: [vue(), ui({ ui: { colors: { primary: 'teal', neutral: 'slate' } } })],
  build: {
    lib: {
      entry: {
        browser: 'src/composition/browser.ts',
        server: 'src/composition/server.ts',
        vue: 'src/vue/public.ts',
        'server-worker': 'src/compilation/node-worker.ts',
      },
      formats: ['es'],
      cssFileName: 'visual-editor',
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: (id) =>
        id === 'vue' || id === 'vue-router' || id === 'mjml' || id.startsWith('node:'),
    },
    target: 'es2022',
    sourcemap: true,
  },
});
