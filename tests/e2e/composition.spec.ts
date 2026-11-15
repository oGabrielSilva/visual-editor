import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

const composingEscape = async (input: Locator): Promise<void> => {
  // This cross-engine regression checks the public dismissal event contract, not an OS IME.
  const composing = await input.evaluate((element) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    element.dispatchEvent(event);
    return {
      isComposing: event.isComposing,
      isTrusted: event.isTrusted,
      prevented: event.defaultPrevented,
    };
  });
  expect(composing).toEqual({ isComposing: true, isTrusted: false, prevented: true });
};

test('keeps a link popover open for composing Escape and closes it for ordinary Escape', async ({
  page,
}) => {
  await page.goto('/');
  const root = page.locator('.visual-editor');
  await expect(root.getByRole('button', { name: 'Visual', exact: true })).toBeVisible();
  await page.locator('.editor-file-input').setInputFiles({
    name: 'composition-dismissal.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<main><p id="composition-text">Texto com composição</p></main>'),
  });
  await expect(page.locator('.editor-feedback')).toHaveText('Conteúdo importado');
  const frame = page.frameLocator('iframe.editor-selection-preview');
  await expect(frame.locator('#composition-text')).toHaveText('Texto com composição');
  await frame.locator('#composition-text').click();
  // The text is edited in its own element; the formatting controls stay in the host.
  const overlay = page.locator('.editor-canvas-text-bar');
  const editable = frame.locator('#composition-text[contenteditable="true"]');
  await expect(editable).toBeVisible();
  await expect(overlay).toBeVisible();
  await editable.press('ControlOrMeta+a');
  const trigger = overlay.getByRole('button', { name: 'Link', exact: true });
  await trigger.click();
  const input = overlay.getByRole('textbox', { name: 'Destino do link', exact: true });
  await expect(input).toBeFocused();
  await input.fill('https://example.test/composition');

  await composingEscape(input);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('https://example.test/composition');
  await expect(editable.locator('a')).toHaveCount(0);
  await expect(frame.locator('#composition-text')).toHaveText('Texto com composição');

  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(overlay).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(editable.locator('a')).toHaveCount(0);
  await expect(frame.locator('#composition-text')).toHaveText('Texto com composição');
});

test('preserves a composing mobile draft and dismisses nested popovers one layer at a time', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const root = page.locator('.visual-editor');
  await expect(root.getByRole('button', { name: 'Visual', exact: true })).toBeVisible();
  await page.locator('.editor-file-input').setInputFiles({
    name: 'composition-mobile.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<main><p id="composition-mobile">Texto do painel</p></main>'),
  });
  await expect(page.locator('.editor-feedback')).toHaveText('Conteúdo importado');
  const frame = page.frameLocator('iframe.editor-selection-preview');
  await frame.locator('#composition-mobile').click();
  const trigger = root.getByRole('button', { name: 'Abrir propriedades', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Propriedades', exact: true });
  await expect(dialog).toBeVisible();
  // Another control of the drawer: reaching for it takes the focus out of the text.
  const properties = dialog.getByRole('tab', { name: 'Conteúdo', exact: true });
  await properties.click();
  const editable = dialog.getByRole('textbox', { name: 'Texto', exact: true });
  await editable.click();
  await editable.press('ControlOrMeta+End');
  await page.keyboard.insertText(' rascunho');
  await expect(editable).toHaveText('Texto do painel rascunho');
  await expect(frame.locator('#composition-mobile')).toHaveText('Texto do painel');
  // Public DOM events establish the composing state in every engine; CDP is a separate proof.
  await editable.dispatchEvent('compositionstart', { data: '' });
  await composingEscape(editable);
  await expect(dialog).toBeVisible();
  await expect(editable).toBeFocused();
  await expect(editable).toHaveText('Texto do painel rascunho');
  await expect(frame.locator('#composition-mobile')).toHaveText('Texto do painel');
  await editable.dispatchEvent('compositionend', { data: '' });
  await properties.click();
  await expect(frame.locator('#composition-mobile')).toHaveText('Texto do painel rascunho');

  await editable.click();
  await editable.press('ControlOrMeta+a');
  const link = dialog.getByRole('button', { name: 'Link', exact: true });
  await link.click();
  const input = dialog.getByRole('textbox', { name: 'Destino do link', exact: true });
  await input.fill('https://example.test/mobile-composition');
  await composingEscape(input);
  await expect(input).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(input).toBeVisible();
  await expect(editable.locator('a')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(link).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(frame.locator('#composition-mobile')).toHaveText('Texto do painel rascunho');
  await expect(frame.locator('#composition-mobile a')).toHaveCount(0);
});
