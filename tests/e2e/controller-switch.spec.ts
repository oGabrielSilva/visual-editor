import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const distributionRoot = resolve(packageRoot, 'dist');
const fixturePrefix = '/__controller-switch/';
const fixtureHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="${fixturePrefix}dist/visual-editor.css">
  <script type="importmap">${JSON.stringify({
    imports: { vue: `${fixturePrefix}vue.js`, 'vue-router': `${fixturePrefix}router.js` },
  })}</script>
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { createApp, h, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue';
    import { createMemoryHistory, createRouter } from 'vue-router';
    import { createEditor } from '${fixturePrefix}dist/browser.js';
    import { VisualEditor } from '${fixturePrefix}dist/vue.js';

    const first = createEditor({ source: { html: '<main><p>Mesmo texto</p></main>', css: '' } });
    const second = createEditor({ document: first.session.snapshot() });
    const target = first.controller.canvasRegions().find(region => region.kind === 'text')?.id;
    if (!target || !first.controller.select(target) || !second.controller.select(target))
      throw new Error('SWITCH_FIXTURE_SELECTION_FAILED');
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { render: () => h('div') } }],
    });
    const app = createApp({
      setup() {
        const current = shallowRef(first);
        const editor = ref();
        const owner = ref('Primeira sessão');
        const insertion = ref('Não solicitada');
        const report = ref('');
        const inspect = () => {
          const firstState = first.controller.state();
          const secondState = second.controller.state();
          report.value = JSON.stringify({
            sameDocument: firstState.document.id === secondState.document.id,
            sameRevision: firstState.document.revision === secondState.document.revision,
            sameSource: firstState.source.html === secondState.source.html,
            firstHtml: first.controller.richTextFor(target),
            secondHtml: second.controller.richTextFor(target),
            secondPending: !!secondState.pendingRichText,
          });
        };
        inspect();
        onBeforeUnmount(() => { first.dispose(); second.dispose(); });
        return () => h('div', [
          h('div', { role: 'group', 'aria-label': 'Controle do teste' }, [
            h('button', {
              type: 'button',
              onMousedown: event => event.preventDefault(),
              onClick: async () => {
                current.value = second;
                owner.value = 'Segunda sessão';
                await nextTick();
                inspect();
              },
            }, 'Trocar sessão'),
            h('button', {
              type: 'button',
              onMousedown: event => event.preventDefault(),
              onClick: () => {
                insertion.value = String(editor.value.insertVariable('contact.name'));
                inspect();
              },
            }, 'Inserir no contexto ativo'),
            h('output', { 'data-testid': 'owner' }, owner.value),
            h('output', { 'data-testid': 'insertion' }, insertion.value),
            h('output', { 'data-testid': 'report' }, report.value),
          ]),
          h(VisualEditor, {
            ref: editor,
            controller: current.value.controller,
            selectionRenderer: current.value.selectionRenderer,
            variables: [{ key: 'contact.name', label: 'Nome de exemplo', purpose: 'text' }],
          }),
        ]);
      },
    });
    await router.push('/');
    app.use(router).mount('#app');
    window.addEventListener('pagehide', () => app.unmount(), { once: true });
  </script>
</body>
</html>`;

test('isolates the inspector caret and local history when controllers share the same snapshot', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith(fixturePrefix)) return route.abort();
    const asset = pathname.slice(fixturePrefix.length);
    if (!asset) return route.fulfill({ contentType: 'text/html', body: fixtureHtml });
    const vendor =
      asset === 'vue.js'
        ? resolve(packageRoot, 'node_modules/vue/dist/vue.runtime.esm-browser.prod.js')
        : asset === 'router.js'
          ? resolve(packageRoot, 'node_modules/vue-router/dist/vue-router.esm-browser.prod.js')
          : undefined;
    const file = vendor ?? resolve(distributionRoot, asset.slice('dist/'.length));
    const local = relative(distributionRoot, file);
    if (!vendor && (!asset.startsWith('dist/') || local.startsWith('..') || isAbsolute(local)))
      return route.abort();
    try {
      const body = await readFile(file);
      return route.fulfill({
        contentType: extname(file) === '.css' ? 'text/css' : 'text/javascript',
        body,
      });
    } catch {
      return route.fulfill({ status: 404, body: 'Missing local test asset' });
    }
  });
  try {
    await page.goto(fixturePrefix);
    await expect(page.getByTestId('owner')).toHaveText('Primeira sessão');
    const text = page
      .locator('.editor-properties')
      .getByRole('textbox', { name: 'Texto', exact: true });
    await text.click();
    await text.press('End');
    await page.keyboard.insertText(' extra');
    await expect(text).toHaveText('Mesmo texto extra');
    await text.press('ControlOrMeta+Z');
    await expect(text).toHaveText('Mesmo texto');
    const redo = page.getByRole('button', { name: 'Refazer', exact: true });
    await expect(redo).toBeEnabled();

    await page.getByRole('button', { name: 'Trocar sessão', exact: true }).click();
    await expect(page.getByTestId('owner')).toHaveText('Segunda sessão');
    await expect(text).toHaveText('Mesmo texto');
    await expect(redo).toBeDisabled();
    await page.getByRole('button', { name: 'Inserir no contexto ativo', exact: true }).click();
    await expect(page.getByTestId('insertion')).toHaveText('false');
    const unchanged = JSON.parse(await page.getByTestId('report').innerText()) as {
      sameDocument: boolean;
      sameRevision: boolean;
      sameSource: boolean;
      secondPending: boolean;
    };
    expect(unchanged).toMatchObject({
      sameDocument: true,
      sameRevision: true,
      sameSource: true,
      secondPending: false,
    });

    await text.click();
    await expect(redo).toBeDisabled();
    await text.press('End');
    await page.keyboard.insertText(' nova');
    await expect(text).toHaveText('Mesmo texto nova');
    await text.press('ControlOrMeta+Z');
    await expect(text).toHaveText('Mesmo texto');
    await page.getByRole('button', { name: 'Inserir no contexto ativo', exact: true }).click();
    await expect(page.getByTestId('insertion')).toHaveText('true');
    await expect(text).toContainText('{{contact.name}}');
    const inserted = JSON.parse(await page.getByTestId('report').innerText()) as {
      firstHtml: string;
      secondHtml: string;
    };
    expect(inserted.firstHtml).not.toContain('{{contact.name}}');
    expect(inserted.secondHtml).toContain('{{contact.name}}');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});
