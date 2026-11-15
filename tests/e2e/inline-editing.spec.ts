import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { TEXT_PIECE_HTML } from '../../playground/text-piece';
import { CanvasDriver } from './canvas-driver';

interface Appearance {
  readonly style: Readonly<Record<string, string>>;
  readonly box: readonly number[];
  readonly lines: readonly (readonly number[])[];
}

/** Computed text appearance and the rectangle of every rendered line of an element. */
const appearance = (target: Locator): Promise<Appearance> =>
  target.evaluate((element) => {
    const computed = getComputedStyle(element);
    const style: Record<string, string> = {};
    for (const property of [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'color',
      'backgroundColor',
      'lineHeight',
      'letterSpacing',
      'wordSpacing',
      'textAlign',
      'textTransform',
      'textDecorationLine',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'marginTop',
      'marginBottom',
    ] as const)
      style[property] = computed[property];
    const lines = new Map<number, number[]>();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width < 0.01) continue;
        const key = Math.round(rect.top * 2);
        const line = lines.get(key);
        if (!line) lines.set(key, [rect.left, rect.top, rect.right, rect.bottom]);
        else {
          line[0] = Math.min(line[0] ?? rect.left, rect.left);
          line[2] = Math.max(line[2] ?? rect.right, rect.right);
          line[3] = Math.max(line[3] ?? rect.bottom, rect.bottom);
        }
      }
    }
    const bounds = element.getBoundingClientRect();
    return {
      style,
      box: [bounds.left, bounds.top, bounds.width, bounds.height],
      lines: [...lines.entries()].sort(([left], [right]) => left - right).map(([, line]) => line),
    };
  });

function expectSameAppearance(actual: Appearance, expected: Appearance, moment: string): void {
  expect(actual.style, moment).toEqual(expected.style);
  expect(actual.lines.length, `${moment}: line count`).toBe(expected.lines.length);
  const close = (left: readonly number[], right: readonly number[], label: string): void => {
    left.forEach((value, index) =>
      expect(Math.abs(value - (right[index] ?? NaN)), `${label}[${index}]`).toBeLessThanOrEqual(
        0.5,
      ),
    );
  };
  close(actual.box, expected.box, `${moment}: box`);
  actual.lines.forEach((line, index) =>
    close(line, expected.lines[index] ?? [], `${moment}: line ${index}`),
  );
}

interface Scroll {
  readonly frame: number;
  readonly page: number;
  readonly container: number;
}

async function scrollOf(driver: CanvasDriver): Promise<Scroll> {
  return {
    frame: await driver
      .frame()
      .locator('body')
      .evaluate(() => scrollY),
    page: await driver.page.evaluate(() => scrollY),
    container: await driver.page
      .locator('.editor-canvas-viewport')
      .evaluate((element) => element.scrollTop + (element.parentElement?.scrollTop ?? 0)),
  };
}

function expectSameScroll(actual: Scroll, expected: Scroll, moment: string): void {
  for (const key of ['frame', 'page', 'container'] as const)
    expect(Math.abs(actual[key] - expected[key]), `${moment}: ${key}`).toBeLessThanOrEqual(1);
}

const status = (page: Page): Locator => page.locator('.editor-status');
const undo = (page: Page): Locator => page.getByRole('button', { name: 'Desfazer', exact: true });

/** Clicks one character of a text node, by its real rectangle inside the frame. */
async function clickCharacter(driver: CanvasDriver, target: Locator, offset: number) {
  const point = await target.evaluate((element, index) => {
    const node = element.firstChild;
    if (!(node instanceof Text)) throw new Error('UNEXPECTED_TEXT_FIXTURE');
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  }, offset);
  const frame = await driver.element().boundingBox();
  if (!frame) throw new Error('MISSING_FRAME');
  await driver.page.mouse.click(frame.x + point.x, frame.y + point.y);
}

test('1 appearance: the piece looks the same before, during and after entering each text', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(TEXT_PIECE_HTML);
  const revision = (await driver.identity()).revision;
  for (const id of [
    'piece-eyebrow',
    'piece-title',
    'piece-text',
    'piece-button',
    'piece-padded',
    'piece-item',
    'piece-nested',
    'piece-boxed',
    'piece-breaks',
    'piece-indented',
  ]) {
    const target = driver.frame().locator(`#${id}`);
    await target.scrollIntoViewIfNeeded();
    const before = await appearance(target);
    expect(before.lines.length, id).toBeGreaterThan(0);
    await target.click();
    // The editable element is the block of the text: the button is edited inside its cell.
    await expect(driver.editable(), id).toHaveCount(1);
    await expect(
      target.locator('xpath=ancestor-or-self::*[@data-visual-editor-node][1]'),
      id,
    ).toHaveAttribute('contenteditable', 'true');
    await expect(driver.activeBar()).toBeVisible();
    expectSameAppearance(await appearance(target), before, `${id} during`);
    await expect(page.locator('.editor-canvas-surface')).toHaveAttribute('data-text-fidelity', '0');
    await driver.editable().press('Escape');
    await expect(driver.editable()).toHaveCount(0);
    expectSameAppearance(await appearance(target), before, `${id} after`);
  }
  // Entering and leaving ten texts without typing created no revision.
  expect((await driver.identity()).revision).toBe(revision);
});

test('1b appearance: an edited loose cell and list item keep their box after the commit', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(TEXT_PIECE_HTML);
  for (const id of ['piece-padded', 'piece-item', 'piece-title']) {
    const target = driver.frame().locator(`#${id}`);
    const before = await appearance(target);
    await target.click();
    await target.press('End');
    await page.keyboard.insertText('!');
    await target.press('ControlOrMeta+Enter');
    await expect(driver.editable()).toHaveCount(0);
    await expect(target).toContainText('!');
    const after = await appearance(target);
    expect(after.style, id).toEqual(before.style);
    expect(
      Math.abs((after.box[3] ?? 0) - (before.box[3] ?? 0)),
      `${id} height`,
    ).toBeLessThanOrEqual(0.5);
    // Loose text stays loose: the commit adds no paragraph around it.
    await expect(target.locator('p')).toHaveCount(0);
  }
});

test('2 caret: one click in the middle of a word puts the caret there', async ({ page }) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<main><p id="caret" style="font:20px/30px monospace">abcdefghij klmnopqrst</p></main>',
  );
  const target = driver.frame().locator('#caret');
  await clickCharacter(driver, target, 5);
  await expect(target).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.insertText('X');
  await expect(target).toHaveText('abcdeXfghij klmnopqrst');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(driver.editable()).toHaveCount(0);
  await expect(target).toHaveText('abcdeXfghij klmnopqrst');
});

test('2b a double click selects the word in the real element', async ({ page }) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="word">primeira segunda terceira</p></main>');
  const target = driver.frame().locator('#word');
  const box = await target.evaluate((element) => {
    const node = element.firstChild;
    if (!(node instanceof Text)) throw new Error('UNEXPECTED_TEXT_FIXTURE');
    const range = document.createRange();
    range.setStart(node, 10);
    range.setEnd(node, 15);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const frame = await driver.element().boundingBox();
  if (!frame) throw new Error('MISSING_FRAME');
  await page.mouse.dblclick(frame.x + box.x, frame.y + box.y);
  await expect(target).toHaveAttribute('contenteditable', 'true');
  await expect.poll(() => target.evaluate(() => getSelection()?.toString().trim())).toBe('segunda');
  await page.keyboard.insertText('trocada');
  // Some platforms select the space after the word together with it.
  await expect(target).toHaveText(/^primeira trocada ?terceira$/);
});

test('3 next click: editing A and clicking B commits A and edits B with one click', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="a">Texto A</p><p id="b">Texto B</p></main>');
  const a = driver.frame().locator('#a');
  const b = driver.frame().locator('#b');
  await a.click();
  await a.press('End');
  await page.keyboard.insertText(' editado');
  await b.click();
  await expect(b).toHaveAttribute('contenteditable', 'true');
  await expect(a).not.toHaveAttribute('contenteditable', 'true');
  await expect(a).toHaveText('Texto A editado');
  await expect(b).toHaveAttribute('data-visual-editor-selected', 'true');
  await expect(driver.activeBar()).toHaveCount(1);
  await page.keyboard.press('End');
  await page.keyboard.insertText(' também');
  await expect(b).toHaveText('Texto B também');
  await expect(a).toHaveText('Texto A editado');
  await page.keyboard.press('Escape');
  await expect(driver.editable()).toHaveCount(0);
  await expect(b).toHaveText('Texto B também');
  // Two commits, two undo steps: A and B were independent editions.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(b).toHaveText('Texto B');
  await expect(a).toHaveText('Texto A editado');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(a).toHaveText('Texto A');
});

test('4 scroll: clicking, typing, formatting, finishing, undoing and redoing never scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const driver = new CanvasDriver(page);
  await driver.start();
  const filler = Array.from(
    { length: 30 },
    (_, index) => `<p>Parágrafo de preenchimento ${index + 1}</p>`,
  ).join('');
  await driver.import(`<main>${filler}<p id="target">Texto no meio da peça</p>${filler}</main>`);
  const target = driver.frame().locator('#target');
  await target.scrollIntoViewIfNeeded();
  await page.locator('.editor-canvas-viewport').scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const initial = await scrollOf(driver);
  expect(initial.frame).toBeGreaterThan(100);
  await clickCharacter(driver, target, 6);
  await expect(target).toHaveAttribute('contenteditable', 'true');
  expectSameScroll(await scrollOf(driver), initial, 'click');
  await page.keyboard.insertText('novo ');
  await expect(target).toHaveText('Texto novo no meio da peça');
  expectSameScroll(await scrollOf(driver), initial, 'typing');
  await page.keyboard.press('ControlOrMeta+a');
  await driver.bar().getByRole('button', { name: 'Negrito', exact: true }).click();
  await expect(target.locator('strong')).toHaveText('Texto novo no meio da peça');
  expectSameScroll(await scrollOf(driver), initial, 'format');
  await target.press('ControlOrMeta+Enter');
  await expect(driver.editable()).toHaveCount(0);
  await expect(target.locator('strong')).toHaveText('Texto novo no meio da peça');
  expectSameScroll(await scrollOf(driver), initial, 'finish');
  await target.press('ControlOrMeta+z');
  await expect(target).toHaveText('Texto no meio da peça');
  await expect(target.locator('strong')).toHaveCount(0);
  expectSameScroll(await scrollOf(driver), initial, 'undo');
  await target.press('ControlOrMeta+y');
  await expect(target.locator('strong')).toHaveText('Texto novo no meio da peça');
  expectSameScroll(await scrollOf(driver), initial, 'redo');
});

test('5 no reload: ten commands keep the same window and never load it again', async ({ page }) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="one">Um</p><p id="two">Dois</p><p id="three">Três</p></main>');
  const loads = await driver.element().getAttribute('data-loads');
  const source = await driver.element().getAttribute('srcdoc');
  const nonce = (await driver.identity()).nonce;
  await driver
    .frame()
    .locator('body')
    .evaluate(() => {
      (window as unknown as { visualEditorProbe: string }).visualEditorProbe = 'same-window';
    });
  const commands: (() => Promise<void>)[] = [];
  for (const [id, suffix] of [
    ['one', ' a'],
    ['two', ' b'],
    ['three', ' c'],
    ['one', ' d'],
  ] as const)
    commands.push(async () => {
      const target = driver.frame().locator(`#${id}`);
      const previous = (await target.textContent()) ?? '';
      await target.click();
      await target.press('End');
      await page.keyboard.insertText(suffix);
      await target.press('ControlOrMeta+Enter');
      await expect(driver.editable()).toHaveCount(0);
      await expect(target).toHaveText(previous + suffix);
    });
  const one = driver.frame().locator('#one');
  commands.push(async () => {
    await one.press('ControlOrMeta+z');
    await expect(one).toHaveText('Um a');
  });
  commands.push(async () => {
    await one.press('ControlOrMeta+y');
    await expect(one).toHaveText('Um a d');
  });
  commands.push(async () => {
    await one.press('Alt+ArrowDown');
    await expect(driver.frame().locator('main > p').first()).toHaveText('Dois b');
  });
  commands.push(async () => {
    await driver.frame().locator('#one').press('Alt+ArrowUp');
    await expect(driver.frame().locator('main > p').first()).toHaveText('Um a d');
  });
  commands.push(async () => {
    await undo(page).click();
    await expect(driver.frame().locator('main > p').first()).toHaveText('Dois b');
  });
  commands.push(async () => {
    await page.getByRole('button', { name: 'Refazer', exact: true }).click();
    await expect(driver.frame().locator('main > p').first()).toHaveText('Um a d');
  });
  expect(commands).toHaveLength(10);
  for (const command of commands) await command();
  expect(await driver.element().getAttribute('data-loads')).toBe(loads);
  expect(await driver.element().getAttribute('srcdoc')).toBe(source);
  expect((await driver.identity()).nonce).toBe(nonce);
  expect(
    await driver
      .frame()
      .locator('body')
      .evaluate(() => (window as unknown as { visualEditorProbe?: string }).visualEditorProbe),
  ).toBe('same-window');
});

test('6 granularity: call, title and paragraph of one cell are three independent editions', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(TEXT_PIECE_HTML);
  const cell = driver.frame().locator('#piece-cell');
  for (const [id, text] of [
    ['piece-eyebrow', 'Nova chamada'],
    ['piece-title', 'Novo título'],
    ['piece-text', 'Novo parágrafo'],
  ] as const) {
    const target = driver.frame().locator(`#${id}`);
    await target.click();
    await expect(driver.editable()).toHaveCount(1);
    await expect(target).toHaveAttribute('contenteditable', 'true');
    await expect(cell).not.toHaveAttribute('contenteditable', 'true');
    await driver.replace(text);
    await expect(target).toHaveText(text);
  }
  await page.keyboard.press('Escape');
  await expect(driver.editable()).toHaveCount(0);
  await expect(cell.locator('#piece-eyebrow')).toHaveText('Nova chamada');
  await expect(cell.locator('#piece-title')).toHaveText('Novo título');
  await expect(cell.locator('#piece-text')).toHaveText('Novo parágrafo');
  // Each element kept its own size and color: nothing was merged into one text.
  await expect(cell.locator('#piece-eyebrow')).toHaveCSS('font-size', '12px');
  await expect(cell.locator('#piece-title')).toHaveCSS('font-size', '32px');
  await expect(cell.locator('#piece-title')).toHaveCSS('font-weight', '700');
  await expect(cell.locator('#piece-text')).toHaveCSS('color', 'rgb(75, 95, 90)');
  for (const expected of [
    'Parágrafo de apoio',
    'Título principal da peça',
    'Chamada da campanha',
  ]) {
    await undo(page).click();
    await expect(cell).toContainText(expected);
  }
});

test('7 formatting: bold and a link on one stretch leave the rest alone, with local then document undo', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(
    '<main><p id="format" style="color:#4b5f5a">primeira <span class="brand" style="color:#b4472e">segunda</span> terceira</p></main>',
  );
  const target = driver.frame().locator('#format');
  await target.click();
  await page.keyboard.press('Home');
  for (let index = 0; index < 8; index += 1) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => target.evaluate(() => getSelection()?.toString())).toBe('primeira');
  await driver.bar().getByRole('button', { name: 'Negrito', exact: true }).click();
  await expect(target.locator('strong')).toHaveText('primeira');
  await expect(target.locator('span.brand')).toHaveText('segunda');
  await expect(target.locator('span.brand')).toHaveCSS('color', 'rgb(180, 71, 46)');
  // The local history groups changes made within half a second into one step.
  await page.waitForTimeout(700);
  const link = driver.bar().getByRole('button', { name: 'Link', exact: true });
  await link.click();
  const destination = driver.bar().getByRole('textbox', { name: 'Destino do link', exact: true });
  await destination.fill('javascript:alert(1)');
  await driver.bar().getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
  await expect(target.locator('a')).toHaveCount(0);
  await destination.fill('https://example.test/destino');
  await driver.bar().getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
  await expect(target.locator('a')).toHaveText('primeira');
  await expect(target.locator('a')).toHaveAttribute('href', 'https://example.test/destino');
  await expect(target).toHaveText('primeira segunda terceira');
  // Local history first: the link leaves, the bold stays.
  await target.click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(target.locator('a')).toHaveCount(0);
  await expect(target.locator('strong')).toHaveText('primeira');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(driver.editable()).toHaveCount(0);
  await expect(target.locator('strong')).toHaveText('primeira');
  await expect(target.locator('span.brand')).toHaveText('segunda');
  await expect(target.locator('span.brand')).toHaveCSS('color', 'rgb(180, 71, 46)');
  // Then the document history: one step returns the whole edition.
  await target.press('ControlOrMeta+z');
  await expect(target.locator('strong')).toHaveCount(0);
  await expect(target).toHaveText('primeira segunda terceira');
});

test('8 variables: inserted at the caret, and refused when no text is being edited', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="variable">Olá , tudo bem?</p></main>');
  const target = driver.frame().locator('#variable');
  const picker = driver.bar().getByRole('button', { name: 'Inserir variável', exact: true });
  const hint = driver.bar().getByText('Clique em um texto da peça e posicione o cursor', {
    exact: false,
  });
  // Without an edition the strip is there, reserved; the variables explain what to do first.
  await expect(driver.activeBar()).toHaveCount(0);
  await expect(driver.bar().getByRole('button', { name: 'Negrito', exact: true })).toBeDisabled();
  await picker.click();
  await expect(hint).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Nome de exemplo/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(hint).toBeHidden();
  await clickCharacter(driver, target, 4);
  await expect(target).toHaveAttribute('contenteditable', 'true');
  await picker.click();
  // A menu with search and groups, each variable with its label and its key.
  await expect(page.getByRole('menu').getByText('Contato', { exact: true })).toBeVisible();
  await page.getByRole('menu').locator('input').fill('sobren');
  await expect(page.getByRole('menuitem', { name: /Nome de exemplo/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Sobrenome de exemplo/ })).toContainText(
    '{{contact.lastName}}',
  );
  await page.getByRole('menu').locator('input').fill('nome de');
  await page.getByRole('menuitem', { name: /^Nome de exemplo/ }).click();
  await expect(target).toHaveText('Olá {{contact.firstName}}, tudo bem?');
  await target.press('ControlOrMeta+Enter');
  await expect(driver.editable()).toHaveCount(0);
  await expect(target).toHaveText('Olá {{contact.firstName}}, tudo bem?');
  await expect(driver.activeBar()).toHaveCount(0);
  await picker.click();
  await expect(hint).toBeVisible();
});

test('9 paste: Word markup enters as text and allowed marks only', async ({
  page,
  browserName,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="paste">Início:</p></main>');
  const target = driver.frame().locator('#paste');
  await target.click();
  await target.press('End');
  const word =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0cm;font-family:Calibri}</style></head><body><!--StartFragment--><p class="MsoNormal" style="margin:0cm;font-size:11pt;font-family:Calibri,sans-serif"><b><span style="color:red;mso-fareast-language:PT-BR">Negrito</span></b><span style="font-size:20pt"> e <i>itálico</i></span><o:p></o:p></p><script>window.pasted = true</script><img src="x" onerror="window.pasted = true"><!--EndFragment--></body></html>';
  if (browserName === 'webkit') {
    // This engine has no keyboard clipboard when headless; its paste event accepts the data.
    await target.evaluate((element, html) => {
      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData('text/plain', 'Negrito e itálico');
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, word);
  } else {
    // A real copy and a real paste: the host page answers the copy with the Word fragment.
    await page.evaluate((html) => {
      document.addEventListener(
        'copy',
        (event) => {
          event.clipboardData?.setData('text/html', html);
          event.clipboardData?.setData('text/plain', 'Negrito e itálico');
          event.preventDefault();
        },
        { once: true },
      );
    }, word);
    await page.locator('.editor-status').dblclick();
    await page.keyboard.press('ControlOrMeta+c');
    await target.click();
    await target.press('End');
    await page.keyboard.press('ControlOrMeta+v');
  }
  await expect(target).toHaveText('Início:Negrito e itálico');
  const during = await target.evaluate((element) => element.innerHTML);
  for (const forbidden of [
    'Mso',
    'Calibri',
    'color',
    'font-size',
    'o:p',
    'script',
    '<img',
    'onerror',
  ])
    expect(during, forbidden).not.toContain(forbidden);
  await expect(target.locator('strong, b')).toHaveText('Negrito');
  await expect(target.locator('em, i')).toHaveText('itálico');
  await target.press('ControlOrMeta+Enter');
  await expect(driver.editable()).toHaveCount(0);
  await expect(target).toHaveText('Início:Negrito e itálico');
  await expect(target.locator('strong')).toHaveText('Negrito');
  expect(
    await driver
      .frame()
      .locator('body')
      .evaluate(() => 'pasted' in window),
  ).toBe(false);
  await page
    .locator('.editor-mode-switch')
    .getByRole('button', { name: 'HTML', exact: true })
    .click();
  const html = page.getByRole('textbox', { name: 'HTML', exact: true });
  await expect(html).toContainText('<strong>Negrito</strong>');
  await expect(html).not.toContainText('Mso');
  await expect(html).not.toContainText('Calibri');
});

test('10 security: forged messages are refused and a hostile draft never reaches the host DOM', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import('<main><p id="secure">Texto protegido</p></main>');
  await expect(driver.element()).toHaveAttribute('sandbox', 'allow-scripts');
  const target = driver.frame().locator('#secure');
  const identity = await driver.identity();
  const nodeId = (await target.getAttribute('data-visual-editor-node')) ?? '';
  expect(nodeId).not.toBe('');
  const forge = (message: Record<string, unknown>): Promise<void> =>
    target.evaluate((_element, data) => parent.postMessage(data, '*'), message);
  const envelope = { nonce: identity.nonce, revision: Number(identity.revision), nodeId };
  await forge({
    ...envelope,
    type: 'text-commit',
    nonce: 'f'.repeat(32),
    sequence: 900,
    html: '<p>Forjado</p>',
  });
  await forge({
    ...envelope,
    type: 'text-commit',
    revision: envelope.revision - 1,
    sequence: 901,
    html: '<p>Forjado</p>',
  });
  await forge({ ...envelope, type: 'text-commit', sequence: 902, html: 'x'.repeat(2_000_001) });
  await forge({
    ...envelope,
    type: 'text-commit',
    sequence: 903,
    html: '<p>Forjado</p>',
    extra: 1,
  });
  await forge({ ...envelope, type: 'edit', sequence: 904 });
  // From the page to the frame: a command outside the closed list, and one with a stale nonce.
  await driver.element().evaluate((element, data) => {
    if (!(element instanceof HTMLIFrameElement) || !element.contentWindow)
      throw new Error('MISSING_FRAME');
    element.contentWindow.postMessage({ ...data, type: 'text-open', nonce: 'a'.repeat(32) }, '*');
    element.contentWindow.postMessage(
      { ...data, type: 'text-command', command: 'eval', value: 'alert(1)' },
      '*',
    );
    element.contentWindow.postMessage(
      {
        ...data,
        type: 'document',
        nonce: 'a'.repeat(32),
        html: '<p>Forjado</p>',
        regions: [],
        readOnly: false,
      },
      '*',
    );
  }, envelope);
  await page.waitForTimeout(300);
  await expect(target).toHaveText('Texto protegido');
  await expect(driver.editable()).toHaveCount(0);
  expect((await driver.identity()).revision).toBe(identity.revision);
  await expect(page.locator('.editor-recovery-banner')).toHaveCount(0);
  // Without an edition opened for the node, even a well formed draft is not accepted.
  await forge({ ...envelope, type: 'text-draft', sequence: 905, html: '<p>Forjado</p>' });
  await page.waitForTimeout(200);
  await expect(page.locator('.editor-recovery-banner')).toHaveCount(0);
  expect((await driver.identity()).revision).toBe(identity.revision);
  // With the edition open, a correctly enveloped draft with active content reaches the
  // session, which parses and refuses it.
  await target.click();
  await expect(driver.editable()).toHaveCount(1);
  await forge({
    ...envelope,
    type: 'text-draft',
    sequence: 5_000,
    html: '<p>Texto <img src="x" onerror="top.hostile = 1"><script>top.hostile = 1</script></p>',
  });
  await expect(page.locator('.editor-recovery-banner')).toBeVisible();
  expect(await page.evaluate(() => 'hostile' in window)).toBe(false);
  expect(await page.locator('.visual-editor script, .visual-editor img[onerror]').count()).toBe(0);
  await expect(target).toHaveText('Texto protegido');
  await expect(driver.element()).toHaveAttribute('sandbox', 'allow-scripts');
});

test('11 readonly: no text editor is ever mounted', async ({ page }) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'Somente leitura', exact: true })
    .click();
  await expect(status(page)).toHaveText('Somente leitura');
  await driver.ready();
  const heading = driver
    .frame()
    .getByRole('heading', { name: 'Uma ideia para o seu próximo passo' });
  await heading.click();
  await heading.dblclick();
  await heading.press('Enter');
  await heading.press('F2');
  const identity = await driver.identity();
  const nodeId = (await heading.getAttribute('data-visual-editor-node')) ?? '';
  await driver.element().evaluate(
    (element, data) => {
      if (!(element instanceof HTMLIFrameElement) || !element.contentWindow)
        throw new Error('MISSING_FRAME');
      element.contentWindow.postMessage({ ...data, type: 'text-open' }, '*');
    },
    { nonce: identity.nonce, revision: Number(identity.revision), nodeId },
  );
  await page.waitForTimeout(300);
  await expect(driver.frame().locator('[contenteditable]')).toHaveCount(0);
  await expect(driver.frame().locator('.ProseMirror')).toHaveCount(0);
  await expect(driver.activeBar()).toHaveCount(0);
  await expect(driver.bar().getByRole('button', { name: 'Negrito', exact: true })).toBeDisabled();
  await expect(heading).toHaveAttribute('data-visual-editor-selected', 'true');
});

test('12 drag: dragging an image and a link moves the block instead of a native drag', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  const pixel = 'https://example.test/inline-drag.svg';
  await page.route(pixel, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="teal"/></svg>',
    }),
  );
  await driver.import(
    `<main><p id="first">Primeiro</p><img id="image" src="${pixel}" alt="Imagem de teste" width="120" height="60" style="display:block"/><p id="middle">Meio</p><a id="link" href="https://example.test/" style="display:block;padding:10px">Link em bloco</a><p id="last">Último</p></main>`,
  );
  const order = (): Promise<string[]> =>
    driver
      .frame()
      .locator('main > *')
      .evaluateAll((elements) => elements.map((element) => element.id));
  expect(await order()).toEqual(['first', 'image', 'middle', 'link', 'last']);
  const dragTo = async (source: string, target: string): Promise<void> => {
    const from = await driver.frame().locator(`#${source}`).boundingBox();
    const to = await driver.frame().locator(`#${target}`).boundingBox();
    if (!from || !to) throw new Error('MISSING_DRAG_TARGET');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, {
      steps: 4,
    });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.8, { steps: 15 });
    await page.mouse.up();
  };
  const moved = await driver.identity();
  await dragTo('image', 'middle');
  await expect.poll(order).toEqual(['first', 'middle', 'image', 'link', 'last']);
  // The next gesture starts on the revision the frame has acknowledged.
  await driver.ready(moved);
  await expect(driver.frame().locator('#image')).toHaveAttribute(
    'data-visual-editor-selected',
    'true',
  );
  await dragTo('link', 'first');
  await expect.poll(order).toEqual(['first', 'link', 'middle', 'image', 'last']);
  // A drag is not a click: the link was moved without opening its text.
  await expect(driver.editable()).toHaveCount(0);
});
