import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { ShellDriver } from './shell';
import { E2E_ORIGIN } from './origin';

const preview = (page: Page) => page.frameLocator('iframe.editor-preview');
const mode = (page: Page, name: 'HTML' | 'Visual') =>
  page.locator('.editor-mode-switch').getByRole('button', { name, exact: true });
const panel = (page: Page, name: 'Blocos' | 'Modelos' | 'Estrutura') =>
  new ShellDriver(page).leftTab(name);
const treeItem = (page: Page, text: string) => new ShellDriver(page).treeItem(text);
const fillCode = async (page: Page, name: string, source: string): Promise<void> => {
  const textbox = page.getByRole('textbox', { name, exact: true });
  await textbox.click();
  await textbox.press('ControlOrMeta+A');
  await page.keyboard.insertText(source);
};
const importHtml = async (page: Page, html: string): Promise<void> => {
  await page.locator('.editor-file-input').setInputFiles({
    name: 'document.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html, 'utf8'),
  });
  await expect(page.locator('.editor-feedback')).toContainText('Conteúdo importado');
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto('/');
  await expect(
    preview(page).getByRole('heading', { name: 'Uma ideia para o seu próximo passo' }),
  ).toBeVisible();
});

test('imports HTML, edits visually, alternates twenty times and reopens the saved document', async ({
  page,
}) => {
  await importHtml(
    page,
    '<!doctype html><html><head><style>.native{border:2px solid teal}@media(max-width:600px){.native{padding:12px}}</style></head><body><h1>Captura de São Luís</h1><p>Olá, Nico Robin.</p><article class="native" data-custom="preserved"><h2>Estrutura importada</h2><p>{{contact.name}}</p></article></body></html>',
  );
  await panel(page, 'Estrutura').click();
  await treeItem(page, 'Captura de São Luís').click();
  // The tree stays where it is while the properties of the selected block open beside it.
  await expect(treeItem(page, 'Captura de São Luís')).toBeVisible();
  const richText = page.locator('.editor-richtext .tiptap');
  await richText.fill('Captura visual revisada');
  await richText.press('ControlOrMeta+Enter');
  await expect(
    preview(page).getByRole('heading', { name: 'Captura visual revisada' }),
  ).toBeVisible();
  for (let iteration = 0; iteration < 20; iteration++) {
    await mode(page, 'HTML').click();
    await mode(page, 'Visual').click();
  }
  await mode(page, 'HTML').click();
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toContainText(
    'data-custom="preserved"',
  );
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toContainText(
    '{{contact.name}}',
  );
  await mode(page, 'Visual').click();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('.editor-feedback')).toContainText('Documento salvo');
  await page.getByRole('button', { name: 'Reabrir documento salvo' }).click();
  await expect(
    preview(page).getByRole('heading', { name: 'Captura visual revisada' }),
  ).toBeVisible();
});

test('HTML and CSS edit the same document, undo/redo and invalid buffer recovery work', async ({
  page,
}) => {
  await mode(page, 'HTML').click();
  await fillCode(page, 'HTML', '<main><h1>Mensagem em HTML</h1><p>Uma conversa.</p></main>');
  await fillCode(
    page,
    'Estilos',
    'h1{color:rgb(13,118,110)}@media(max-width:600px){main{padding:12px}}',
  );
  await page.getByRole('button', { name: 'Aplicar agora', exact: true }).click();
  await expect(preview(page).getByRole('heading', { name: 'Mensagem em HTML' })).toBeVisible();
  await mode(page, 'Visual').click();
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(
    preview(page).getByRole('heading', { name: 'Uma ideia para o seu próximo passo' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  await expect(preview(page).getByRole('heading', { name: 'Mensagem em HTML' })).toBeVisible();
  await mode(page, 'HTML').click();
  await fillCode(
    page,
    'HTML',
    // Scripts are preserved by the tolerant import; nesting beyond the limit is still refused.
    `<main><h1>Keep draft</h1>${'<div>'.repeat(300)}</main>`,
  );
  await mode(page, 'Visual').click();
  await expect(mode(page, 'HTML')).toHaveAttribute('data-editor-active', 'true');
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toContainText(
    'Keep draft',
  );
  await expect(preview(page).getByRole('heading', { name: 'Mensagem em HTML' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Editor de e-mail e landing pages' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Descartar alterações pendentes' }).click();
  await mode(page, 'Visual').click();
  await expect(mode(page, 'Visual')).toHaveAttribute('data-editor-active', 'true');
});

test('email templates compile through MJML and preserve imported native regions', async ({
  page,
}) => {
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'E-mail', exact: true })
    .click();
  await panel(page, 'Modelos').click();
  await page.getByRole('button', { name: /^Boas-vindas Receba novos contatos/ }).click();
  await page
    .getByRole('dialog', { name: 'Aplicar este modelo?' })
    .getByRole('button', { name: 'Aplicar alterações', exact: true })
    .click();
  await expect(
    preview(page).getByText('Uma nova conversa começa aqui', { exact: true }),
  ).toBeVisible();
  await panel(page, 'Blocos').click();
  await new ShellDriver(page).paletteBlock('Texto').click();
  await expect(
    preview(page).getByText('Escreva uma mensagem para sua próxima conversa.', { exact: true }),
  ).toBeVisible();
  await expect(preview(page).locator('table[role="presentation"]').first()).toBeVisible();
  await importHtml(
    page,
    '<!doctype html><html><head><style>td{padding:20px}</style></head><body><!--[if mso]><table><tr><td>Outlook preservation</td></tr></table><![endif]--><table role="presentation"><tr><td><p>Mensagem importada</p></td></tr></table></body></html>',
  );
  await panel(page, 'Blocos').click();
  await new ShellDriver(page).paletteBlock('Texto').click();
  await mode(page, 'HTML').click();
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toContainText(
    'Outlook preservation',
  );
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toContainText(
    'Mensagem importada',
  );
});

test('keyboard moves and duplicate/remove keep undo recoverable', async ({ page }) => {
  await importHtml(
    page,
    '<main><h1>Primeiro título</h1><p>Segundo bloco</p><p>Terceiro bloco</p></main>',
  );
  const shell = new ShellDriver(page);
  await panel(page, 'Estrutura').click();
  const second = treeItem(page, 'Segundo bloco');
  await second.click();
  await second.press('Alt+ArrowDown');
  await expect(preview(page).locator('main > p')).toHaveText(['Terceiro bloco', 'Segundo bloco']);
  await shell.blockAction('Duplicar').click();
  await expect(preview(page).getByText('Segundo bloco', { exact: true })).toHaveCount(2);
  await shell.blockAction('Remover').click();
  await page
    .getByRole('dialog', { name: 'Remover este bloco?' })
    .getByRole('button', { name: 'Remover', exact: true })
    .click();
  await expect(preview(page).getByText('Segundo bloco', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(preview(page).getByText('Segundo bloco', { exact: true })).toHaveCount(2);
});

test('readonly and preview sandbox prevent edits and document scripts', async ({ page }) => {
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'Somente leitura', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toBeDisabled();
  await expect(new ShellDriver(page).paletteBlock('Texto')).toBeDisabled();
  await mode(page, 'HTML').click();
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toHaveAttribute(
    'contenteditable',
    'false',
  );
  const iframe = page.locator('iframe.editor-preview');
  await expect(iframe).toHaveAttribute('sandbox', '');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(await iframe.getAttribute('srcdoc')).toContain("default-src 'none'");
  expect(await iframe.getAttribute('srcdoc')).not.toContain('<script');
});

test('exports a portable styled HTML file and a JSON document', async ({ page }) => {
  const htmlDownload = page.waitForEvent('download');
  await new ShellDriver(page).file('Exportar HTML');
  expect((await htmlDownload).suggestedFilename()).toBe('content.html');
  const jsonDownload = page.waitForEvent('download');
  await new ShellDriver(page).file('Exportar documento');
  expect((await jsonDownload).suggestedFilename()).toBe('document.json');
});

test('selects content in the canvas and edits lists and paragraphs without losing either mode', async ({
  page,
}) => {
  await importHtml(page, '<main><div data-editor-block="text">Uma mensagem inicial.</div></main>');
  await preview(page).getByText('Uma mensagem inicial.', { exact: true }).click();
  await expect(page.locator('.editor-properties')).toBeVisible();
  await panel(page, 'Estrutura').click();
  await treeItem(page, 'Uma mensagem inicial.').click();
  const text = page.locator('.editor-richtext .tiptap');
  await text.click();
  await text.press('ControlOrMeta+A');
  await page.keyboard.insertText('Primeiro item');
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await text.press('End');
  await text.press('Enter');
  await page.keyboard.insertText('Segundo item');
  await text.press('ControlOrMeta+Enter');
  await expect(preview(page).getByRole('listitem')).toHaveCount(2);
  await mode(page, 'HTML').click();
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toContainText('<ul>');
  await mode(page, 'Visual').click();
  await expect(preview(page).getByText('Segundo item', { exact: true })).toBeVisible();
});

test('drags blocks in the outline and preserves the imported body', async ({ page }) => {
  await importHtml(
    page,
    '<main><h1>Primeiro título</h1><p>Segundo bloco</p><p>Terceiro bloco</p></main>',
  );
  await panel(page, 'Estrutura').click();
  // The upper part of a row means "before it".
  await treeItem(page, 'Terceiro bloco').dragTo(treeItem(page, 'Segundo bloco'), {
    targetPosition: { x: 40, y: 4 },
  });
  await expect(preview(page).locator('main > p')).toHaveText(['Terceiro bloco', 'Segundo bloco']);
  await expect(preview(page).locator('main')).toContainText(
    'Primeiro títuloTerceiro blocoSegundo bloco',
  );
});

test('loads standalone UI and the MJML worker with classified browser diagnostics and no missing modules', async ({
  page,
  browserName,
  browser,
}) => {
  const pageErrors: string[] = [];
  const consoleRecords: {
    type: string;
    text: string;
    location: { url: string; lineNumber: number; columnNumber: number };
  }[] = [];
  const missing: string[] = [];
  const inventory: {
    frameId: number;
    title: string;
    modal: boolean;
    sandbox: string | null;
    tabindex: string | null;
    hidden: boolean;
    srcdoc: string;
    sha256: string;
    csp: string[];
  }[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    consoleRecords.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
    });
  });
  page.on('response', (response) => {
    if (response.url().startsWith(E2E_ORIGIN) && response.status() >= 400)
      missing.push(response.status() + ' ' + response.url());
  });
  const capturePreviews = async (): Promise<typeof inventory> => {
    const frames = await page.locator('.editor-template-thumbnail iframe').evaluateAll((nodes) => {
      const owner = window as Window & {
        qualityPreviewIds?: WeakMap<Element, number>;
        qualityPreviewNext?: number;
      };
      owner.qualityPreviewIds ??= new WeakMap();
      owner.qualityPreviewNext ??= 0;
      return nodes.map((node) => {
        if (!owner.qualityPreviewIds?.has(node)) {
          owner.qualityPreviewNext = (owner.qualityPreviewNext ?? 0) + 1;
          owner.qualityPreviewIds?.set(node, owner.qualityPreviewNext);
        }
        return {
          frameId: owner.qualityPreviewIds?.get(node) ?? 0,
          title: node.getAttribute('title') ?? '',
          modal: !!node.closest('[role="dialog"]'),
          sandbox: node.getAttribute('sandbox'),
          tabindex: node.getAttribute('tabindex'),
          hidden: !!node.closest('[aria-hidden="true"]'),
          srcdoc: node.getAttribute('srcdoc') ?? '',
        };
      });
    });
    return frames.map((frame) => {
      const entry: (typeof inventory)[number] = {
        ...frame,
        sha256: createHash('sha256').update(frame.srcdoc).digest('hex'),
        csp: [],
      };
      const existing = inventory.find((candidate) => candidate.frameId === frame.frameId);
      if (!existing || existing.srcdoc !== frame.srcdoc) inventory.push(entry);
      if (existing) expect(entry.sha256).toBe(existing.sha256);
      expect(frame.frameId).toBeGreaterThan(0);
      expect(frame.sandbox).toBe('');
      expect(frame.tabindex).toBe('-1');
      expect(frame.hidden).toBe(true);
      expect(frame.srcdoc.length).toBeGreaterThan(0);
      const tree = parse(frame.srcdoc, { scriptingEnabled: false });
      const csp: string[] = [];
      const stack: DefaultTreeAdapterMap['childNode'][] = [...tree.childNodes];
      while (stack.length) {
        const node = stack.pop();
        if (!node || !('tagName' in node)) continue;
        expect(['script', 'iframe', 'object', 'embed']).not.toContain(node.tagName);
        const attrs = Object.fromEntries(
          node.attrs.map((attribute) => [attribute.name, attribute.value]),
        );
        for (const attribute of node.attrs) {
          expect(attribute.name.toLowerCase().startsWith('on')).toBe(false);
          try {
            expect(new URL(attribute.value, 'https://fixture.invalid/').protocol).not.toBe(
              'javascript:',
            );
          } catch (error: unknown) {
            if (!(error instanceof TypeError)) throw error;
          }
        }
        if (
          node.tagName === 'meta' &&
          attrs['http-equiv']?.toLowerCase() === 'content-security-policy'
        )
          csp.push(attrs.content ?? '');
        expect(node.tagName === 'meta' && attrs['http-equiv']?.toLowerCase() === 'refresh').toBe(
          false,
        );
        stack.push(...node.childNodes);
      }
      expect(csp).toHaveLength(1);
      const entries = csp[0]!
        .split(';')
        .filter(Boolean)
        .map((part): [string, string[]] => {
          const [name, ...values] = part.trim().split(/\s+/);
          return [(name ?? '').toLowerCase(), values];
        });
      expect(new Set(entries.map(([name]) => name)).size).toBe(entries.length);
      const directives = new Map(entries);
      for (const name of ['default-src', 'connect-src', 'object-src', 'base-uri', 'form-action'])
        expect(directives.get(name)).toEqual(["'none'"]);
      if (directives.has('script-src')) expect(directives.get('script-src')).toEqual(["'none'"]);
      entry.csp = csp;
      return entry;
    });
  };
  try {
    await page.reload();
    await expect(preview(page).locator('[data-visual-editor-controls]')).toHaveCount(1);
    await expect(
      preview(page).getByRole('heading', { name: 'Uma ideia para o seu próximo passo' }),
    ).toBeVisible();
    await page
      .locator('.playground-controls')
      .getByRole('button', { name: 'E-mail', exact: true })
      .click();
    await panel(page, 'Modelos').click();
    await expect(page.locator('.editor-template-thumbnail iframe')).toHaveCount(3);
    const gallery = await capturePreviews();
    expect(gallery.every((frame) => !frame.modal)).toBe(true);
    await page.getByRole('button', { name: /^Boas-vindas Receba novos contatos/ }).click();
    const confirmation = page.getByRole('dialog', { name: 'Aplicar este modelo?' });
    await expect(confirmation).toBeVisible();
    await expect(page.locator('.editor-template-thumbnail iframe')).toHaveCount(4);
    const withModal = await capturePreviews();
    for (const frame of gallery)
      expect(withModal.find((candidate) => candidate.frameId === frame.frameId)).toEqual(frame);
    const modal = withModal.filter((frame) => frame.modal);
    expect(modal).toHaveLength(1);
    expect(modal[0]!.title).toBe('Aplicar este modelo?');
    expect(new Set(inventory.map((frame) => frame.frameId)).size).toBe(4);
    await confirmation.getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
    await expect(preview(page).locator('[data-visual-editor-controls]')).toHaveCount(1);
    await expect(
      preview(page).getByText('Uma nova conversa começa aqui', { exact: true }),
    ).toBeVisible();
    const bootstrapText =
      "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.";
    // WebKit under automation injects an inspector script into every frame and reports it as
    // blocked in each frame which has no scripts, once per load of that frame. How many loads
    // happened by now depends on timing, so the messages are classified by what they are, never
    // counted: this exact text, from this exact place of the inspector. The same text from a
    // script of a document would come from `about:srcdoc` and stays an unreviewed error.
    const bootstrapOrigin = {
      url: 'web-inspector://bootstrap.js',
      lineNumber: 94,
      columnNumber: 30,
    };
    const blocked = consoleRecords.filter((message) => message.text === bootstrapText);
    const reviewedBootstrap =
      browserName === 'webkit' && inventory.length === 4
        ? blocked.filter(
            (message) =>
              message.type === 'error' &&
              message.location.url === bootstrapOrigin.url &&
              message.location.lineNumber === bootstrapOrigin.lineNumber &&
              message.location.columnNumber === bootstrapOrigin.columnNumber,
          )
        : [];
    expect(
      blocked.filter((message) => !reviewedBootstrap.includes(message)).map((m) => m.location),
    ).toEqual([]);
    if (browserName !== 'webkit') expect(blocked).toEqual([]);
    await test.info().attach('reviewed-webkit-bootstrap-diagnostics', {
      body: JSON.stringify(
        {
          browserName,
          browserVersion: browser.version(),
          reason:
            'Only the exact WebKit inspector bootstrap signature (text, type and origin) is classified, after all four concrete decorative frames pass DOM, hash, markup and CSP checks. One message per load of a frame without scripts: the number is recorded here, not asserted. Sandbox remains unchanged. This is not a zero-console claim.',
          count: reviewedBootstrap.length,
          messages: reviewedBootstrap,
          frameHashes: inventory.map(({ frameId, title, sha256 }) => ({ frameId, title, sha256 })),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(pageErrors).toEqual([]);
    expect(
      consoleRecords.filter(
        (message) => message.type === 'error' && !reviewedBootstrap.includes(message),
      ),
    ).toEqual([]);
    const nativeLayoutWarning =
      '[JavaScript Warning: "Layout was forced before the page was fully loaded. If stylesheets are not yet loaded this may cause a flash of unstyled content." {file: "about:srcdoc" line: 0}]';
    const warnings = consoleRecords.filter((message) => message.type === 'warning');
    const observedNativeWarnings =
      browserName === 'firefox'
        ? warnings.filter((message) => message.text === nativeLayoutWarning)
        : [];
    await test.info().attach('native-layout-warnings', {
      body: JSON.stringify(observedNativeWarnings),
      contentType: 'application/json',
    });
    expect(warnings.filter((message) => !observedNativeWarnings.includes(message))).toEqual([]);
    expect(missing).toEqual([]);
    await page.screenshot({ path: 'test-results/editor-email-desktop.png', fullPage: true });
  } finally {
    await test.info().attach('all-browser-diagnostics', {
      body: JSON.stringify(
        {
          browserName,
          browserVersion: browser.version(),
          pageErrors,
          console: consoleRecords,
          missing,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await test.info().attach('verified-decorative-frame-sources', {
      body: JSON.stringify(inventory, null, 2),
      contentType: 'application/json',
    });
  }
});

test('mobile editing panel is reachable, trapped and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Abrir painel de edição' }).click();
  const dialog = page.getByRole('dialog', { name: 'Painel de edição', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Estrutura', exact: true }).click();
  await dialog.getByRole('treeitem').first().click();
  await expect(dialog.getByRole('treeitem').first()).toHaveAttribute('aria-selected', 'true');
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Abrir painel de edição' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
