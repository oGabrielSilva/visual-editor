import { expect, test } from '@playwright/test';
import type { FrameLocator, Page } from '@playwright/test';
import { start } from './shell-support';

/** Two sections, so a block can leave one and enter the other. */
const SECTIONS = [
  '<main>',
  '<section id="first" style="padding:24px"><h1 id="title">Título da página</h1><p id="lead">Primeiro parágrafo</p><p id="tail">Segundo parágrafo</p></section>',
  '<section id="second" style="padding:24px"><p id="inner">Texto da segunda seção</p></section>',
  '</main>',
].join('');

/** The text of the block the piece shows as selected. */
const selectedText = (frame: FrameLocator) =>
  frame.locator('[data-visual-editor-selected="true"]').first().innerText();

/** The block which holds the keyboard inside the frame, when the frame holds it in the page. */
const focusedBlock = async (page: Page, frame: FrameLocator): Promise<string> => {
  if ((await page.evaluate(() => document.activeElement?.tagName)) !== 'IFRAME') return '';
  return frame
    .locator('body')
    .evaluate(
      () =>
        (
          document.activeElement?.closest('[data-visual-editor-node]') as HTMLElement | null
        )?.innerText.trim() ?? '',
    );
};

/** Moves the keyboard down the open menu until the item named `name` holds it. */
const reachItem = async (page: Page, name: string): Promise<void> => {
  for (let step = 0; step < 12; step++) {
    const current = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (current.startsWith(name)) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`MENU_ITEM_NOT_REACHED:${name}`);
};

/** The id attribute of the element which holds `id` in the piece. */
const holder = (frame: FrameLocator, id: string) =>
  frame
    .locator(`#${id}`)
    .evaluate((element) => element.parentElement?.id ?? '')
    // The window may be written again after a revision (the fallback of a failed morph): asked
    // again on the next poll.
    .catch(() => '#unavailable');

/** Where the page and the piece are scrolled, to prove a key moved neither by itself. */
const scrolls = async (page: Page, frame: FrameLocator) => ({
  page: await page.evaluate(() => window.scrollY),
  piece: await frame.locator('body').evaluate(() => window.scrollY),
});

/** The ids of the elements of the piece, in their order: the document as the frame shows it. */
const layout = (frame: FrameLocator) =>
  frame.locator('main').evaluate((main) => [...main.querySelectorAll('[id]')].map((e) => e.id));

test('arrows walk the blocks of the piece without scrolling the page by themselves', async ({
  page,
}) => {
  const { driver, frame } = await start(page, SECTIONS);
  await driver.select('Primeiro parágrafo');
  await expect.poll(() => selectedText(frame)).toBe('Primeiro parágrafo');
  const before = await scrolls(page, frame);
  const document = await layout(frame);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedText(frame)).toBe('Segundo parágrafo');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => selectedText(frame)).toBe('Primeiro parágrafo');
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => frame.locator('[data-visual-editor-selected="true"]').first().getAttribute('id'))
    .toBe('first');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => selectedText(frame)).toBe('Título da página');
  // At the end of a section the next block outside it follows: the second section.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedText(frame)).toBe('Segundo parágrafo');
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => frame.locator('[data-visual-editor-selected="true"]').first().getAttribute('id'))
    .toBe('second');
  expect(await scrolls(page, frame)).toEqual(before);
  // Nothing changed in the document: arrows only select.
  expect(await layout(frame)).toEqual(document);
});

test('arrows stay with the text while it is being edited', async ({ page }) => {
  const { driver, frame } = await start(page, SECTIONS);
  const editable = await driver.edit('Primeiro parágrafo');
  await editable.press('Home');
  await editable.press('ArrowRight');
  await editable.press('ArrowDown');
  await page.keyboard.type('X');
  await expect(editable).toContainText('X');
  await expect(driver.editable()).toHaveCount(1);
  await expect.poll(() => selectedText(frame)).toContain('X');
});

test('Alt and the arrows leave a container at its edges and enter the next one', async ({
  page,
}) => {
  const { driver, frame, shell } = await start(page, SECTIONS);
  await driver.select('Segundo parágrafo');
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => holder(frame, 'tail')).toBe('');
  await expect
    .poll(() =>
      frame.locator('main').evaluate((main) => [...main.children].map((child) => child.id)),
    )
    .toEqual(['first', 'tail', 'second']);
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => holder(frame, 'tail')).toBe('second');
  await expect
    .poll(() =>
      frame.locator('#second').evaluate((section) => [...section.children].map((c) => c.id)),
    )
    .toEqual(['tail', 'inner']);
  // Each step is one step of undo.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => holder(frame, 'tail')).toBe('');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => holder(frame, 'tail')).toBe('first');
  await expect(shell.feedback()).toBeVisible();
});

test('the menu key opens the menu of the selected block and Escape gives the keyboard back', async ({
  page,
}) => {
  const { driver, frame } = await start(page, SECTIONS);
  await driver.select('Primeiro parágrafo');
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Ações do bloco' });
  await expect(menu).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('role')))
    .toBe('menuitem');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''))
    .toContain('Editar texto');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
  await expect
    .poll(() =>
      frame
        .locator('#lead')
        .evaluate(
          (element) => document.activeElement === element.closest('[data-visual-editor-node]'),
        ),
    )
    .toBe(true);
  // The keyboard is back on the block: the arrows walk again.
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedText(frame)).toBe('Segundo parágrafo');
  // The other key which asks for the menu does the same; the piece may ask for a menu again a
  // second after one was dismissed (see the compromised frame below).
  await page.waitForTimeout(1_100);
  await page.keyboard.press('ContextMenu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('a block is inserted before, after or inside the selected one with the keyboard only', async ({
  page,
}) => {
  const { driver, frame } = await start(page, SECTIONS);
  await driver.select('Primeiro parágrafo');
  // Alt + Enter: the picker of the "+" opens next to the block, its search field takes the keys.
  await page.keyboard.press('Alt+Enter');
  const picker = page.getByRole('menu', { name: 'Adicionar bloco' });
  await expect(picker).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
  await page.keyboard.type('Divisor');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect
    .poll(() =>
      frame.locator('#first').evaluate((section) => [...section.children].map((c) => c.tagName)),
    )
    .toEqual(['H1', 'P', 'HR', 'P']);
  // The keyboard continues in the piece, on the block the new one was added next to.
  await expect.poll(() => focusedBlock(page, frame)).toBe('Primeiro parágrafo');

  // Before: through the menu of the block, whose picker starts on that side.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedText(frame)).toBe('Segundo parágrafo');
  await page.keyboard.press('Shift+F10');
  await reachItem(page, 'Inserir antes');
  await page.keyboard.press('Enter');
  await expect(picker).toBeVisible();
  // One choice among three, announced as such.
  const before = picker.getByRole('menuitemcheckbox', { name: 'Inserir antes' });
  await expect(before).toHaveAttribute('aria-checked', 'true');
  await expect(picker.getByRole('menuitemcheckbox', { name: 'Inserir depois' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
  await page.keyboard.type('Espaçamento');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      frame
        .locator('#tail')
        .evaluate((element) => element.previousElementSibling?.getAttribute('style') ?? ''),
    )
    .toContain('height:24px');
  await expect.poll(() => focusedBlock(page, frame)).toBe('Segundo parágrafo');

  // Removing through the menu: after the confirmation the block before it holds the keyboard.
  await page.keyboard.press('Shift+F10');
  await reachItem(page, 'Remover');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Remover este bloco?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(frame.getByText('Segundo parágrafo', { exact: true })).toHaveCount(0);
  // The block before it (the spacer just inserted) is selected and holds the keyboard.
  const selectedStyle = () =>
    frame.locator('[data-visual-editor-selected="true"]').first().getAttribute('style');
  await expect.poll(selectedStyle).toContain('height:24px');
  await expect
    .poll(async () =>
      (await page.evaluate(() => document.activeElement?.tagName)) === 'IFRAME'
        ? frame
            .locator('body')
            .evaluate(
              () => document.activeElement?.getAttribute('data-visual-editor-selected') === 'true',
            )
        : false,
    )
    .toBe(true);
});

test('Shift, Alt and the arrows resize the selected image in one step of undo', async ({
  page,
}) => {
  const { frame } = await start(page);
  const image = frame.getByRole('img', { name: 'Foto de exemplo' });
  await image.click();
  await expect(image).toHaveAttribute('data-visual-editor-selected', 'true');
  const width = await image.evaluate((element) => element.getBoundingClientRect().width);
  for (let step = 0; step < 3; step++) await page.keyboard.press('Shift+Alt+ArrowLeft');
  await expect
    .poll(() => image.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBe(Math.round(width) - 30);
  // The three keys are one change: one revision, one undo.
  await expect
    .poll(() => image.evaluate((element) => element.getAttribute('width')))
    .toBe(String(Math.round(width) - 30));
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(() => image.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBe(Math.round(width));
  await expect
    .poll(() => image.evaluate((element) => element.getAttribute('width')))
    .toBe(String(Math.round(width)));
  // The grip which takes the keyboard has a name which says how.
  await expect(
    frame.getByRole('button', { name: /^Redimensionar imagem\. Use as setas/ }),
  ).toHaveCount(1);
});

test('arrows skip hidden blocks and scroll a long piece only as far as needed', async ({
  page,
}) => {
  const rows = Array.from(
    { length: 30 },
    (_, index) => `<p id="row-${index + 1}" style="margin:0;padding:14px">Linha ${index + 1}</p>`,
  ).join('');
  const html = [
    '<main>',
    '<p id="head" style="margin:0;padding:14px">Início</p>',
    '<p style="display:none">Escondido por display</p>',
    '<p style="visibility:hidden;margin:0">Escondido por visibilidade</p>',
    '<details><summary>Resumo</summary><p>Dentro de detalhes fechados</p></details>',
    `<section>${rows}</section>`,
    '</main>',
  ].join('');
  const { driver, frame } = await start(page, html);
  await driver.select('Início');
  const pageScroll = await page.evaluate(() => window.scrollY);
  const pieceScroll = () => frame.locator('body').evaluate(() => window.scrollY);
  // Down from the first block: the hidden ones are passed; the closed details (its summary is
  // visible) is reached, never the text folded inside it.
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedText(frame)).toBe('Resumo');
  await expect.poll(() => focusedBlock(page, frame)).toBe('Resumo');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  await expect.poll(() => selectedText(frame)).toBe('Resumo');
  // Nothing scrolled while the blocks reached were already in view.
  expect(await pieceScroll()).toBe(0);
  // Into the rows, then to the last one: the piece follows, the page does not.
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() =>
      frame
        .locator('[data-visual-editor-selected="true"]')
        .first()
        .evaluate((e) => e.tagName),
    )
    .toBe('SECTION');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => selectedText(frame)).toBe('Linha 1');
  for (let step = 0; step < 29; step++) await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedText(frame)).toBe('Linha 30');
  const bottom = await pieceScroll();
  expect(bottom).toBeGreaterThan(0);
  const last = frame.locator('#row-30');
  const box = await last.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: innerHeight };
  });
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(box.height);
  // At the end of the piece another arrow changes nothing and scrolls nothing.
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedText(frame)).toBe('Linha 30');
  expect(await pieceScroll()).toBe(bottom);
  // Back up past the hidden blocks to the first one.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => selectedText(frame)).toBe('Resumo');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => selectedText(frame)).toBe('Início');
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
});

test('Escape drops resize keys not yet sent, and Tab reaches the resize grip', async ({ page }) => {
  const { frame } = await start(page);
  const image = frame.getByRole('img', { name: 'Foto de exemplo' });
  await image.click();
  await expect(image).toHaveAttribute('data-visual-editor-selected', 'true');
  await page.keyboard.press('Shift+Alt+ArrowRight');
  await expect
    .poll(() => image.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBe(410);
  await page.keyboard.press('Escape');
  await expect
    .poll(() => image.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBe(400);
  await page.waitForTimeout(700);
  // Nothing was sent: the document keeps its size and the image stays selected.
  await expect(image).toHaveAttribute('width', '400');
  await expect(image).toHaveAttribute('data-visual-editor-selected', 'true');
  // Tab from the image: its grip, whose name says the keys; the arrows change the width there.
  await page.keyboard.press('Tab');
  await expect
    .poll(() =>
      frame
        .locator('body')
        .evaluate(
          () => document.activeElement?.shadowRoot?.activeElement?.getAttribute('aria-label') ?? '',
        ),
    )
    .toMatch(/^Redimensionar imagem\. Use as setas/);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(image).toHaveAttribute('width', '390');
});

test('resize keys reach the document when the selection or a save follows at once', async ({
  page,
}) => {
  const { driver, frame } = await start(page);
  const image = frame.getByRole('img', { name: 'Foto de exemplo' });
  await image.click();
  await expect(image).toHaveAttribute('data-visual-editor-selected', 'true');
  await page.keyboard.press('Shift+Alt+ArrowLeft');
  // Another block is clicked well inside the pause after which the size would be sent.
  await frame.getByText('Primeiro parágrafo', { exact: true }).click();
  await expect(image).toHaveAttribute('width', '390');
  // Selected again by the keyboard and saved right after a key.
  await page.keyboard.press('Escape');
  await image.click();
  await expect(image).toHaveAttribute('data-visual-editor-selected', 'true');
  await page.keyboard.press('Shift+Alt+ArrowLeft');
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForTimeout(500);
  // What was saved already has the size of the last key.
  const previous = await driver.identity();
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'Reabrir documento salvo', exact: true })
    .click();
  await driver.ready(previous);
  await expect(frame.getByRole('img', { name: 'Foto de exemplo' })).toHaveAttribute('width', '380');
});

/**
 * A frame which lost its runtime to a hostile page (the threat the protocol is built against)
 * holding its secret: what it asks for a menu or the picker must not take the keyboard from the
 * shell nor hold the shell in a loop of menus.
 */
test('a compromised frame cannot take the keyboard with menus or the picker', async ({ page }) => {
  const { driver, frame } = await start(page, SECTIONS);
  await page.evaluate(() => {
    const host = window as unknown as { lastFrame: { sequence: number; revision: number } };
    host.lastFrame = { sequence: 0, revision: 0 };
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      const data = event.data as { sequence?: unknown; revision?: unknown } | null;
      if (data && typeof data.sequence === 'number' && typeof data.revision === 'number')
        host.lastFrame = {
          sequence: Math.max(host.lastFrame.sequence, data.sequence),
          revision: data.revision,
        };
    });
  });
  await driver.select('Primeiro parágrafo');
  const selectedId = await frame
    .locator('[data-visual-editor-selected="true"]')
    .first()
    .getAttribute('data-visual-editor-node');
  const forge = async (type: 'context-menu' | 'insert-request', count = 1): Promise<void> => {
    const last = await page.evaluate(
      () => (window as unknown as { lastFrame: { sequence: number; revision: number } }).lastFrame,
    );
    await frame.locator('body').evaluate(
      (_body, values) => {
        const script = [...document.scripts].map((entry) => entry.textContent ?? '').join('');
        const nonce = /"nonce":"([^"]+)"/.exec(script)?.[1];
        for (let index = 1; index <= values.count; index++)
          parent.postMessage(
            {
              type: values.type,
              nonce,
              revision: values.revision,
              sequence: values.sequence + index,
              nodeId: values.nodeId,
              ...(values.type === 'context-menu'
                ? { x: 5, y: 5 }
                : { bounds: { x: 1, y: 1, width: 10, height: 10 } }),
              keyboard: true,
            },
            '*',
          );
      },
      { type, count, nodeId: selectedId, ...last },
    );
    await page.evaluate(() => {
      const host = window as unknown as { lastFrame: { sequence: number } };
      host.lastFrame.sequence += 100;
    });
  };
  const menu = page.getByRole('menu', { name: 'Ações do bloco' });
  const picker = page.getByRole('menu', { name: 'Adicionar bloco' });
  // A menu dismissed with Escape is not reopened by the frame at once, even with the keyboard
  // back in the frame and the block selected. (Forged requests move the sequence of the
  // channel past the runtime's own, so they come last in this proof.)
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => focusedBlock(page, frame)).toBe('Primeiro parágrafo');
  await forge('context-menu', 20);
  await page.waitForTimeout(300);
  await expect(menu).toHaveCount(0);
  await expect.poll(() => focusedBlock(page, frame)).toBe('Primeiro parágrafo');
  // The person types in a field of the shell: requests of the frame are not shown.
  await page.waitForTimeout(1_100);
  const search = page.locator('.editor-palette').getByRole('searchbox').first();
  await search.focus();
  await page.keyboard.type('Tex');
  await forge('context-menu', 20);
  await forge('insert-request', 5);
  await page.waitForTimeout(400);
  await expect(menu).toHaveCount(0);
  await expect(picker).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Tex');
});
