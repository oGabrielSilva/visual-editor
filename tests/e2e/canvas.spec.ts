import { expect, test } from '@playwright/test';
import { ShellDriver } from './shell';
import { readFile } from 'node:fs/promises';
import { EditorDocument } from '../../src/core/document';
import { CanvasDriver } from './canvas-driver';

test('edits in the canvas without reloading per keystroke, saves the active gesture and undoes it once', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<main><h1 style="color:#12645c">Título do canvas</h1><p>Outro conteúdo.</p></main>',
  );
  const initialFrame = await page.locator('iframe.editor-preview').boundingBox();
  await driver.edit('Título do canvas');
  expect((await page.locator('iframe.editor-preview').boundingBox())?.y).toBe(initialFrame?.y);
  const before = await page.locator('iframe.editor-preview').getAttribute('srcdoc');
  const editable = driver.editable();
  await expect(editable).toHaveJSProperty('tagName', 'H1');
  await driver.replace('Título editado diretamente');
  await editable.press('End');
  await page.keyboard.insertText(' aqui');
  expect(await page.locator('iframe.editor-preview').getAttribute('srcdoc')).toBe(before);
  await expect(page.locator('.editor-status')).toHaveText('Alterações pendentes');
  await page
    .locator('.editor-toolbar')
    .getByRole('button', { name: 'Salvar', exact: true })
    .click();
  await expect(
    driver.frame().getByRole('heading', { name: 'Título editado diretamente aqui' }),
  ).toBeVisible();
  await expect(driver.editable()).toHaveCount(0);
  await expect(driver.activeBar()).toHaveCount(0);
  // Saving, undoing and redoing reconcile the same window: its source is never rewritten.
  expect(await page.locator('iframe.editor-preview').getAttribute('srcdoc')).toBe(before);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(driver.frame().getByRole('heading', { name: 'Título do canvas' })).toBeVisible();
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  await expect(
    driver.frame().getByRole('heading', { name: 'Título editado diretamente aqui' }),
  ).toBeVisible();
});

test('selects the logical paragraph through a mark, preserves markup and cancels an inline gesture', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<main><p>Olá <strong class="native-mark">Nico Robin</strong> e <a href="https://example.test/">converse</a>.</p><figure data-native="kept"><figcaption>Região nativa</figcaption></figure></main>',
  );
  await driver.frame().getByText('Nico Robin', { exact: true }).click();
  await expect(page.locator('.editor-selected-title')).toContainText('Olá Nico Robin');
  const editable = await driver.edit('Nico Robin');
  await expect(editable.locator('strong.native-mark')).toHaveText('Nico Robin');
  await editable.press('ControlOrMeta+End');
  await page.keyboard.insertText(' Mais contexto.');
  await editable.press('ControlOrMeta+Enter');
  await expect(driver.frame().locator('p')).toContainText('Mais contexto.');
  await expect(driver.frame().locator('strong.native-mark')).toHaveText('Nico Robin');
  await expect(driver.frame().locator('a')).toHaveAttribute('href', 'https://example.test/');
  await driver.frame().locator('p').click();
  await driver.replace('Rascunho cancelado');
  await expect(driver.frame().getByText('Rascunho cancelado')).toHaveCount(1);
  // Escape concludes; discarding is the explicit action of the formatting bar.
  await driver.bar().getByRole('button', { name: 'Cancelar edição', exact: true }).click();
  await expect(driver.editable()).toHaveCount(0);
  await expect(driver.frame().locator('p')).toContainText('Mais contexto.');
  await expect(driver.frame().getByText('Rascunho cancelado')).toHaveCount(0);
  await expect(driver.frame().locator('figure[data-native="kept"]')).toHaveCount(1);
  await expect(page.locator('.editor-properties figure')).toHaveCount(0);
});

test('moves a real canvas block with its handle, supports keyboard move and confirms removal', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><h1>Primeiro</h1><p>Segundo</p><p>Terceiro</p></main>');
  await driver.move('Segundo', 'Terceiro');
  await expect(driver.frame().locator('main > p')).toHaveText(['Terceiro', 'Segundo']);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(driver.frame().locator('main > p')).toHaveText(['Segundo', 'Terceiro']);
  await driver.frame().getByText('Segundo', { exact: true }).focus();
  await driver.frame().getByText('Segundo', { exact: true }).press('Alt+ArrowDown');
  await expect(driver.frame().locator('main > p')).toHaveText(['Terceiro', 'Segundo']);
  await driver.select('Segundo');
  await driver.frame().getByRole('button', { name: 'Remover', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Remover este bloco?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(driver.frame().getByText('Segundo', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(driver.frame().getByText('Segundo', { exact: true })).toBeVisible();
});

test('drags a palette block into a section instead of appending it outside the page', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<main><section style="padding:40px;min-height:180px"><h1>Destino</h1></section></main>',
  );
  const palette = page
    .locator('.editor-palette-grid')
    .getByRole('button', { name: 'Texto', exact: true });
  const from = await palette.boundingBox();
  const to = await driver.frame().locator('section').boundingBox();
  if (!from || !to) throw new Error('MISSING_PALETTE_TARGET');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await expect(page.locator('iframe.editor-preview')).toHaveCSS('pointer-events', 'none');
  await page.mouse.move(to.x + 30, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(driver.frame().locator('main > section p')).toHaveCount(1);
  await expect(driver.frame().locator('body > p')).toHaveCount(0);
  await expect(page.locator('iframe.editor-preview')).toHaveCSS('pointer-events', 'auto');
});

test('edits and moves email content as complete table units and preserves unknown native content', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'E-mail', exact: true })
    .click();
  await driver.import(
    '<!doctype html><html><body><table role="presentation"><tbody><tr><td style="padding:24px"><p>Primeiro e-mail</p></td></tr><tr><td><p>Segundo e-mail</p></td></tr></tbody></table><!--[if mso]><table><tr><td>Compatibilidade</td></tr></table><![endif]--></body></html>',
  );
  await driver.edit('Primeiro e-mail');
  await driver.replace('Texto visual de e-mail');
  await driver.finish();
  await expect(driver.frame().getByText('Texto visual de e-mail')).toBeVisible();
  await driver.move('Texto visual de e-mail', 'Segundo e-mail');
  await expect(driver.frame().locator('tbody > tr')).toHaveText([
    'Segundo e-mail',
    'Texto visual de e-mail',
  ]);
  await expect(driver.frame().locator('tr').nth(1).locator('td')).toHaveAttribute(
    'style',
    /padding:24px/,
  );
  await page
    .locator('.editor-mode-switch')
    .getByRole('button', { name: 'HTML', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toContainText('[if mso]');
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).not.toContainText(
    'data-editor-rich-origin',
  );
});

test('formats part of an attributed span without losing styles or duplicating its HTML identity', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<main><p><span class="brand" id="unique-mark" style="color:#12645c">AB</span></p></main>',
  );
  const editable = await driver.edit('AB');
  await expect(editable).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+ArrowLeft');
  const selectionProof = await editable.evaluate(() => {
    const selection = window.getSelection();
    return {
      selected: selection?.toString(),
      anchor: selection?.anchorOffset,
      focus: selection?.focusOffset,
      node: selection?.anchorNode?.textContent,
      active: document.activeElement?.outerHTML,
    };
  });
  expect(selectionProof.selected, JSON.stringify(selectionProof)).toBe('B');
  await driver.bar().getByRole('button', { name: 'Negrito', exact: true }).click();
  await expect(editable.locator('strong')).toHaveText('B');
  // The source span keeps its class and color on both halves while it is being edited.
  await expect(editable.locator('span.brand')).toHaveCount(2);
  await driver.finish();
  await expect(driver.frame().locator('p')).toHaveText('AB');
  await expect(driver.frame().locator('strong')).toHaveText('B');
  await expect(driver.frame().locator('#unique-mark')).toHaveCount(1);
  await expect(driver.frame().locator('.brand')).toHaveCount(2);
});

test('reviews an invalid recovery buffer as inert code and returns to the valid document', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  const source = '<p>Documento preservado</p>';
  await driver.import(source);
  const downloadEvent = page.waitForEvent('download');
  await new ShellDriver(page).file('Exportar documento');
  const path = await (await downloadEvent).path();
  if (!path) throw new Error('MISSING_EXPORTED_DOCUMENT');
  const external: unknown = JSON.parse(await readFile(path, 'utf8'));
  const document = EditorDocument.from(external).snapshot();
  const paragraph = document.nodes.find((node) => node.tag === 'p');
  if (!paragraph) throw new Error('MISSING_RECOVERY_TARGET');
  const recovery = JSON.stringify({
    format: 'visual-editor-recovery-v1',
    document,
    pendingSource: { html: source, css: '' },
    pendingRichText: {
      id: paragraph.id,
      html: '<p>Texto pendente</p><script>window.badRecovery=true</script>',
      originalHtml: '<p>Documento preservado</p>',
      changed: true,
      valid: false,
      documentId: document.id,
      baseRevision: document.revision,
      editGeneration: 0,
    },
  });
  await page.reload();
  await expect(
    driver.frame().getByRole('heading', { name: 'Uma ideia para o seu próximo passo' }),
  ).toBeVisible();
  await page.locator('.editor-file-input').setInputFiles({
    name: 'recovery.json',
    mimeType: 'application/json',
    buffer: Buffer.from(recovery),
  });
  await page.getByRole('button', { name: 'Revisar alteração', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Revisar alteração pendente' });
  await expect(dialog.getByRole('textbox', { name: 'Conteúdo pendente' })).toContainText(
    '<script>',
  );
  expect(await page.evaluate(() => 'badRecovery' in window)).toBe(false);
  await dialog.getByRole('button', { name: 'Descartar alteração', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Descartar esta alteração?' })
    .getByRole('button', { name: 'Descartar alteração', exact: true })
    .click();
  await expect(driver.frame().getByText('Documento preservado', { exact: true })).toBeVisible();
  await driver.edit('Documento preservado');
  await driver.replace('Documento recuperado');
  await driver.finish();
  await expect(driver.frame().getByText('Documento recuperado', { exact: true })).toBeVisible();
});

test('Escape cancels canvas and palette drags without changing the document', async ({ page }) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p>Primeiro bloco</p><p>Segundo bloco</p></main>');
  await driver.select('Primeiro bloco');
  const handle = driver.frame().getByRole('button', { name: 'Mover', exact: true });
  await expect(handle).toBeVisible();
  await handle.focus();
  const from = await handle.boundingBox();
  const target = await driver.frame().getByText('Segundo bloco', { exact: true }).boundingBox();
  if (!from || !target) throw new Error('MISSING_DRAG_TARGET');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + target.height * 0.8, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('iframe.editor-preview')).toHaveCSS('pointer-events', 'auto');
  await expect(driver.frame().locator('main > p')).toHaveText(['Primeiro bloco', 'Segundo bloco']);
  await page
    .locator('.editor-panel-tabs')
    .getByRole('tab', { name: 'Blocos', exact: true })
    .click();
  const palette = page
    .locator('.editor-palette-grid')
    .getByRole('button', { name: 'Texto', exact: true });
  const block = await palette.boundingBox();
  const canvas = await page.locator('iframe.editor-preview').boundingBox();
  if (!block || !canvas) throw new Error('MISSING_INSERT_TARGET');
  await palette.focus();
  await page.mouse.move(block.x + block.width / 2, block.y + block.height / 2);
  await page.mouse.down();
  await expect(page.locator('iframe.editor-preview')).toHaveCSS('pointer-events', 'none');
  await page.mouse.move(canvas.x + 50, canvas.y + 150, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('iframe.editor-preview')).toHaveCSS('pointer-events', 'auto');
  await expect(driver.frame().locator('main > p')).toHaveText(['Primeiro bloco', 'Segundo bloco']);
  await expect(
    driver.frame().getByText('Escreva uma mensagem para sua próxima conversa.', { exact: true }),
  ).toHaveCount(0);
  await palette.focus();
  await page.mouse.move(block.x + block.width / 2, block.y + block.height / 2);
  await page.mouse.down();
  await expect(page.locator('iframe.editor-preview')).toHaveCSS('pointer-events', 'none');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('iframe.editor-preview')).toHaveCSS('pointer-events', 'auto');
  await expect(driver.frame().locator('main > p')).toHaveText(['Primeiro bloco', 'Segundo bloco']);
  await expect(
    driver.frame().getByText('Escreva uma mensagem para sua próxima conversa.', { exact: true }),
  ).toHaveCount(0);
});

test('restores selection and viewport after a commit while external media is still pending', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  let requested = 0;
  const pending: (() => Promise<void>)[] = [];
  await page.route('https://example.test/slow-canvas.png', (route) => {
    requested++;
    pending.push(() => route.fulfill({ status: 204, body: '' }));
  });
  try {
    await driver.import(
      '<main><div style="height:1200px">Início</div><p>Depois da rolagem</p><img src="https://example.test/slow-canvas.png" width="20" height="20" alt="Mídia pendente"/></main>',
    );
    await expect.poll(() => requested).toBeGreaterThan(0);
    await driver.frame().getByText('Depois da rolagem', { exact: true }).scrollIntoViewIfNeeded();
    await driver.edit('Depois da rolagem');
    await driver.replace('Conteúdo depois da rolagem');
    await driver.finish();
    await expect(driver.frame().locator('p')).toHaveAttribute(
      'data-visual-editor-selected',
      'true',
    );
    await expect(
      driver.frame().getByText('Conteúdo depois da rolagem', { exact: true }),
    ).toBeInViewport();
    await expect(
      driver.frame().getByRole('button', { name: 'Editar texto', exact: true }),
    ).toBeVisible();
  } finally {
    await Promise.all(pending.map((complete) => complete()));
  }
});

for (const interact of [false, true]) {
  test(`restores a clamped viewport after pending media only without later interaction: ${interact}`, async ({
    page,
  }) => {
    const driver = new CanvasDriver(page);
    await driver.start();
    const pending: (() => Promise<void>)[] = [];
    const url = 'https://example.test/deferred-viewport.svg';
    let released = false;
    const image =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="1800"><rect width="32" height="1800" fill="teal"/></svg>';
    await page.route(url, (route) => {
      const complete = () =>
        route.fulfill({ status: 200, contentType: 'image/svg+xml', body: image });
      if (released) return complete();
      pending.push(complete);
    });
    try {
      await driver.import(
        `<main><p>Desejo de rolagem</p><img src="${url}" alt="Mídia adiada"/></main>`,
      );
      await expect.poll(() => pending.length).toBeGreaterThan(0);
      const before = await page.locator('iframe.editor-preview').getAttribute('srcdoc');
      const previousSequence = await page
        .locator('iframe.editor-preview')
        .evaluate((element) => Number((element as HTMLElement).dataset.restoredSequence));
      // Exercise the existing scoped host-to-frame viewport command through its DOM boundary.
      await page.locator('iframe.editor-preview').evaluate((element) => {
        if (!(element instanceof HTMLIFrameElement) || !element.contentWindow)
          throw new Error('MISSING_FRAME');
        element.contentWindow.postMessage(
          {
            type: 'viewport',
            nonce: element.dataset.readyNonce,
            revision: Number(element.dataset.readyRevision),
            x: 0,
            y: 700,
          },
          '*',
        );
      });
      await expect
        .poll(() =>
          page
            .locator('iframe.editor-preview')
            .evaluate((element) => Number((element as HTMLElement).dataset.restoredSequence)),
        )
        .toBeGreaterThan(previousSequence);
      await expect
        .poll(() =>
          driver
            .frame()
            .locator('body')
            .evaluate(() => scrollY),
        )
        .toBe(0);
      if (interact) await driver.frame().getByText('Desejo de rolagem', { exact: true }).click();
      released = true;
      await Promise.all(pending.splice(0).map((complete) => complete()));
      await expect
        .poll(() =>
          driver
            .frame()
            .locator('img')
            .evaluate(
              (element) =>
                element instanceof HTMLImageElement &&
                element.complete &&
                element.naturalHeight === 1800,
            ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          driver
            .frame()
            .locator('body')
            .evaluate(() => document.readyState),
        )
        .toBe('complete');
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect
        .poll(() =>
          driver
            .frame()
            .locator('body')
            .evaluate(() => scrollY),
        )
        .toBe(interact ? 0 : 700);
      expect(await page.locator('iframe.editor-preview').getAttribute('srcdoc')).toBe(before);
    } finally {
      released = true;
      await Promise.all(pending.splice(0).map((complete) => complete()));
    }
  });
}

test('keeps the native serif face during direct text editing', async ({ page }) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p>Texto com serifa</p></main>');
  const measureGlyphs = (element: Element) => {
    const node = element.firstChild;
    if (!(node instanceof Text) || node.textContent !== element.textContent)
      throw new Error('UNEXPECTED_GLYPH_FIXTURE');
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(node);
    const bounds = range.getBoundingClientRect();
    const text = node.textContent ?? '';
    const glyphs = Array.from(text, (character, index) => {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const glyph = range.getBoundingClientRect();
      range.setStart(node, 0);
      const advance = range.getBoundingClientRect().width;
      return {
        character,
        x: glyph.x - bounds.x,
        y: glyph.y - bounds.y,
        width: glyph.width,
        height: glyph.height,
        advance,
      };
    });
    return {
      family: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
      style: style.fontStyle,
      letterSpacing: style.letterSpacing,
      text,
      glyphs,
    };
  };
  const native = await driver.frame().locator('p').evaluate(measureGlyphs);
  await test.info().attach('native-font-family', {
    body: native.family,
    contentType: 'text/plain',
  });
  const editable = await driver.edit('Texto com serifa');
  await expect(editable).toHaveJSProperty('tagName', 'P');
  const rendered = await editable.evaluate(measureGlyphs);
  await test.info().attach('native-and-edited-glyphs', {
    body: JSON.stringify({ native, rendered }, null, 2),
    contentType: 'application/json',
  });
  const alias =
    native.family.trim().toLowerCase() === '-webkit-standard' &&
    rendered.family.trim().toLowerCase() === 'serif';
  expect(rendered.family === native.family || alias).toBe(true);
  expect(rendered.text).toBe(native.text);
  for (const key of ['size', 'weight', 'style', 'letterSpacing'] as const)
    expect(rendered[key]).toBe(native[key]);
  expect(rendered.glyphs).toHaveLength(native.glyphs.length);
  for (const [index, glyph] of native.glyphs.entries()) {
    const actual = rendered.glyphs[index];
    if (!actual) throw new Error('MISSING_EDITED_GLYPH');
    expect(actual.character).toBe(glyph.character);
    for (const key of ['x', 'y', 'width', 'height', 'advance'] as const)
      expect(actual[key], `glyph ${index} ${key}`).toBeCloseTo(glyph[key], 1);
  }
  const shellFamily = await page
    .locator('.visual-editor')
    .evaluate((element) => getComputedStyle(element).fontFamily);
  await expect(driver.bar().locator('.editor-richtext-toolbar')).toHaveCSS(
    'font-family',
    shellFamily,
  );
  await driver.replace('Texto com serifa preservada');
  await driver.finish();
  await expect(driver.frame().locator('p')).toHaveText('Texto com serifa preservada');
});

test('keeps touch surface gestures native while the touch handle can cancel or commit one move', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<main><p>Primeiro toque</p><p>Segundo toque</p><div style="height:1800px">Fim</div></main>',
  );
  const undo = page.getByRole('button', { name: 'Desfazer', exact: true });
  const undoInitiallyEnabled = await undo.isEnabled();
  const source = driver.frame().getByText('Primeiro toque', { exact: true });
  const initialSelection = await driver
    .frame()
    .locator('[data-visual-editor-selected]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-visual-editor-node')),
    );
  await source.evaluate((element) => {
    const capture = element.closest<HTMLElement>('[data-visual-editor-node]');
    if (!capture) throw new Error('MISSING_TOUCH_SOURCE');
    capture.dataset.pointerCaptures = '0';
    capture.setPointerCapture = () => {
      capture.dataset.pointerCaptures = String(Number(capture.dataset.pointerCaptures) + 1);
    };
    const rect = element.getBoundingClientRect();
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 901,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + 20,
      clientY: rect.top + rect.height / 2,
    });
    element.dispatchEvent(event);
    if (event.defaultPrevented) throw new Error('SURFACE_TOUCH_DOWN_CANCELLED');
  });
  const surfaceResult = await source.evaluate((element) => {
    const target = [...document.querySelectorAll('p')].find(
      (node) => node.textContent === 'Segundo toque',
    );
    if (!target) throw new Error('MISSING_TOUCH_TARGET');
    const rect = target.getBoundingClientRect();
    const move = new PointerEvent('pointermove', {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 901,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + 20,
      clientY: rect.top + rect.height * 0.8,
    });
    element.dispatchEvent(move);
    element.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: 901,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: rect.left + 20,
        clientY: rect.top + rect.height * 0.8,
      }),
    );
    return {
      prevented: move.defaultPrevented,
      captures: Number(
        element.closest<HTMLElement>('[data-visual-editor-node]')?.dataset.pointerCaptures,
      ),
    };
  });
  expect(surfaceResult).toEqual({ prevented: false, captures: 0 });
  expect(
    await driver
      .frame()
      .locator('[data-visual-editor-selected]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-visual-editor-node')),
      ),
  ).toEqual(initialSelection);
  await expect(driver.frame().locator('main > p')).toHaveText(['Primeiro toque', 'Segundo toque']);
  expect(await undo.isEnabled()).toBe(undoInitiallyEnabled);

  await source.evaluate((element) =>
    element.dispatchEvent(
      new PointerEvent('click', {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
      }),
    ),
  );
  await expect(page.locator('.editor-selected-title')).toContainText('Primeiro toque');
  // A tap opens the text; the block actions return when the edition is concluded.
  await expect(driver.editable()).toHaveCount(1);
  await driver.editable().press('Escape');
  await expect(driver.editable()).toHaveCount(0);
  const handle = driver.frame().getByRole('button', { name: 'Mover', exact: true });
  await expect(handle).toBeVisible();
  expect(await handle.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');
  for (const commit of [false, true]) {
    const started = await handle.evaluate(
      (element, pointerId) => {
        const capture = element as HTMLElement;
        let captured = false;
        capture.dataset.pointerCaptures = '0';
        capture.dataset.pointerReleases = '0';
        capture.setPointerCapture = () => {
          captured = true;
          capture.dataset.pointerCaptures = String(Number(capture.dataset.pointerCaptures) + 1);
        };
        capture.hasPointerCapture = () => captured;
        capture.releasePointerCapture = () => {
          captured = false;
          capture.dataset.pointerReleases = String(Number(capture.dataset.pointerReleases) + 1);
        };
        const rect = element.getBoundingClientRect();
        const event = new PointerEvent('pointerdown', {
          bubbles: true,
          composed: true,
          cancelable: true,
          pointerId,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        });
        element.dispatchEvent(event);
        return {
          prevented: event.defaultPrevented,
          captures: Number(capture.dataset.pointerCaptures),
        };
      },
      commit ? 903 : 902,
    );
    expect(started).toEqual({ prevented: true, captures: 1 });
    const ended = await handle.evaluate(
      (element, { pointerId, commit }) => {
        const target = [...document.querySelectorAll('p')].find(
          (node) => node.textContent === 'Segundo toque',
        );
        if (!target) throw new Error('MISSING_TOUCH_TARGET');
        const rect = target.getBoundingClientRect();
        const values = {
          bubbles: true,
          composed: true,
          cancelable: true,
          pointerId,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: rect.left + 20,
          clientY: rect.top + rect.height * 0.8,
        };
        const move = new PointerEvent('pointermove', values);
        element.dispatchEvent(move);
        const controls = document.querySelector('[data-visual-editor-controls]')?.shadowRoot;
        const markerVisible = controls?.querySelector<HTMLElement>('.drop')?.hidden === false;
        element.dispatchEvent(
          new PointerEvent(commit ? 'pointerup' : 'pointercancel', { ...values, buttons: 0 }),
        );
        return {
          prevented: move.defaultPrevented,
          markerVisible,
          releases: Number((element as HTMLElement).dataset.pointerReleases),
          markerHidden: controls?.querySelector<HTMLElement>('.drop')?.hidden,
        };
      },
      { pointerId: commit ? 903 : 902, commit },
    );
    expect(ended).toEqual({
      prevented: true,
      markerVisible: true,
      releases: 1,
      markerHidden: true,
    });
    await expect(driver.frame().locator('main > p')).toHaveText(
      commit ? ['Segundo toque', 'Primeiro toque'] : ['Primeiro toque', 'Segundo toque'],
    );
    if (!commit) expect(await undo.isEnabled()).toBe(undoInitiallyEnabled);
  }
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(driver.frame().locator('main > p')).toHaveText(['Primeiro toque', 'Segundo toque']);
  expect(await undo.isEnabled()).toBe(undoInitiallyEnabled);
});
