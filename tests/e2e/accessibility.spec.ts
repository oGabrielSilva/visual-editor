import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ShellDriver } from './shell';

const editor = (page: Page) => page.locator('.visual-editor');
const importText = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(editor(page).getByRole('button', { name: 'Visual', exact: true })).toBeVisible();
  await page.locator('.editor-file-input').setInputFiles({
    name: 'accessible-panel.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<main><p>Texto do painel</p></main>'),
  });
  await expect(page.locator('.editor-feedback')).toHaveText('Conteúdo importado');
  const shell = new ShellDriver(page);
  await shell.openStructure();
  await shell.treeItem('Texto do painel').click();
};
/** The invalid source of these proofs: nesting beyond the limit, which the import still refuses. */
const INVALID_SOURCE = `<main>${'<div>'.repeat(300)}Rascunho recusado</main>`;
const referencesExist = async (page: Page, ids: string | null): Promise<void> => {
  expect(ids).toBeTruthy();
  for (const id of ids?.split(/\s+/).filter(Boolean) ?? [])
    expect(
      await page
        .locator('[id]')
        .evaluateAll((nodes, id) => nodes.filter((node) => node.id === id).length, id),
    ).toBe(1);
};

test('exposes toggle state without turning ordinary actions into toggles', async ({ page }) => {
  await importText(page);
  const root = editor(page);
  await expect(root.locator('main')).toHaveCount(0);
  await expect(root.getByRole('button', { name: 'Visual', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(root.getByRole('button', { name: 'HTML', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(root.getByRole('button', { name: 'Salvar', exact: true })).not.toHaveAttribute(
    'aria-pressed',
  );
  await expect(root.getByRole('button', { name: 'Arquivo', exact: true })).not.toHaveAttribute(
    'aria-pressed',
  );
  // The tabs of the panels are tabs, with a selected state, not pressed buttons.
  await expect(new ShellDriver(page).leftTab('Estrutura')).toHaveAttribute('aria-selected', 'true');
  await expect(new ShellDriver(page).propertyTab('Conteúdo')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const text = root
    .locator('.editor-properties')
    .getByRole('textbox', { name: 'Texto', exact: true });
  await expect(text).toHaveAttribute('aria-readonly', 'false');
  await referencesExist(page, await text.getAttribute('aria-describedby'));
  await text.click();
  const bold = root
    .locator('.editor-properties')
    .getByRole('button', { name: 'Negrito', exact: true });
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the inspector mounted across a modal panel, preserves edits and restores focus without scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await importText(page);
  const root = editor(page);
  const text = root
    .locator('.editor-properties')
    .getByRole('textbox', { name: 'Texto', exact: true });
  await text.click();
  await text.press('End');
  await page.keyboard.insertText(' preservado');
  await text.press('ControlOrMeta+Enter');
  await expect(text).toContainText('Texto do painel preservado');
  const original = await text.elementHandle();
  expect(original).not.toBeNull();
  await text.click();
  await expect(text).toBeFocused();
  await page.setViewportSize({ width: 375, height: 900 });
  const trigger = root.getByRole('button', { name: 'Abrir propriedades', exact: true });
  await expect(trigger).toBeFocused();
  await expect(trigger).not.toHaveAttribute('aria-controls');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Propriedades', exact: true });
  await expect(dialog).toBeVisible();
  const triggerReference = root.getByRole('button', {
    name: 'Abrir propriedades',
    exact: true,
    includeHidden: true,
  });
  await referencesExist(page, await triggerReference.getAttribute('aria-controls'));
  await expect(dialog.getByRole('textbox', { name: 'Texto', exact: true })).toBeVisible();
  expect(await text.evaluate((node, previous) => node === previous, original)).toBe(true);
  const close = dialog.getByRole('button', { name: 'Fechar painel', exact: true });
  await expect(close).toBeFocused();
  for (let count = 0; count < 18; count++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await close.focus();
  // A tip which is still fading out is a layer of its own: Escape reaches the drawer after it.
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
  const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).not.toHaveAttribute('aria-controls');
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(before);
  await trigger.click();
  expect(await text.evaluate((node, previous) => node === previous, original)).toBe(true);
  await text.click();
  await expect(text).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog).toBeHidden();
  await expect(text).toBeVisible();
  await expect(text).toBeFocused();
  expect(await text.evaluate((node, previous) => node === previous, original)).toBe(true);
  await page.setViewportSize({ width: 320, height: 900 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Texto', exact: true })).toContainText(
    'Texto do painel preservado',
  );
  await page.keyboard.press('Escape');
  await root.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await trigger.click();
  await expect(dialog.getByRole('textbox', { name: 'Texto', exact: true })).toHaveText(
    'Texto do painel',
  );
  expect(await dialog.evaluate((node) => node.getBoundingClientRect().right <= innerWidth)).toBe(
    true,
  );
  const currentText = dialog.getByRole('textbox', { name: 'Texto', exact: true });
  await currentText.click();
  await dialog.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Destino do link', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('textbox', { name: 'Destino do link', exact: true })).toBeHidden();
  await expect(dialog).toBeVisible();
});

test('preserves text without an explicit finish across resize and panel close, and keeps it undoable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await importText(page);
  const root = editor(page);
  const text = root
    .locator('.editor-properties')
    .getByRole('textbox', { name: 'Texto', exact: true });
  await text.click();
  await text.press('End');
  await page.keyboard.insertText(' sem concluir');
  await expect(text).toHaveText('Texto do painel sem concluir');
  await page.setViewportSize({ width: 375, height: 900 });
  const trigger = root.getByRole('button', { name: 'Abrir propriedades', exact: true });
  await expect(trigger).toBeFocused();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Propriedades', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Texto', exact: true })).toHaveText(
    'Texto do painel sem concluir',
  );
  await dialog.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByRole('textbox', { name: 'Texto', exact: true })).toHaveText(
    'Texto do painel sem concluir',
  );
  await dialog.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await root.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await trigger.click();
  await expect(dialog.getByRole('textbox', { name: 'Texto', exact: true })).toHaveText(
    'Texto do painel',
  );
});

test('keeps external focus when the responsive panel changes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await importText(page);
  const root = editor(page);
  const text = root
    .locator('.editor-properties')
    .getByRole('textbox', { name: 'Texto', exact: true });
  await text.click();
  const save = root.getByRole('button', { name: 'Salvar', exact: true });
  await save.focus();
  await expect(save).toBeFocused();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(save).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(save).toBeFocused();
  await text.click();
  await page.locator('.playground-header h1').click();
  expect(
    await root
      .locator('.editor-side-panel.is-right')
      .evaluate((node) => node.contains(document.activeElement)),
  ).toBe(false);
  const externalFocus = await page.evaluateHandle(() => document.activeElement);
  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate((previous) => document.activeElement === previous, externalFocus),
  ).toBe(true);
  await root.getByRole('button', { name: 'Abrir propriedades', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Propriedades', exact: true });
  await dialog.getByRole('button', { name: 'Fechar painel', exact: true }).focus();
  await page.setViewportSize({ width: 1280, height: 900 });
  // The control which had the focus is gone with the drawer: it lands inside the same panel.
  await expect
    .poll(() =>
      root
        .locator('.editor-side-panel.is-right')
        .evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
});

test('connects popover controls and validation messages and keeps code accessible by keyboard', async ({
  page,
}) => {
  await importText(page);
  const root = editor(page);
  const richText = root.locator('.editor-properties .editor-richtext');
  await richText.getByRole('textbox', { name: 'Texto', exact: true }).click();
  const link = richText.getByRole('button', { name: 'Link', exact: true });
  await expect(link).not.toHaveAttribute('aria-controls');
  await link.click();
  const popupId = await link.getAttribute('aria-controls');
  await referencesExist(page, popupId);
  await expect(page.getByRole('dialog', { name: 'Link', exact: true })).toHaveAttribute(
    'id',
    popupId ?? '',
  );
  const destination = richText.getByRole('textbox', { name: 'Destino do link', exact: true });
  await destination.fill('javascript:alert(1)');
  await richText.getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
  await expect(destination).toHaveAttribute('aria-invalid', 'true');
  await referencesExist(page, await destination.getAttribute('aria-describedby'));
  await page.keyboard.press('Escape');
  await expect(destination).toBeHidden();
  await expect(link).not.toHaveAttribute('aria-controls');
  await root.getByRole('button', { name: 'HTML', exact: true }).click();
  const code = root.getByRole('textbox', { name: 'HTML', exact: true });
  await expect(code).toHaveAttribute('aria-readonly', 'false');
  await referencesExist(page, await code.getAttribute('aria-describedby'));
  await code.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(code).not.toBeFocused();
});

test('keeps every visible page-template label in its accessible name with an invalid HTML draft', async ({
  page,
}) => {
  await importText(page);
  const root = editor(page);
  await new ShellDriver(page).leftTab('Modelos').click();
  const cards = root.locator('button.editor-template');
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) await expect(card).toBeEnabled();
  await root.getByRole('button', { name: 'HTML', exact: true }).click();
  const code = root.getByRole('textbox', { name: 'HTML', exact: true });
  const invalid = INVALID_SOURCE;
  await code.click();
  await code.press('ControlOrMeta+A');
  await page.keyboard.insertText(invalid);
  await root.getByRole('button', { name: 'Aplicar agora', exact: true }).click();
  await expect(root.getByRole('alert').first()).toBeVisible();
  await expect(code).toHaveText(invalid);
  await expect(
    page.frameLocator('iframe.editor-preview').getByText('Texto do painel', { exact: true }),
  ).toBeVisible();
  for (const card of await cards.all()) {
    const title = (await card.locator(':scope > strong').innerText()).trim();
    const description = (await card.locator(':scope > span').innerText()).trim();
    expect(title).not.toBe('');
    expect(description).not.toBe('');
    const label = `${title} ${description}`;
    await referencesExist(page, await card.getAttribute('aria-labelledby'));
    await expect(card).toHaveAccessibleName(label);
    await expect(card).toHaveText(label);
  }
});
