// After `nuxt generate`: copies the Markdown documentation into the site (served as text for
// code assistants) and joins it into `llms-full.txt`. Run from `website/`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const site = new URL('.output/public/', import.meta.url);
const DOCS = [
  ['README.md', 'docs/README.md'],
  ['docs/architecture.md', 'docs/architecture.md'],
  ['docs/security.md', 'docs/security.md'],
  ['CONTRIBUTING.md', 'docs/CONTRIBUTING.md'],
  ['CHANGELOG.md', 'docs/CHANGELOG.md'],
  // A different name: on case-insensitive file systems it would collide with security.md.
  ['SECURITY.md', 'docs/security-policy.md'],
];

await mkdir(new URL('docs/', site), { recursive: true });
// GitHub Pages serves the files as they are, without Jekyll.
await writeFile(new URL('.nojekyll', site), '');
const parts = [];
for (const [from, to] of DOCS) {
  const text = await readFile(new URL(from, root), 'utf8');
  await writeFile(new URL(to, site), text);
  parts.push(`<!-- ${to} -->\n\n${text.trim()}\n`);
}
const index = await readFile(new URL('public/llms.txt', import.meta.url), 'utf8');
await writeFile(new URL('llms-full.txt', site), `${index.trim()}\n\n${parts.join('\n')}`);
console.log('documentation and llms-full.txt written');
