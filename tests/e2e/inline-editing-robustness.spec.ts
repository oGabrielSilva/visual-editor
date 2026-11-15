import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { TEXT_PIECE_HTML } from '../../playground/text-piece';
import { CanvasDriver } from './canvas-driver';

const undo = (page: Page): Locator => page.getByRole('button', { name: 'Desfazer', exact: true });
const loads = (driver: CanvasDriver): Promise<string | null> =>
  driver.element().getAttribute('data-loads');
const frameScroll = (driver: CanvasDriver): Promise<number> =>
  driver
    .frame()
    .locator('body')
    .evaluate(() => scrollY);

/** The rectangle of every rendered line of text and the color of every run. */
const lines = (target: Locator): Promise<{ rects: number[][]; colors: string[] }> =>
  target.evaluate((element) => {
    const rects = new Map<number, number[]>();
    const colors: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim() || !node.parentElement) continue;
      colors.push(getComputedStyle(node.parentElement).color);
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width < 0.5) continue;
        const key = Math.round(rect.top * 2);
        const line = rects.get(key) ?? [rect.left, rect.top, rect.right, rect.bottom];
        line[0] = Math.min(line[0] ?? rect.left, rect.left);
        line[2] = Math.max(line[2] ?? rect.right, rect.right);
        rects.set(key, line);
      }
    }
    return {
      rects: [...rects.entries()].sort(([left], [right]) => left - right).map(([, line]) => line),
      colors,
    };
  });

function expectSameLines(
  actual: { rects: number[][]; colors: string[] },
  expected: { rects: number[][]; colors: string[] },
  moment: string,
): void {
  expect(actual.colors, moment).toEqual(expected.colors);
  expect(actual.rects.length, `${moment}: lines`).toBe(expected.rects.length);
  actual.rects.forEach((line, index) =>
    line.forEach((value, side) =>
      expect(
        Math.abs(value - (expected.rects[index]?.[side] ?? NaN)),
        `${moment}: line ${index}[${side}]`,
      ).toBeLessThanOrEqual(0.5),
    ),
  );
}

test('morph: insert, remove, move, attribute and text change in the same window, keeping focus and scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const driver = new CanvasDriver(page);
  await driver.start();
  const filler = Array.from({ length: 25 }, (_, index) => `<p>Linha ${index + 1}</p>`).join('');
  await driver.import(
    `<main>${filler}<p id="a">Alfa</p><p id="b">Beta</p><a id="l" href="https://example.test/um" style="display:block">Link</a>${filler}</main>`,
  );
  const a = driver.frame().locator('#a');
  await a.scrollIntoViewIfNeeded();
  const initialLoads = await loads(driver);
  const scroll = await frameScroll(driver);
  expect(scroll).toBeGreaterThan(100);
  await driver.select('Alfa');
  // Insert: duplicating adds a node between existing ones.
  await driver.frame().getByRole('button', { name: 'Duplicar', exact: true }).click();
  await expect(driver.frame().getByText('Alfa', { exact: true })).toHaveCount(2);
  // Remove: undoing takes it away again.
  await undo(page).click();
  await expect(driver.frame().getByText('Alfa', { exact: true })).toHaveCount(1);
  // Move by keyboard: the block which had the focus keeps it after travelling.
  await a.focus();
  await a.press('Alt+ArrowDown');
  await expect(driver.frame().locator('#b + #a')).toHaveCount(1);
  await expect(a).toBeFocused();
  await a.press('Alt+ArrowUp');
  await expect(driver.frame().locator('#a + #b')).toHaveCount(1);
  await expect(a).toBeFocused();
  // Text.
  await a.press('Enter');
  await expect(a).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.insertText('!');
  await a.press('ControlOrMeta+Enter');
  await expect(a).toHaveText('Alfa!');
  // Attribute, through the properties panel.
  await driver.select('Link');
  const destination = page
    .locator('.editor-properties')
    .getByRole('textbox', { name: 'Destino do link', exact: true });
  await destination.fill('https://example.test/dois');
  await destination.press('Enter');
  await expect(driver.frame().locator('#l')).toHaveAttribute('href', 'https://example.test/dois');
  expect(await loads(driver)).toBe(initialLoads);
  expect(Math.abs((await frameScroll(driver)) - scroll)).toBeLessThanOrEqual(1);
});

test('morph: a failed reconciliation falls back to a new window with the right content', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="a">Antes</p></main>');
  const a = driver.frame().locator('#a');
  await a.click();
  await a.press('End');
  await page.keyboard.insertText(' depois');
  await a.press('ControlOrMeta+Enter');
  await expect(a).toHaveText('Antes depois');
  const before = await driver.identity();
  const initialLoads = Number(await loads(driver));
  await a.evaluate(() => {
    DOMParser.prototype.parseFromString = () => {
      throw new Error('BROKEN_PARSER');
    };
  });
  await undo(page).click();
  await expect(driver.frame().locator('#a')).toHaveText('Antes');
  await driver.ready(before);
  expect((await driver.identity()).nonce).not.toBe(before.nonce);
  expect(Number(await loads(driver))).toBe(initialLoads + 1);
  // The new window edits as the first one did.
  await driver.frame().locator('#a').click();
  await expect(driver.editable()).toHaveCount(1);
});

test('structures: nested colors, a boxed span, terminal breaks and source indentation edit faithfully', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(TEXT_PIECE_HTML);
  for (const id of ['piece-nested', 'piece-boxed', 'piece-breaks', 'piece-indented']) {
    const target = driver.frame().locator(`#${id}`);
    await target.scrollIntoViewIfNeeded();
    const before = await lines(target);
    const height = (await target.boundingBox())?.height ?? 0;
    await target.click();
    await expect(target, id).toHaveAttribute('contenteditable', 'true');
    await expect(page.locator('.editor-canvas-surface')).toHaveAttribute('data-text-fidelity', '0');
    expectSameLines(await lines(target), before, `${id} during`);
    expect(Math.abs(((await target.boundingBox())?.height ?? 0) - height), id).toBeLessThanOrEqual(
      0.5,
    );
    await target.press('ControlOrMeta+End');
    await page.keyboard.insertText('!');
    await target.press('ControlOrMeta+Enter');
    await expect(driver.editable()).toHaveCount(0);
    await expect(target).toContainText('!');
    expect(Math.abs(((await target.boundingBox())?.height ?? 0) - height), id).toBeLessThanOrEqual(
      0.5,
    );
  }
  const frame = driver.frame();
  expect(
    ((await frame.locator('#piece-indented').textContent()) ?? '').replace(/\s+/g, ' ').trim(),
  ).toBe('Texto com quebras e indentação do fonte!');
  // The link kept its own color inside the gray span, and the span is still one element.
  await expect(frame.locator('#piece-nested a')).toHaveCSS('color', 'rgb(0, 102, 204)');
  await expect(frame.locator('#piece-nested > span')).toHaveCount(1);
  await expect(frame.locator('#piece-nested > span > a')).toHaveCount(1);
  // The decorated span is still one box around its bold.
  await expect(frame.locator('#piece-boxed > span')).toHaveCount(1);
  await expect(frame.locator('#piece-boxed > span > strong')).toHaveText('negrito');
  await page
    .locator('.editor-mode-switch')
    .getByRole('button', { name: 'HTML', exact: true })
    .click();
  const html = page.getByRole('textbox', { name: 'HTML', exact: true });
  await expect(html).toContainText('Linha 1<br>Linha 2!<br>');
});

test('structures: source spacing at the edges of a block is not a caret position', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="s">\n      Olá\n    </p></main>');
  const target = driver.frame().locator('#s');
  await target.click();
  await target.press('ControlOrMeta+End');
  await page.keyboard.insertText('!');
  await target.press('ControlOrMeta+Home');
  await page.keyboard.insertText('¡');
  await target.press('ControlOrMeta+Enter');
  await expect(driver.editable()).toHaveCount(0);
  expect((await target.textContent())?.trim()).toBe('¡Olá!');
});

test('structures: a text the editor cannot draw faithfully only selects, with a message', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(TEXT_PIECE_HTML);
  const target = driver.frame().locator('#piece-code');
  const before = await target.evaluate((element) => element.outerHTML);
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await expect(target).toHaveAttribute('data-visual-editor-selected', 'true');
  await expect(page.locator('.editor-canvas-error')).toContainText('não pode ser editada');
  await expect(driver.editable()).toHaveCount(0);
  await expect(driver.activeBar()).toHaveCount(0);
  await target.click();
  await target.press('Enter');
  await expect(driver.editable()).toHaveCount(0);
  // Refusing left the element exactly as it was.
  expect(
    (await target.evaluate((element) => element.outerHTML)).replace(
      ' data-visual-editor-selected="true"',
      '',
    ),
  ).toBe(before.replace(' data-visual-editor-selected="true"', ''));
  // Another text of the same piece still opens, and its entry reports fidelity again.
  await driver.frame().locator('#piece-title').click();
  await expect(driver.editable()).toHaveCount(1);
  await expect(page.locator('.editor-canvas-surface')).toHaveAttribute('data-text-fidelity', '0');
});

test('host actions during an edition take the latest keystrokes: save, mode and palette', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="a">Texto</p></main>');
  const a = driver.frame().locator('#a');
  await a.click();
  await a.press('End');
  await page.keyboard.type(' salvo', { delay: 0 });
  await page
    .locator('.editor-toolbar')
    .getByRole('button', { name: 'Salvar', exact: true })
    .click();
  await expect(page.locator('.editor-feedback')).toHaveText('Documento salvo');
  await expect(driver.frame().locator('#a')).toHaveText('Texto salvo');
  await expect(driver.editable()).toHaveCount(0);
  await expect(driver.activeBar()).toHaveCount(0);

  await a.click();
  await a.press('End');
  await page.keyboard.type(' e modo', { delay: 0 });
  await page
    .locator('.editor-mode-switch')
    .getByRole('button', { name: 'HTML', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toContainText(
    'Texto salvo e modo',
  );
  await page
    .locator('.editor-mode-switch')
    .getByRole('button', { name: 'Visual', exact: true })
    .click();
  await driver.ready();

  const again = driver.frame().locator('#a');
  await again.click();
  await again.press('End');
  await page.keyboard.type(' e paleta', { delay: 0 });
  await page
    .locator('.editor-panel-tabs')
    .getByRole('tab', { name: 'Blocos', exact: true })
    .click();
  await page
    .locator('.editor-palette-grid')
    .getByRole('button', { name: 'Texto', exact: true })
    .click();
  await expect(driver.frame().locator('#a')).toHaveText('Texto salvo e modo e paleta');
  await expect(driver.editable()).toHaveCount(0);
});

test('a panel change during an edition confirms the text and leaves no dead bar', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<main><a id="l" href="https://example.test/um" style="display:block">Link</a></main>',
  );
  const link = driver.frame().locator('#l');
  await link.click();
  await expect(driver.activeBar()).toHaveCount(1);
  await link.press('End');
  await page.keyboard.type(' novo', { delay: 0 });
  const destination = page
    .locator('.editor-properties')
    .getByRole('textbox', { name: 'Destino do link', exact: true });
  await destination.fill('https://example.test/dois');
  await destination.press('Enter');
  await expect(driver.frame().locator('#l')).toHaveAttribute('href', 'https://example.test/dois');
  await expect(driver.frame().locator('#l')).toHaveText('Link novo');
  await expect(driver.editable()).toHaveCount(0);
  await expect(driver.activeBar()).toHaveCount(0);
  await expect(driver.bar().getByRole('button', { name: 'Negrito', exact: true })).toBeDisabled();
});

test('host undo during an edition undoes the text first; redo never erases the document redo', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="a">Um</p><p id="b">Dois</p></main>');
  const a = driver.frame().locator('#a');
  const b = driver.frame().locator('#b');
  await a.click();
  await a.press('End');
  await page.keyboard.insertText(' a');
  await a.press('ControlOrMeta+Enter');
  await expect(a).toHaveText('Um a');
  await a.press('ControlOrMeta+z');
  await expect(a).toHaveText('Um');
  const redo = page.getByRole('button', { name: 'Refazer', exact: true });
  await expect(redo).toBeEnabled();
  // A new text is being changed: Ctrl+Y has no local step and must not conclude it.
  await b.click();
  await b.press('End');
  await page.keyboard.insertText(' b');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(b).toHaveText('Dois');
  await page.keyboard.press('ControlOrMeta+y');
  await expect(b).toHaveText('Dois b');
  await page.keyboard.press('ControlOrMeta+y');
  await expect(b).toHaveAttribute('contenteditable', 'true');
  await expect(b).toHaveText('Dois b');
  // The host button undoes the text first, while it has local steps.
  await undo(page).click();
  await expect(b).toHaveText('Dois');
  await expect(b).toHaveAttribute('contenteditable', 'true');
  await b.press('Escape');
  await expect(driver.editable()).toHaveCount(0);
  await redo.click();
  await expect(a).toHaveText('Um a');
});

test('read-only during a changed edition keeps the text on screen and continues afterwards', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="a">Texto</p></main>');
  const a = driver.frame().locator('#a');
  const identity = await driver.identity();
  const initialLoads = await loads(driver);
  await a.click();
  await a.press('End');
  await page.keyboard.type(' alterado', { delay: 0 });
  const setReadOnly = (value: boolean): Promise<void> =>
    page.evaluate((next) => {
      (
        window as unknown as { visualEditorPlayground: { setReadOnly(value: boolean): void } }
      ).visualEditorPlayground.setReadOnly(next);
    }, value);
  await setReadOnly(true);
  await expect(page.locator('.editor-status')).toHaveText('Somente leitura');
  await expect(a).toHaveAttribute('contenteditable', 'false');
  await expect(a).toHaveText('Texto alterado');
  await page.keyboard.type('XYZ', { delay: 0 });
  await a.press('Escape');
  await expect(a).toHaveText('Texto alterado');
  expect((await driver.identity()).revision).toBe(identity.revision);
  await setReadOnly(false);
  await expect(a).toHaveAttribute('contenteditable', 'true');
  await expect(a).toHaveText('Texto alterado');
  // Nothing was saved by surprise: the text is still a draft until the person concludes it.
  expect((await driver.identity()).revision).toBe(identity.revision);
  await a.click();
  await a.press('End');
  await page.keyboard.insertText(' e concluído');
  await a.press('ControlOrMeta+Enter');
  await expect(driver.editable()).toHaveCount(0);
  await expect(a).toHaveText('Texto alterado e concluído');
  await undo(page).click();
  await expect(a).toHaveText('Texto');
  expect(await loads(driver)).toBe(initialLoads);
});

test('keyboard: Alt+F10 reaches the formatting bar and Escape returns to the text', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="a">Texto acessível</p></main>');
  const a = driver.frame().locator('#a');
  await a.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Alt+F10');
  const bold = driver.bar().getByRole('button', { name: 'Negrito', exact: true });
  await expect(bold).toBeFocused();
  await expect(driver.bar()).toHaveAttribute('title', /Alt \+ F10/);
  await page.keyboard.press('Enter');
  await expect(a.locator('strong')).toHaveText('Texto acessível');
  await page.keyboard.press('Escape');
  await expect(a).toHaveAttribute('contenteditable', 'true');
  // The keyboard is back in the text. One engine only lets the frame take it on a key pressed
  // there, so the first key may be spent on that.
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => a.evaluate((element) => document.activeElement === element)).toBe(true);
  await page.keyboard.press('End');
  await page.keyboard.insertText('!');
  await expect(a).toHaveText('Texto acessível!');
});

test('formatting: color and highlight on one stretch, cleared again, and a forged command with the editor mounted', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="c" style="color:#333333">primeira segunda</p></main>');
  const target = driver.frame().locator('#c');
  await target.click();
  await page.keyboard.press('Home');
  for (let index = 0; index < 8; index += 1) await page.keyboard.press('Shift+ArrowRight');
  await driver.bar().getByRole('button', { name: 'Formatação do texto', exact: true }).click();
  const color = driver.bar().locator('input[id$="-color"]');
  await color.fill('#cc0000');
  await color.press('Enter');
  await expect(target.locator('span').first()).toHaveCSS('color', 'rgb(204, 0, 0)');
  await expect(target.locator('span').first()).toHaveText('primeira');
  // The rest of the paragraph keeps the color of the piece.
  await expect(target).toHaveCSS('color', 'rgb(51, 51, 51)');
  const identity = await driver.identity();
  await driver.element().evaluate(
    (element, data) => {
      if (!(element instanceof HTMLIFrameElement) || !element.contentWindow)
        throw new Error('MISSING_FRAME');
      const post = (message: Record<string, unknown>): void =>
        element.contentWindow?.postMessage({ ...data, ...message }, '*');
      post({ type: 'text-command', command: 'eval', value: 'alert(1)' });
      post({ type: 'text-command', command: 'insertHTML', value: '<img src=x onerror=alert(1)>' });
      post({ type: 'text-command', command: 'insertText', value: 'x'.repeat(5_000) });
      post({ type: 'text-command', command: 'bold', nonce: 'a'.repeat(32) });
      post({ type: 'text-command', command: 'bold', revision: data.revision + 1 });
    },
    { nonce: identity.nonce, revision: Number(identity.revision) },
  );
  await page.waitForTimeout(300);
  await expect(target).toHaveText('primeira segunda');
  await expect(target.locator('strong, img')).toHaveCount(0);
  await expect(target).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await driver.bar().getByRole('button', { name: 'Limpar formatação', exact: true }).click();
  await expect(target.locator('span')).toHaveCount(0);
  await target.press('ControlOrMeta+Enter');
  await expect(driver.editable()).toHaveCount(0);
  await expect(target).toHaveText('primeira segunda');
});

test('panel: the selected block shows the values it only inherits from the piece', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(TEXT_PIECE_HTML);
  await driver.select('Segundo item da lista');
  const values = (): Promise<string[]> =>
    page
      .locator('.editor-properties input')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  // The item declares no size of its own: 15 px comes from the list around it.
  await expect
    .poll(async () => (await values()).some((value) => /^15(px)?$/.test(value)))
    .toBe(true);
});
