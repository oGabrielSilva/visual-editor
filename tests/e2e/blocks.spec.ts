import { expect, test } from '@playwright/test';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { CanvasDriver } from './canvas-driver';

/**
 * Block pieces (schema 2) in the playground (`?schema=2`): a page and an e-mail built from
 * blocks, with the text edited in place, an image chosen and swapped from the host library, a
 * field of the panel, a global style, undo and redo, saving and reopening. The e-mail is
 * compiled by the browser compiler (`mjml-browser` in a worker) for the frame and for the save.
 */
type Kind = 'page' | 'email';

interface BlocksWindow {
  visualEditorBlocks: {
    snapshot(): { revision: number; styles: Record<string, Record<string, string>> };
    saved(kind: Kind): { revision: number } | undefined;
    output(kind: Kind): { html: string; css: string } | undefined;
  };
}

const control = (page: Page, name: string): Locator =>
  page.locator('.playground-controls').getByRole('button', { name, exact: true });
const palette = (page: Page, type: string): Locator =>
  page.locator(`[data-block-palette-type="${type}"]`);
const panel = (page: Page): Locator => page.locator('.editor-properties');
const feedback = (page: Page): Locator => page.locator('.editor-feedback');

/** Waits until the frame shows `revision` or later of the session. */
async function shows(page: Page, driver: CanvasDriver): Promise<void> {
  const revision = Number(await page.locator('.visual-editor').getAttribute('data-block-revision'));
  await expect
    .poll(async () =>
      Number(
        await page.locator('.editor-canvas-surface').getAttribute('data-block-preview-revision'),
      ),
    )
    .toBeGreaterThanOrEqual(revision);
  await expect(driver.frame().locator('[data-visual-editor-controls]')).toHaveCount(1);
}

async function open(page: Page, kind: Kind): Promise<CanvasDriver> {
  const driver = new CanvasDriver(page);
  await driver.observe();
  await page.goto('/?schema=2');
  await driver.ready();
  if (kind === 'email') {
    const before = await driver.identity();
    await control(page, 'E-mail').click();
    await driver.ready(before);
  }
  await expect(driver.frame().getByText('Escreva seu conteúdo.', { exact: true })).toBeVisible();
  return driver;
}

/** The background the output gives the button, in whichever way its kind writes it. */
async function buttonBackground(frame: FrameLocator, label: string): Promise<string> {
  return frame
    .getByText(label, { exact: true })
    .first()
    .evaluate((element) => {
      const link = element.closest('a') ?? element;
      const own = getComputedStyle(link).backgroundColor;
      const cell = link.closest('td');
      return own !== 'rgba(0, 0, 0, 0)' || !cell ? own : getComputedStyle(cell).backgroundColor;
    });
}

async function chooseImage(page: Page, alt: string): Promise<void> {
  await panel(page).getByRole('button', { name: 'Escolher imagem' }).click();
  await page.getByRole('dialog').getByRole('button', { name: alt }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

for (const kind of ['page', 'email'] as const)
  test(`a ${kind} made of blocks: edit, image, field, global style, history, save and reopen`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const driver = await open(page, kind);
    const frame = driver.frame();

    // Blocks from the palette: each one goes after the selection.
    await palette(page, 'heading').click();
    await shows(page, driver);
    await expect(frame.getByText('Escreva seu título', { exact: true })).toBeVisible();
    await palette(page, 'button').click();
    await shows(page, driver);
    await expect(frame.getByText('Saiba mais', { exact: true })).toBeVisible();

    // The text of the heading, edited in its own element inside the frame.
    await driver.edit('Escreva seu título');
    await driver.replace('Título da peça');
    await driver.finish();
    await shows(page, driver);
    await expect(frame.getByText('Título da peça', { exact: true })).toBeVisible();

    // An image from the host library, then another one: each choice is one step.
    await palette(page, 'image').click();
    await shows(page, driver);
    await chooseImage(page, 'Paisagem em tons de verde');
    await shows(page, driver);
    await expect(frame.locator('img[src$="aurora.svg"]')).toHaveCount(1);
    await chooseImage(page, 'Formas em tons de coral');
    await shows(page, driver);
    await expect(frame.locator('img[src$="coral.svg"]')).toHaveAttribute(
      'alt',
      'Formas em tons de coral',
    );
    await expect(frame.locator('img[src$="aurora.svg"]')).toHaveCount(0);

    // A field of the panel generated from the definition of the block.
    const alt = panel(page).locator('[data-block-field="alt"] input');
    await alt.fill('Descrição escrita no painel');
    await alt.press('Enter');
    await shows(page, driver);
    await expect(frame.locator('img[src$="coral.svg"]')).toHaveAttribute(
      'alt',
      'Descrição escrita no painel',
    );

    // A global style of the piece: the background of every button.
    const before = await buttonBackground(frame, 'Saiba mais');
    await panel(page).getByRole('button', { name: 'Estilos globais' }).click();
    await panel(page).getByRole('button', { name: 'Botões' }).click();
    const background = panel(page).locator('[data-block-style="button.background"] input').last();
    await background.fill('#aa0000');
    await background.press('Enter');
    await shows(page, driver);
    await expect.poll(() => buttonBackground(frame, 'Saiba mais')).toBe('rgb(170, 0, 0)');

    // Undo takes the style back; redo puts it again.
    await page.getByRole('button', { name: 'Desfazer' }).click();
    await shows(page, driver);
    await expect.poll(() => buttonBackground(frame, 'Saiba mais')).toBe(before);
    await page.getByRole('button', { name: 'Refazer' }).click();
    await shows(page, driver);
    await expect.poll(() => buttonBackground(frame, 'Saiba mais')).toBe('rgb(170, 0, 0)');

    // Saving hands the piece and its final output to the store of the host.
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(feedback(page)).toHaveText('Documento salvo');
    const output = await page.evaluate(
      (value) => (window as unknown as BlocksWindow).visualEditorBlocks.output(value),
      kind,
    );
    expect(output?.html).toContain('Título da peça');
    expect(output?.html).not.toContain('data-visual-editor');
    expect(output?.html).not.toMatch(/ve-p-[0-9a-f]{32}/);
    if (kind === 'email') {
      // The browser compiler wrote it: tables, columns and the style of the piece inline.
      expect(output?.html).toContain('mj-column-per-100');
      expect(output?.html.toLowerCase()).toContain('#aa0000');
    } else expect(output?.css).toContain('--ve-button-background:#aa0000');

    // Reopened from the store, the piece is the one that was saved.
    const identity = await driver.identity();
    await control(page, 'Reabrir documento salvo').click();
    await driver.ready(identity);
    await expect(page.locator('.playground-notice')).toHaveText('Documento reaberto');
    await expect(frame.getByText('Título da peça', { exact: true })).toBeVisible();
    await expect(frame.locator('img[src$="coral.svg"]')).toHaveAttribute(
      'alt',
      'Descrição escrita no painel',
    );
    await expect.poll(() => buttonBackground(frame, 'Saiba mais')).toBe('rgb(170, 0, 0)');
  });

test('the palette offers the block templates of the kind and one starts the piece again', async ({
  page,
}) => {
  const driver = await open(page, 'email');
  const templates = page.locator('[data-block-template]');
  await expect(templates).toHaveCount(3);
  await page.locator('[data-block-template="email-newsletter"]').click();
  await shows(page, driver);
  await expect(driver.frame().getByText('Conhecer as novidades', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await shows(page, driver);
  await expect(driver.frame().getByText('Escreva seu conteúdo.', { exact: true })).toBeVisible();
  const before = await driver.identity();
  await control(page, 'Landing page').click();
  await driver.ready(before);
  await expect(page.locator('[data-block-template]')).toHaveCount(2);
});

test('the browser compiler accepts the raw region of a free HTML block in an e-mail', async ({
  page,
}) => {
  const driver = await open(page, 'email');
  await palette(page, 'html').click();
  // The code editor of the shell, on several lines: the line breaks survive the edit.
  const code = panel(page).locator('[data-block-field="html"] .cm-content');
  await code.click();
  await page.keyboard.insertText('<p style="color:#123456">Trecho livre do autor</p>');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('<p>Segunda linha</p>');
  await panel(page).locator('h2.editor-selected-kind').click();
  await shows(page, driver);
  await expect(driver.frame().getByText('Trecho livre do autor', { exact: true })).toBeVisible();
  await expect(driver.frame().getByText('Segunda linha', { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => {
    const visit = (blocks: readonly Record<string, unknown>[]): string | undefined => {
      for (const block of blocks) {
        const props = block.props as Record<string, unknown>;
        if (block.type === 'html' && typeof props.html === 'string') return props.html;
        const found = visit((block.children ?? []) as Record<string, unknown>[]);
        if (found) return found;
      }
      return undefined;
    };
    const snapshot = (
      window as unknown as { visualEditorBlocks: { snapshot(): { blocks: never[] } } }
    ).visualEditorBlocks.snapshot();
    return visit(snapshot.blocks);
  });
  expect(stored).toMatch(/Trecho livre do autor<\/p>\n\s*<p>Segunda linha<\/p>/);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(feedback(page)).toHaveText('Documento salvo');
  const html = await page.evaluate(
    () => (window as unknown as BlocksWindow).visualEditorBlocks.output('email')?.html ?? '',
  );
  expect(html).toContain('Trecho livre do autor');
  expect(html).toContain('color:#123456');
});

/** Id of the block the frame shows selected. */
async function selectedInFrame(driver: CanvasDriver): Promise<string | null> {
  return driver
    .frame()
    .locator('[data-visual-editor-selected="true"]')
    .first()
    .getAttribute('data-visual-editor-node');
}

test('quick moves and undos of an e-mail, then save: the frame and the selection stay', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const driver = await open(page, 'email');
  await palette(page, 'heading').click();
  await shows(page, driver);
  await palette(page, 'button').click();
  await shows(page, driver);
  await palette(page, 'divider').click();
  await shows(page, driver);
  const id = await panel(page).getAttribute('data-block-properties');
  expect(id).not.toBe('piece');
  // Three moves and three undos, each a new revision compiled for the frame, then the save, in
  // quick succession: one task apart, faster than one compilation of the e-mail.
  const up = await panel(page)
    .getByRole('button', { name: 'Mover para cima', exact: true })
    .elementHandle();
  const undo = await page.getByRole('button', { name: 'Desfazer' }).elementHandle();
  const save = await page.getByRole('button', { name: 'Salvar', exact: true }).elementHandle();
  await page.evaluate(
    async ([moveButton, undoButton, saveButton]) => {
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
      for (const button of [
        moveButton,
        moveButton,
        moveButton,
        undoButton,
        undoButton,
        undoButton,
      ]) {
        (button as HTMLElement).click();
        await tick();
      }
      (saveButton as HTMLElement).click();
    },
    [up, undo, save],
  );
  await expect(feedback(page)).toHaveText('Documento salvo');
  await shows(page, driver);
  await expect(page.locator('.editor-canvas-failure')).toHaveCount(0);
  await expect(panel(page)).toHaveAttribute('data-block-properties', id ?? '');
  await expect.poll(() => selectedInFrame(driver)).toBe(id);
  const saved = await page.evaluate(
    () => (window as unknown as BlocksWindow).visualEditorBlocks.saved('email')?.revision,
  );
  expect(saved).toBe(
    Number(await page.locator('.visual-editor').getAttribute('data-block-revision')),
  );
});

test('the block panel: tab with fields, keyboard after remove, parent and back, field errors', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const driver = await open(page, 'page');
  // A divider has no content field: the panel opens on its style tab.
  await palette(page, 'divider').click();
  await shows(page, driver);
  await expect(panel(page).getByRole('tab', { name: 'Estilo' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel(page).locator('[data-block-field]:visible').first()).toBeVisible();

  // Removing it: the keyboard goes to the heading of the block now selected.
  await panel(page).getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(panel(page).locator('h2.editor-selected-kind')).toBeFocused();

  // An image: a refused width is said next to the field, which is marked invalid.
  await palette(page, 'image').click();
  await shows(page, driver);
  await panel(page).getByRole('tab', { name: 'Estilo' }).click();
  const width = panel(page).locator('[data-block-field="width"] input');
  await width.fill('largura');
  await width.press('Enter');
  await expect(width).toHaveAttribute('aria-invalid', 'true');
  await expect(
    panel(page).locator('[data-block-field="width"]').getByText('Revise o valor antes de aplicar.'),
  ).toBeVisible();
  await width.fill('320px');
  await width.press('Enter');
  await expect(width).not.toHaveAttribute('aria-invalid', 'true');

  // "Restaurar padrão" names the field it restores.
  await panel(page).getByRole('tab', { name: 'Conteúdo' }).click();
  const alt = panel(page).locator('[data-block-field="alt"] input');
  await alt.fill('Descrição');
  await alt.press('Enter');
  const altLabel = (
    await panel(page).locator('[data-block-field="alt"] label').first().innerText()
  ).trim();
  await expect(
    panel(page).getByRole('button', { name: `Restaurar padrão: ${altLabel}`, exact: true }),
  ).toBeVisible();

  // Parent, then back to the piece: the keyboard follows the panel.
  await panel(page).getByRole('button', { name: 'Selecionar elemento pai', exact: true }).click();
  await expect(panel(page).locator('h2.editor-selected-kind')).toBeFocused();
  await panel(page)
    .locator('.editor-block-actions')
    .getByRole('button', {
      name: 'Estilos globais',
      exact: true,
    })
    .click();
  await expect(panel(page)).toHaveAttribute('data-block-properties', 'piece');
  await expect(panel(page)).toBeFocused();

  // A switch is named once: its own label, not the label of the field again.
  await palette(page, 'button').click();
  await shows(page, driver);
  await panel(page).getByRole('tab', { name: 'Estilo' }).click();
  await expect(
    panel(page).locator('[data-block-field="fullWidth"]').getByText('Ocupar toda a largura'),
  ).toHaveCount(1);
  await expect(panel(page).getByRole('switch', { name: 'Ocupar toda a largura' })).toHaveCount(1);
});

test('on a narrow screen the "+" of a block opens the palette with the keyboard on it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const driver = await open(page, 'page');
  await driver.select('Escreva seu conteúdo.');
  // Alt + Enter asks for the same insertion as the "+" of the block.
  await page.keyboard.press('Alt+Enter');
  await expect(page.locator('[data-block-palette-type]').first()).toBeFocused();
});

test('a block piece offers no "Editar como HTML" in the frame', async ({ page }) => {
  const driver = await open(page, 'page');
  await driver.select('Escreva seu conteúdo.');
  await expect(driver.frame().getByRole('button', { name: 'Duplicar', exact: true })).toBeVisible();
  await expect(driver.frame().getByRole('button', { name: 'Editar como HTML' })).toHaveCount(0);
});
