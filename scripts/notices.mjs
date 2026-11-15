import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const pending = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).map(
  (name) => ({ name, from: root }),
);
const packages = new Map();
const missing = new Set();
async function location(name, from) {
  let current = from;
  while (true) {
    const path = join(current, 'node_modules', name, 'package.json');
    try {
      await access(path);
      return path;
    } catch {
      /* Resolve in the next parent directory. */
    }
    if (current === root || dirname(current) === current) return undefined;
    current = dirname(current);
  }
}
while (pending.length) {
  const request = pending.pop();
  const path = await location(request.name, request.from);
  if (!path) {
    missing.add(request.name);
    continue;
  }
  const data = JSON.parse(await readFile(path, 'utf8'));
  const key = `${data.name}@${data.version}`;
  if (packages.has(key)) continue;
  const directory = dirname(path);
  const files = (await readdir(directory)).filter((file) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(file),
  );
  const notices = [];
  for (const file of files) {
    try {
      notices.push({ file, text: await readFile(join(directory, file), 'utf8') });
    } catch {
      /* Some license entries are directories; manifest remains in the inventory. */
    }
  }
  let license = data.license ?? 'UNDECLARED';
  let licenseSource;
  if (key === 'vaul-vue@0.4.1' && license === 'UNDECLARED') {
    license = 'MIT';
    licenseSource =
      'https://github.com/unovue/vaul-vue/blob/1b1f6dfdba6a775410508884097443d35c9a8690/LICENSE';
    notices.push({
      file: 'LICENSE from the exact release tag (omitted upstream tarball)',
      text: await readFile(join(root, 'docs', 'licenses', 'vaul-vue-0.4.1.txt'), 'utf8'),
    });
  }
  packages.set(key, {
    name: data.name,
    version: data.version,
    license,
    ...(licenseSource ? { licenseSource } : {}),
    notices,
  });
  for (const name of Object.keys({
    ...data.dependencies,
    ...data.optionalDependencies,
    ...data.peerDependencies,
  }))
    pending.push({ name, from: directory });
}
const inventory = [...packages.values()].sort(
  (left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
);
const intro =
  '# Dependências de terceiros\n\nInventário das dependências instaladas de produção e peers, incluindo opcionais\nresolvidos localmente. Nem todas entram no bundle; incluir uma licença aqui não\natribui ao editor as funcionalidades dos pacotes de terceiros. Sem SDK pago.\n\n';
const markdown = inventory
  .map(
    (item) =>
      `## ${item.name}@${item.version}\n\nLicença: ${JSON.stringify(item.license)}\n\n${item.licenseSource ? `Fonte: ${item.licenseSource}\n\n` : ''}${item.notices.map((notice) => `${notice.file}:\n\n\`\`\`text\n${notice.text}\n\`\`\`\n`).join('\n')}`,
  )
  .join('\n');
const normalizedMarkdown = (intro + markdown)
  .split('\n')
  .map((line) => line.trimEnd())
  .join('\n');
await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), normalizedMarkdown, 'utf8');
await writeFile(
  join(root, 'docs', 'dependency-inventory.json'),
  JSON.stringify(
    {
      package: manifest.name,
      version: manifest.version,
      dependencies: inventory.map(({ notices: _notices, ...item }) => item),
      optionalUninstalled: [...missing].sort(),
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
process.stdout.write(
  `${inventory.length} pacotes inventariados; ${inventory.filter((item) => item.license === 'UNDECLARED').length} sem licença declarada.\n`,
);
