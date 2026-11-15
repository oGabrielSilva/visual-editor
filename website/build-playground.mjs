// Builds the playground of the repository into the site, under /visual-editor/playground/.
// The repository must be installed (`yarn install` at its root). Run from `website/`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = fileURLToPath(new URL('./public/playground/', import.meta.url));
execFileSync(
  process.execPath,
  [`${root}node_modules/vite/bin/vite.js`, 'build', '--config', 'vite.playground.config.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PLAYGROUND_BASE: '/visual-editor/playground/', PLAYGROUND_OUT_DIR: outDir },
  },
);
