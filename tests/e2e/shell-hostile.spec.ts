import { expect, test } from '@playwright/test';
import { CanvasDriver } from './canvas-driver';
import { ShellDriver } from './shell';
import { E2E_ORIGIN } from './origin';

const HOSTILE = [
  '<!doctype html><html><head>',
  `<meta http-equiv="refresh" content="0;url=${E2E_ORIGIN}/hostile-refresh">`,
  '<script>window.hostileInline = true; parent.postMessage({ type: "selection", nodeId: "x" }, "*"); parent.postMessage("hostile", "*");</script>',
  `<script src="${E2E_ORIGIN}/hostile-external.js"></script>`,
  '</head><body>',
  '<main>',
  '<h1>Documento hostil</h1>',
  '<p><button type="button" onclick="window.hostileClick = true; parent.postMessage(\'hostile-click\', \'*\')">Botão com ação</button></p>',
  `<p><img alt="Quebrada" src="${E2E_ORIGIN}/hostile-missing.png" onerror="window.hostileError = true"></p>`,
  '<p><a href="javascript:window.hostileLink = true">Link com código</a></p>',
  `<iframe src="${E2E_ORIGIN}/hostile-frame" width="320" height="120" title="Incorporado"></iframe>`,
  `<form action="${E2E_ORIGIN}/hostile-form" method="post"><input name="campo" value="1"><button type="submit">Enviar formulário</button></form>`,
  '</main>',
  '</body></html>',
].join('');

/** Everything the frame posts to the host is recorded, so a message outside the protocol shows. */
const recordMessages = async (driver: CanvasDriver): Promise<void> => {
  await driver.page.addInitScript(() => {
    if (window !== window.top) return;
    const store = window as Window & { frameMessages?: unknown[] };
    store.frameMessages = [];
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe.editor-preview');
      if (frame && event.source === frame.contentWindow) store.frameMessages?.push(event.data);
    });
  });
};

test('a hostile page is kept as it came and nothing of it runs, navigates or reaches the host', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  const shell = new ShellDriver(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('hostile')) requests.push(request.url());
  });
  await recordMessages(driver);
  await driver.start();
  await driver.import(HOSTILE);
  const frame = driver.frame();
  await expect(frame.getByRole('heading', { name: 'Documento hostil' })).toBeVisible();
  const identity = await driver.identity();
  // A click may open the text of the block; the text may also close on its own meanwhile.
  const leaveText = async (): Promise<void> => {
    if (await driver.editable().count())
      await driver
        .editable()
        .press('Escape', { timeout: 2_000 })
        .catch(() => undefined);
    await expect(driver.editable()).toHaveCount(0);
  };
  // Whatever a person does with the hostile elements, the block is only selected.
  await frame.getByText('Botão com ação', { exact: true }).click();
  await leaveText();
  await frame.getByText('Link com código', { exact: true }).click();
  await leaveText();
  await frame.getByText('Enviar formulário', { exact: true }).click();
  await leaveText();
  await frame.getByText('Enviar formulário', { exact: true }).press('Enter');
  await leaveText();
  // The embedded content does not load: its marker stands for it and selects it.
  const embed = frame.locator('.embed');
  await expect(embed).toHaveText('Conteúdo incorporado');
  // An ordinary click: the marker is at rest, in WebKit too.
  await embed.click();
  await expect(frame.locator('[data-visual-editor-selected="true"]')).toHaveCount(1);
  await embed.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Editar como HTML/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect(
    await frame
      .locator('body')
      .evaluate(() =>
        ['hostileInline', 'hostileClick', 'hostileError', 'hostileLink'].filter(
          (name) => name in window,
        ),
      ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      ['hostileInline', 'hostileClick', 'hostileError', 'hostileLink'].filter(
        (name) => name in window,
      ),
    ),
  ).toEqual([]);
  // No script, frame, form or refresh was requested; the broken image is the only fetch allowed.
  expect(requests.filter((url) => !url.endsWith('hostile-missing.png'))).toEqual([]);
  // The window is the same one: nothing navigated or reloaded it.
  expect((await driver.identity()).nonce).toBe(identity.nonce);
  await expect(
    page.getByRole('heading', { name: 'Editor de e-mail e landing pages' }),
  ).toBeVisible();
  // Every message the host received came from the runtime of the editor, in its protocol.
  const messages = await page.evaluate(
    () => (window as Window & { frameMessages?: unknown[] }).frameMessages ?? [],
  );
  expect(messages.length).toBeGreaterThan(0);
  for (const message of messages) {
    expect(typeof message).toBe('object');
    const data = message as { nonce?: unknown; revision?: unknown; type?: unknown };
    expect(typeof data.nonce).toBe('string');
    expect(typeof data.revision).toBe('number');
    expect(typeof data.type).toBe('string');
  }
  expect(messages.filter((message) => (message as { nodeId?: unknown }).nodeId === 'x')).toEqual(
    [],
  );
  // What was kept is information in a discreet indicator, never a standing alert.
  await expect(page.locator('.editor-diagnostics [role="alert"]')).toHaveCount(0);
  const indicator = page.locator('.editor-notice-indicator');
  await indicator.getByRole('button').click();
  const notices = indicator.locator('.editor-notice-list li');
  await expect(notices.first()).toBeVisible();
  const texts = await notices.locator('.editor-diagnostic-text').allInnerTexts();
  expect(texts).toContain('Scripts da página foram mantidos. Eles não rodam dentro do editor.');
  expect(new Set(texts).size).toBe(texts.length);
  await page.keyboard.press('Escape');
  // The exported document still has everything.
  await shell.mode('HTML').click();
  const code = page.getByRole('textbox', { name: 'HTML', exact: true });
  for (const kept of [
    'window.hostileInline = true',
    'hostile-external.js',
    'onclick=',
    'onerror=',
    'javascript:window.hostileLink',
    '<iframe',
    'hostile-form',
    'http-equiv="refresh"',
  ])
    await expect(code, kept).toContainText(kept);
});

test('a hostile e-mail loses what e-mail programs refuse, with one grouped notice for each kind', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  const shell = new ShellDriver(page);
  await driver.start();
  const before = await driver.identity();
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'E-mail', exact: true })
    .click();
  await driver.ready(before);
  await driver.import(
    [
      '<table role="presentation" width="600"><tbody><tr><td>',
      '<p onclick="window.hostileClick = true">Mensagem com ação</p>',
      '<p onmouseover="window.hostileOver = true">Outra ação</p>',
      '<p><a href="javascript:window.hostileLink = true">Link com código</a></p>',
      '<script>window.hostileInline = true</script><script>window.hostileSecond = true</script>',
      '<iframe src="https://example.test/frame"></iframe>',
      '</td></tr></tbody></table>',
    ].join(''),
  );
  const frame = driver.frame();
  await expect(frame.getByText('Mensagem com ação', { exact: true })).toBeVisible();
  const warnings = page.locator('.editor-warnings');
  await expect(warnings).toBeVisible();
  const lines = warnings.locator('.editor-diagnostic-list li');
  const texts = await lines.locator('.editor-diagnostic-text').allInnerTexts();
  expect(texts).toContain('Scripts foram removidos: programas de e-mail não os aceitam.');
  expect(new Set(texts).size).toBe(texts.length);
  // Two scripts and two handlers are one line each, with their count beside it.
  await expect(
    lines.filter({ hasText: 'Scripts foram removidos' }).locator('.editor-badge'),
  ).toHaveText('2×');
  await expect(page.locator('.editor-diagnostics [role="alert"]')).toHaveCount(0);
  await shell.mode('HTML').click();
  const code = page.getByRole('textbox', { name: 'HTML', exact: true });
  await expect(code).toContainText('Mensagem com ação');
  await expect(code).toContainText('Link com código');
  for (const removed of ['<script', 'onclick', 'onmouseover', 'javascript:', '<iframe'])
    await expect(code, removed).not.toContainText(removed);
  await shell.mode('Visual').click();
  // The notice is dismissed once and stays available in the indicator.
  await warnings.getByRole('button', { name: 'Dispensar aviso', exact: true }).click();
  await expect(warnings).toBeHidden();
  await page.locator('.editor-notice-indicator').getByRole('button').click();
  await expect(page.locator('.editor-notice-list')).toContainText('Scripts foram removidos');
});

const EVIL = 'https://evil.example/';
const NOSCRIPT_REFRESH = [
  '<body>',
  '<h1>Peça com conteúdo alternativo</h1>',
  '<p>Primeiro trecho</p>',
  '<p>Segundo trecho</p>',
  `<noscript><meta http-equiv="refresh" content="0;url=${EVIL}"><p data-visual-editor-node="forjado">alternativo</p></noscript>`,
  '</body>',
].join('');

/** Requests and navigations which would mean the frame left the editor. */
const watchEscape = (page: import('@playwright/test').Page): string[] => {
  const escapes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('evil.example')) escapes.push(`request ${request.url()}`);
  });
  page.on('framenavigated', (navigated) => {
    // Frames of the shell start blank and are then written; only another address is an escape.
    if (navigated.parentFrame() && !['about:srcdoc', 'about:blank'].includes(navigated.url()))
      escapes.push(`navigation ${navigated.url()}`);
  });
  return escapes;
};

for (const kind of ['page', 'email'] as const)
  test(`a refresh hidden in noscript never takes the window of a ${kind}, at load or through later revisions`, async ({
    page,
  }) => {
    const driver = new CanvasDriver(page);
    const escapes = watchEscape(page);
    await driver.start();
    if (kind === 'email') {
      const before = await driver.identity();
      await page
        .locator('.playground-controls')
        .getByRole('button', { name: 'E-mail', exact: true })
        .click();
      await driver.ready(before);
    }
    await driver.import(NOSCRIPT_REFRESH);
    const frame = driver.frame();
    await expect(
      frame.getByRole('heading', { name: 'Peça com conteúdo alternativo' }),
    ).toBeVisible();
    const identity = await driver.identity();
    const loads = await driver
      .element()
      .evaluate((element) => (element as HTMLElement).dataset.loads);
    // Each edition is a revision reconciled inside the running window by the parser which reads
    // noscript as markup: that is where the refresh used to come alive.
    for (const [from, to] of [
      ['Primeiro trecho', 'Primeiro trecho alterado'],
      ['Segundo trecho', 'Segundo trecho alterado'],
      ['Primeiro trecho alterado', 'Primeiro trecho final'],
    ] as const) {
      const previous = await driver.identity();
      await driver.edit(from);
      await driver.replace(to);
      await driver.finish();
      await driver.ready(previous);
      await expect(frame.getByText(to, { exact: true })).toBeVisible();
    }
    await page.waitForTimeout(1_200);
    // The same window, never loaded again, and nothing went looking for the other address.
    expect((await driver.identity()).nonce).toBe(identity.nonce);
    expect(
      await driver.element().evaluate((element) => (element as HTMLElement).dataset.loads),
    ).toBe(loads);
    expect(escapes).toEqual([]);
    expect(await frame.locator('meta[http-equiv="refresh" i]').count()).toBe(0);
    expect(await frame.locator('[data-visual-editor-node="forjado"]').count()).toBe(0);
    // The editor still works, and the document kept what was written.
    await driver.select('Segundo trecho alterado');
    await expect(frame.locator('[data-visual-editor-selected="true"]')).toHaveCount(1);
    await new ShellDriver(page).mode('HTML').click();
    const code = page.getByRole('textbox', { name: 'HTML', exact: true });
    await expect(code).toContainText('Primeiro trecho final');
    // A page keeps the refresh as its author wrote it. An e-mail loses every refresh and base
    // at the import (`ActiveMarkupRules.navigation`), noscript included.
    if (kind === 'page') await expect(code).toContainText('http-equiv="refresh"');
    else {
      await expect(code).not.toContainText('http-equiv="refresh"');
      await expect(code).not.toContainText(EVIL);
    }
  });

test('the running window never receives what would act on it, whatever revision it is sent', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  const escapes = watchEscape(page);
  await driver.start();
  await driver.import('<p>Base da peça</p>');
  const identity = await driver.identity();
  // The message a host would send, with markup no host of this editor produces: the proof is
  // of the last layer alone.
  await driver.element().evaluate(
    (element, { nonce, revision, evil }) => {
      (element as HTMLIFrameElement).contentWindow?.postMessage(
        {
          type: 'document',
          nonce,
          revision: revision + 1_000,
          readOnly: false,
          regions: [{ id: 'x', parentId: null, editable: false, container: false }],
          html: [
            '<!doctype html><html><head><title>t</title>',
            `<meta http-equiv="refresh" content="0;url=${evil}"><base href="${evil}">`,
            '</head><body>',
            '<p data-visual-editor-node="x">Revisão forjada</p>',
            `<meta http-equiv="refresh" content="0;url=${evil}">`,
            `<base href="${evil}"><link rel="import" href="${evil}">`,
            `<div><meta http-equiv="refresh" content="0;url=${evil}"></div>`,
            `<noscript><meta http-equiv="refresh" content="0;url=${evil}"><p data-visual-editor-node="x">dentro</p></noscript>`,
            '<script>window.hostileMorph = true</script>',
            '</body></html>',
          ].join(''),
        },
        '*',
      );
    },
    { nonce: identity.nonce, revision: Number(identity.revision), evil: EVIL },
  );
  const frame = driver.frame();
  await expect(frame.getByText('Revisão forjada', { exact: true })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(escapes).toEqual([]);
  expect(await frame.locator('body meta, body base, link[rel="import"], noscript *').count()).toBe(
    0,
  );
  expect(await frame.locator('[data-visual-editor-node="x"]').count()).toBe(1);
  expect(await frame.locator('body').evaluate(() => 'hostileMorph' in window)).toBe(false);
  await expect(frame.getByText('Revisão forjada', { exact: true })).toBeVisible();
});

test('a page made of frames is explained in place of the piece and stays editable as HTML', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  const shell = new ShellDriver(page);
  await driver.start();
  await page.locator('.editor-file-input').setInputFiles({
    name: 'quadros.html',
    mimeType: 'text/html',
    buffer: Buffer.from(
      '<!doctype html><html><head><title>Quadros</title></head><frameset cols="50%,50%"><frame src="https://example.test/a"><frame src="https://example.test/b"></frameset></html>',
    ),
  });
  await expect(page.locator('.editor-feedback')).toContainText('Conteúdo importado');
  const failure = page.locator('.editor-canvas-failure');
  await expect(failure).toBeVisible();
  await expect(failure).toHaveAttribute('role', 'alert');
  await expect(failure).toContainText('Esta página é formada por quadros');
  await expect(driver.element()).toBeHidden();
  await failure.getByRole('button', { name: 'Abrir modo HTML', exact: true }).click();
  const code = page.getByRole('textbox', { name: 'HTML', exact: true });
  await expect(code).toContainText('<frameset');
  // Another content brings the piece back.
  await shell.mode('Visual').click();
  await expect(failure).toBeVisible();
  await page.locator('.editor-file-input').setInputFiles({
    name: 'normal.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<p>Peça de volta</p>'),
  });
  await expect(driver.frame().getByText('Peça de volta', { exact: true })).toBeVisible();
  await expect(failure).toHaveCount(0);
  await expect(driver.element()).toBeVisible();
});

test('a style sheet added to the head by a revision reaches the piece in a new window', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<!doctype html><html><head><title>t</title></head><body><p>Texto da peça</p></body></html>',
  );
  const first = await driver.identity();
  const frame = driver.frame();
  await expect(frame.locator('head link[rel="stylesheet"]')).toHaveCount(0);
  // A change which leaves the head alone is reconciled in the same window.
  await driver.import(
    '<!doctype html><html><head><title>t</title></head><body><p>Texto alterado</p></body></html>',
  );
  expect((await driver.identity()).nonce).toBe(first.nonce);
  await driver.import(
    '<!doctype html><html><head><title>t</title><link rel="stylesheet" href="https://assets.invalid/tema.css"></head><body><p>Texto com folha</p></body></html>',
  );
  await expect(frame.getByText('Texto com folha', { exact: true })).toBeVisible();
  await expect(frame.locator('head link[rel="stylesheet"]')).toHaveCount(1);
  expect((await driver.identity()).nonce).not.toBe(first.nonce);
});

test('an element after an inline drawing can be edited as HTML', async ({ page }) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<section><p>Antes do desenho</p><svg width="40" height="40" viewBox="0 0 40 40"><g><rect width="40" height="40" fill="#0d9488"/></g></svg><p>Depois do desenho</p></section>',
  );
  const frame = driver.frame();
  await frame.getByText('Depois do desenho', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Editar como HTML/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar como HTML' });
  const code = dialog.getByRole('textbox', { name: 'HTML do elemento' });
  await expect(code).toHaveText('<p>Depois do desenho</p>');
  await code.click();
  await code.press('ControlOrMeta+A');
  await page.keyboard.insertText('<p>Depois, alterado</p>');
  await dialog.getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(frame.getByText('Depois, alterado', { exact: true })).toBeVisible();
  await expect(frame.locator('section > svg rect')).toHaveCount(1);
});
