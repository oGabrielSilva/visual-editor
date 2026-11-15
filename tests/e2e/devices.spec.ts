import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { CanvasDriver } from './canvas-driver';

/**
 * Device editing in the playground (`?schema=2`): values of the small screen kept apart from those of
 * every screen, hiding a block on one screen, the review before sending (with a button that
 * shows the block) and the approximation of a dark mode in the editing frame.
 */
type Kind = 'page' | 'email';

interface BlocksWindow {
  visualEditorBlocks: {
    snapshot(): {
      blocks: { id: string; children?: unknown[]; props: Record<string, unknown> }[];
    };
  };
}

interface Found {
  id: string;
  type: string;
  props: Record<string, unknown>;
  mobile?: Record<string, unknown>;
}

const control = (page: Page, name: string): Locator =>
  page.locator('.playground-controls').getByRole('button', { name, exact: true });
const palette = (page: Page, type: string): Locator =>
  page.locator(`[data-block-palette-type="${type}"]`);
const panel = (page: Page): Locator => page.locator('.editor-properties');
const toolbar = (page: Page): Locator => page.locator('.editor-toolbar');

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

/** The block of a type in the piece, as the session holds it. */
async function block(page: Page, type: string): Promise<Found | undefined> {
  return page.evaluate((wanted) => {
    const stack = [...(window as unknown as BlocksWindow).visualEditorBlocks.snapshot().blocks];
    while (stack.length) {
      const current = stack.pop() as unknown as Found & { children?: unknown[] };
      if (current.type === wanted) return current;
      stack.push(...((current.children ?? []) as never[]));
    }
    return undefined;
  }, type);
}

async function setField(page: Page, key: string, value: string): Promise<void> {
  const input = panel(page).locator(`[data-block-field="${key}"] input`).first();
  await input.fill(value);
  await input.press('Enter');
}

for (const kind of ['page', 'email'] as const)
  test(`a ${kind}: mobile values, hiding on a screen, review and dark preview`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const driver = await open(page, kind);
    const frame = driver.frame();

    await palette(page, 'heading').click();
    await shows(page, driver);
    const heading = frame.getByText('Escreva seu título', { exact: true });
    await expect(heading).toBeVisible();

    // On the small screen the size of the heading is its own; the color stays shared.
    await toolbar(page).getByRole('button', { name: 'Celular', exact: true }).click();
    await expect(panel(page).locator('[data-device-notice]')).toBeVisible();
    await panel(page).getByRole('tab', { name: 'Estilo' }).click();
    await expect(panel(page).locator('[data-block-field="fontSize"]')).toHaveAttribute(
      'data-block-device',
      'mobile',
    );
    await expect(panel(page).locator('[data-block-field="color"]')).toHaveAttribute(
      'data-block-device',
      'desktop',
    );
    await setField(page, 'fontSize', '19px');
    await shows(page, driver);
    expect(await block(page, 'heading')).toMatchObject({ mobile: { fontSize: '19px' } });
    expect((await block(page, 'heading'))?.props.fontSize).toBeUndefined();
    await expect(
      panel(page).locator('[data-block-field="fontSize"] [data-device-marker]'),
    ).toHaveText('Ajustado no celular');
    await expect
      .poll(() => heading.evaluate((node) => getComputedStyle(node).fontSize))
      .toBe('19px');

    // Back on the large screen: the size of every screen, and the mark of the mobile value.
    await toolbar(page).getByRole('button', { name: 'Computador', exact: true }).click();
    await shows(page, driver);
    await expect(
      panel(page).locator('[data-block-field="fontSize"] [data-device-marker]'),
    ).toHaveText('Tem ajuste no celular');
    await expect
      .poll(() => heading.evaluate((node) => getComputedStyle(node).fontSize))
      .not.toBe('19px');

    // Hidden on the large screen: still in the frame, faded, so it can be selected.
    await panel(page).getByRole('tab', { name: 'Avançado' }).click();
    await panel(page).getByRole('switch', { name: 'Ocultar no computador' }).click();
    await shows(page, driver);
    expect((await block(page, 'heading'))?.props.hideOnDesktop).toBe(true);
    await expect
      .poll(() =>
        frame
          .locator('[data-visual-editor-node]')
          .filter({ has: frame.getByText('Escreva seu título', { exact: true }) })
          .last()
          .evaluate((node) => getComputedStyle(node).opacity),
      )
      .toBe('0.35');

    // A button without a link is pointed out; "Mostrar" selects it.
    await palette(page, 'button').click();
    await shows(page, driver);
    const button = await block(page, 'button');
    await toolbar(page).getByRole('button', { name: 'Conferir' }).click();
    const review = panel(page).locator('[data-block-review]');
    await expect(review).toBeFocused();
    const finding = review.locator('[data-review-code="BUTTON_WITHOUT_LINK"]');
    await expect(finding).toHaveCount(1);
    await finding.getByRole('button', { name: /Mostrar/ }).click();
    await expect(panel(page)).toHaveAttribute('data-block-properties', button?.id ?? '');

    // The finding goes once the button has a link, while the review follows the piece.
    await panel(page).getByRole('tab', { name: 'Conteúdo' }).click();
    await setField(page, 'href', 'https://exemplo.com.br');
    await shows(page, driver);
    await panel(page).getByRole('button', { name: 'Estilos globais' }).click();
    await expect(review.locator('[data-review-code="BUTTON_WITHOUT_LINK"]')).toHaveCount(0, {
      timeout: 15_000,
    });

    // The dark preview inverts the content of the frame, never the piece.
    const dark = toolbar(page).locator('[data-dark-preview]');
    await dark.click();
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() =>
        frame.locator('body').evaluate((body) => {
          const first = [...body.children].find(
            (child) => child.tagName.toLowerCase() !== 'visual-editor-controls',
          );
          return first ? getComputedStyle(first).filter : '';
        }),
      )
      .toContain('invert');
    expect((await block(page, 'heading'))?.props.hideOnDesktop).toBe(true);
  });

test('the variables of a text show as tags with their friendly name, the text untouched', async ({
  page,
}) => {
  const driver = await open(page, 'page');
  const frame = driver.frame();
  await driver.edit('Escreva seu conteúdo.');
  await driver.replace('Olá, {{contact.firstName}}!');
  await driver.finish();
  await shows(page, driver);
  const supported = await frame
    .locator('body')
    .evaluate(() => typeof (globalThis as { Highlight?: unknown }).Highlight === 'function');
  test.skip(!supported, 'This browser has no CSS Highlight API: the text stays plain.');
  await expect
    .poll(() =>
      frame
        .locator('body')
        .evaluate(
          () =>
            (CSS as unknown as { highlights: Map<string, Set<unknown>> }).highlights.get(
              've-variable',
            )?.size ?? 0,
        ),
    )
    .toBe(1);
  // The text of the piece keeps the token exactly as written.
  expect(JSON.stringify(await block(page, 'text'))).toContain('{{contact.firstName}}');
  // Under the pointer, the friendly name the host gave the variable.
  const box = await frame.locator('body').evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.nodeValue?.indexOf('{{') ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 4);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return undefined;
  });
  const frameBox = await page.locator('.editor-canvas-surface iframe').boundingBox();
  expect(box && frameBox).toBeTruthy();
  if (!box || !frameBox) return;
  await page.mouse.move(frameBox.x + box.x, frameBox.y + box.y);
  await expect(frame.locator('visual-editor-controls .variable')).toHaveText('Nome de exemplo');
});

test('a saved block is offered in the palette, inserted as a copy and removed', async ({
  page,
}) => {
  const driver = await open(page, 'email');
  const frame = driver.frame();
  await palette(page, 'button').click();
  await shows(page, driver);
  const original = await block(page, 'button');
  await panel(page).getByRole('button', { name: 'Salvar como bloco' }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog
    .locator('[data-saved-block-name] input, input[data-saved-block-name]')
    .first();
  await expect(name).toBeFocused();
  await name.fill('Botão da campanha');
  await dialog.getByRole('button', { name: 'Salvar como bloco' }).click();
  await expect(dialog).toHaveCount(0);
  const entry = page.locator('[data-saved-block]').filter({ hasText: 'Botão da campanha' });
  await expect(entry).toHaveCount(1);

  // Inserted as a copy: a new id, the same values.
  await entry.getByRole('button', { name: 'Botão da campanha', exact: true }).click();
  await shows(page, driver);
  await expect(frame.getByText('Saiba mais', { exact: true })).toHaveCount(2);
  const ids = await page.evaluate(() => {
    const found: string[] = [];
    const stack = [...(window as unknown as BlocksWindow).visualEditorBlocks.snapshot().blocks];
    while (stack.length) {
      const current = stack.pop() as unknown as Found & { children?: unknown[] };
      if (current.type === 'button') found.push(current.id);
      stack.push(...((current.children ?? []) as never[]));
    }
    return found;
  });
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(ids).toContain(original?.id);

  // Removed after confirming; the pieces that use it keep their copy.
  await entry.getByRole('button', { name: 'Remover bloco salvo: Botão da campanha' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remover bloco salvo' }).click();
  await expect(page.locator('[data-saved-block]')).toHaveCount(0);
  await expect(frame.getByText('Saiba mais', { exact: true })).toHaveCount(2);
});
