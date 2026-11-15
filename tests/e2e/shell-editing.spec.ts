import { expect, test } from '@playwright/test';
import { CanvasDriver } from './canvas-driver';
import { ShellDriver } from './shell';
import { SAMPLE_IMAGE, SAMPLE_PAGE, modifier, start } from './shell-support';
import { E2E_ORIGIN } from './origin';

const paragraphs = (frame: ReturnType<CanvasDriver['frame']>) => frame.locator('section > p');
const fontSize = (node: Element): string => getComputedStyle(node).fontSize;

test('the shortcuts of the shell work from every region and stay out of text fields', async ({
  page,
}) => {
  const { frame, shell, driver } = await start(page);
  const removal = page.getByRole('dialog', { name: 'Remover este bloco?' });
  const second = frame.getByText('Segundo parágrafo', { exact: true });
  await driver.select('Segundo parágrafo');
  // Left panel.
  await shell.leftTab('Estrutura').click();
  await page.keyboard.press(`${modifier}+d`);
  await expect(second).toHaveCount(2);
  // Top bar.
  await shell.mode('Visual').focus();
  await page.keyboard.press(`${modifier}+z`);
  await expect(second).toHaveCount(1);
  await page.keyboard.press(`${modifier}+Shift+z`);
  await expect(second).toHaveCount(2);
  await page.keyboard.press(`${modifier}+z`);
  await expect(second).toHaveCount(1);
  await page.keyboard.press(`${modifier}+y`);
  await expect(second).toHaveCount(2);
  await page.keyboard.press(`${modifier}+z`);
  await expect(second).toHaveCount(1);
  // Right panel.
  await driver.select('Segundo parágrafo');
  await shell.propertyTab('Estilo').click();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(paragraphs(frame)).toHaveText(['Segundo parágrafo', 'Primeiro parágrafo']);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(paragraphs(frame)).toHaveText(['Primeiro parágrafo', 'Segundo parágrafo']);
  await page.keyboard.press('Delete');
  await expect(removal).toBeVisible();
  // Inside the dialog the keys belong to the dialog.
  await page.keyboard.press('Escape');
  await expect(removal).toBeHidden();
  await expect(second).toHaveCount(1);
  // Escape climbs to the parent, from the shell and from the piece.
  await shell.propertyTab('Estilo').focus();
  await page.keyboard.press('Escape');
  await expect(frame.locator('section')).toHaveAttribute('data-visual-editor-selected', 'true');
  await driver.select('Primeiro parágrafo');
  await frame.getByText('Primeiro parágrafo', { exact: true }).press('Escape');
  await expect(frame.locator('section')).toHaveAttribute('data-visual-editor-selected', 'true');
  // In the piece: remove with confirmation, duplicate, save.
  await driver.select('Primeiro parágrafo');
  await frame.getByText('Primeiro parágrafo', { exact: true }).press('Backspace');
  await expect(removal).toBeVisible();
  await removal.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(frame.getByText('Primeiro parágrafo', { exact: true })).toHaveCount(0);
  await driver.select('Segundo parágrafo');
  await second.press(`${modifier}+d`);
  await expect(second).toHaveCount(2);
  await frame.locator('section > p').first().press(`${modifier}+s`);
  await expect(shell.feedback()).toHaveText('Documento salvo');
  // A text field keeps its own keys: nothing is removed, duplicated or undone in the piece.
  await shell.leftTab('Blocos').click();
  const search = page.locator('.editor-palette').getByRole('searchbox', { name: 'Buscar blocos' });
  await search.fill('abc');
  await search.press('Backspace');
  await search.press(`${modifier}+d`);
  await expect(search).toHaveValue('ab');
  await expect(removal).toBeHidden();
  await expect(second).toHaveCount(2);
  // The list of shortcuts is one click away.
  await page.getByRole('button', { name: 'Atalhos e ajuda', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Atalhos e ajuda' });
  await expect(help).toContainText('Duplicar');
  await expect(help).toContainText('Salvar');
  await expect(help.locator('kbd').first()).toBeVisible();
});

test('properties apply while typing, as one undo step, and keep the value when one is refused', async ({
  page,
}) => {
  const { frame, shell, driver } = await start(page);
  await driver.select('Primeiro parágrafo');
  const paragraph = frame.getByText('Primeiro parágrafo', { exact: true });
  const original = await paragraph.evaluate(fontSize);
  await shell.propertyTab('Estilo').click();
  const size = page
    .locator('.editor-properties')
    .getByRole('spinbutton', { name: 'Tamanho do texto', exact: true });
  await size.click();
  await size.press('ControlOrMeta+A');
  // Three values in a row, each one applied on its own pause, without Enter and without leaving.
  for (const [digit, expected] of [
    ['2', '2px'],
    ['8', '28px'],
    ['0', '280px'],
  ] as const) {
    await page.keyboard.type(digit);
    await expect.poll(() => paragraph.evaluate(fontSize)).toBe(expected);
  }
  await expect(size).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect.poll(() => paragraph.evaluate(fontSize)).toBe('28px');
  // A refused value shows its error and leaves the last accepted one in the piece.
  await size.press('ControlOrMeta+A');
  await page.keyboard.type('-7');
  await expect(size).toHaveAttribute('aria-invalid', 'true');
  await expect(size).toHaveValue('-7');
  expect(await paragraph.evaluate(fontSize)).toBe('28px');
  await size.press('ControlOrMeta+A');
  await page.keyboard.type('30');
  await expect.poll(() => paragraph.evaluate(fontSize)).toBe('30px');
  // The whole run was one step.
  const undo = page.getByRole('button', { name: 'Desfazer', exact: true });
  await undo.click();
  await expect.poll(() => paragraph.evaluate(fontSize)).toBe(original);
  await undo.click();
  await expect(
    frame.getByRole('heading', { name: 'Uma ideia para o seu próximo passo' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  await expect
    .poll(() => frame.getByText('Primeiro parágrafo', { exact: true }).evaluate(fontSize))
    .toBe('30px');
  // A link destination applies live as well, and takes a variable from its menu.
  await driver.import(
    '<main><a data-editor-block="button" href="https://example.test/um">Ir</a></main>',
  );
  await driver.select('Ir');
  await shell.propertyTab('Conteúdo').click();
  const destination = page
    .locator('.editor-properties')
    .getByRole('textbox', { name: 'Destino do link', exact: true });
  await destination.fill('https://example.test/dois');
  await expect(frame.locator('a')).toHaveAttribute('href', 'https://example.test/dois');
  await shell.insertVariable(
    page.locator('.editor-property-content'),
    'Link de descadastro de exemplo',
  );
  await expect(frame.locator('a')).toHaveAttribute('href', '{{unsubscribeUrl}}');
});

test('the HTML mode highlights its code and applies it on its own after a pause', async ({
  page,
}) => {
  const { shell } = await start(page);
  await shell.mode('HTML').click();
  const code = page.getByRole('textbox', { name: 'HTML', exact: true });
  const colors = await code
    .locator('.cm-line span')
    .evaluateAll((spans) => [...new Set(spans.map((span) => getComputedStyle(span).color))]);
  expect(colors.length).toBeGreaterThan(1);
  await expect(page.locator('.editor-source-html .cm-lineNumbers')).toBeVisible();
  await expect(page.locator('.editor-source-html .cm-foldGutter')).toBeVisible();
  await code.click();
  await code.press('ControlOrMeta+A');
  await page.keyboard.insertText('<main><h1>Aplicado sozinho</h1></main>');
  const preview = page.frameLocator('iframe.editor-preview');
  await expect(preview.getByRole('heading', { name: 'Aplicado sozinho' })).toBeVisible();
  await expect(page.locator('.editor-source-state')).toHaveText('Código aplicado à peça');
  await expect(code).toHaveText('<main><h1>Aplicado sozinho</h1></main>');
  await expect(code).toBeFocused();
  // Tags close themselves and the search panel opens with its shortcut.
  await code.press('ControlOrMeta+End');
  await page.keyboard.type('<section>');
  await expect(code).toContainText('<section></section>');
  await code.press('ControlOrMeta+f');
  await expect(page.locator('.editor-source-html .cm-search')).toBeVisible();
  await page.keyboard.press('Escape');
  // A source the import refuses stays pending, with its notice shown once.
  await code.click();
  await code.press('ControlOrMeta+A');
  await page.keyboard.insertText(`<main><h1>Rascunho</h1>${'<div>'.repeat(300)}</main>`);
  const notices = page.locator('.editor-diagnostics [role="alert"] .editor-diagnostic-list li');
  await expect(notices.first()).toBeVisible();
  const texts = await notices.locator('.editor-diagnostic-text').allInnerTexts();
  expect(new Set(texts).size).toBe(texts.length);
  await expect(page.locator('.editor-source-state')).toHaveText('Alterações aguardando aplicação');
  await expect(preview.getByRole('heading', { name: 'Aplicado sozinho' })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar alterações pendentes', exact: true }).click();
  await expect(notices).toHaveCount(0);
});

test('a model is applied from the HTML mode and brings the editor back to the visual mode', async ({
  page,
}) => {
  const { shell, driver } = await start(page);
  await shell.mode('HTML').click();
  const code = page.getByRole('textbox', { name: 'HTML', exact: true });
  await code.click();
  await code.press('ControlOrMeta+A');
  await page.keyboard.insertText(
    `<main>${'<div>'.repeat(300)}Rascunho que o modelo substitui</main>`,
  );
  await shell.leftTab('Modelos').click();
  const card = page.locator('button.editor-template').first();
  await expect(card).toBeEnabled();
  await card.click();
  const dialog = page.getByRole('dialog', { name: 'Aplicar este modelo?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
  await expect(shell.mode('Visual')).toHaveAttribute('data-editor-active', 'true');
  await expect(driver.frame().locator('[data-visual-editor-controls]')).toHaveCount(1);
  await expect(driver.frame().locator('[data-visual-editor-node]').first()).toBeVisible();
  await expect(driver.frame().getByText('Rascunho que o modelo substitui')).toHaveCount(0);
  await expect(driver.frame().getByText('Primeiro parágrafo', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(driver.frame().getByText('Primeiro parágrafo', { exact: true })).toBeVisible();
});

test('an image is replaced through the library of the host, from the piece and from the panel', async ({
  page,
}) => {
  const { frame, driver, shell } = await start(page);
  const image = frame.locator('img');
  const library = page.getByRole('dialog', { name: 'Biblioteca de imagens de exemplo' });
  await image.dblclick();
  await expect(library).toBeVisible();
  await library.getByRole('button', { name: /Formas em tons de coral/ }).click();
  await expect(library).toBeHidden();
  await expect(image).toHaveAttribute('src', /samples\/coral\.svg$/);
  await expect(image).toHaveAttribute('alt', 'Formas em tons de coral');
  await expect(image).toHaveAttribute('data-host-asset-id', 'sample-coral');
  // Giving up changes nothing.
  await driver.select('Título da página');
  await image.click();
  await frame.getByRole('button', { name: 'Substituir imagem', exact: true }).click();
  await expect(library).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(library).toBeHidden();
  await expect(image).toHaveAttribute('src', /samples\/coral\.svg$/);
  await page
    .locator('.editor-properties')
    .getByRole('button', { name: 'Substituir imagem', exact: true })
    .click();
  await library.getByRole('button', { name: /Formas em tons de anil/ }).click();
  await expect(image).toHaveAttribute('src', /samples\/indigo\.svg$/);
  await expect(shell.feedback()).toHaveText('Alterações aplicadas');
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(image).toHaveAttribute('src', /samples\/coral\.svg$/);
});

test('without a library the editor asks for the address of the image and validates it', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  await driver.observe();
  await page.goto('/?images=url');
  await expect(
    driver.frame().getByRole('heading', { name: 'Uma ideia para o seu próximo passo' }),
  ).toBeVisible();
  await driver.ready();
  await driver.import(SAMPLE_PAGE);
  const image = driver.frame().locator('img');
  await image.dblclick();
  const dialog = page.getByRole('dialog', { name: 'Substituir imagem' });
  await expect(dialog).toBeVisible();
  const address = dialog.getByRole('textbox', { name: 'Endereço da imagem', exact: true });
  await expect(address).toHaveValue(SAMPLE_IMAGE);
  await address.fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(image).toHaveAttribute('src', SAMPLE_IMAGE);
  await address.fill(`${E2E_ORIGIN}/samples/ambar.svg`);
  await dialog
    .getByRole('textbox', { name: 'Descrição da imagem', exact: true })
    .fill('Outra foto');
  await dialog.getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(image).toHaveAttribute('src', /samples\/ambar\.svg$/);
  await expect(image).toHaveAttribute('alt', 'Outra foto');
  await expect(image).not.toHaveAttribute('data-host-asset-id');
});

test('the corner grips resize an image keeping its proportion, as one undoable step', async ({
  page,
}) => {
  const { frame } = await start(page);
  const image = frame.locator('img');
  await image.click();
  const grip = frame.locator('.grip.is-se');
  await expect(grip).toBeVisible();
  const before = await image.boundingBox();
  const handle = await grip.boundingBox();
  if (!before || !handle) throw new Error('MISSING_IMAGE_GEOMETRY');
  expect(Math.round(before.width)).toBe(400);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 120, handle.y - 20, { steps: 8 });
  await expect(frame.locator('.size')).toBeVisible();
  await page.mouse.up();
  await expect(image).toHaveAttribute('width', '280');
  const after = await image.boundingBox();
  if (!after) throw new Error('MISSING_RESIZED_IMAGE');
  expect(Math.abs(after.width - 280)).toBeLessThan(2);
  expect(Math.abs(after.width / after.height - before.width / before.height)).toBeLessThan(0.05);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect.poll(async () => Math.round((await image.boundingBox())?.width ?? 0)).toBe(400);
});

const NESTED = `<main>${'<section data-editor-block="section" style="padding:6px">'.repeat(9)}<p>Texto no fundo da hierarquia</p>${'</section>'.repeat(9)}</main>`;
for (const width of [1440, 1024, 390]) {
  test(`no bar, panel or path scrolls sideways at ${width} px, and the path folds its middle`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { frame, shell, driver } = await start(page, NESTED);
    await driver.select('Texto no fundo da hierarquia');
    const path = page.locator('.editor-canvas-breadcrumb');
    await expect(path.getByRole('button', { name: 'Texto', exact: true })).toBeVisible();
    await expect(path).toHaveCSS('overflow-x', 'hidden');
    await shell.expectNoHorizontalOverflow();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // Ten levels never fit: the middle ones are one menu, and choosing one selects it.
    const more = path.getByRole('button', { name: 'Mostrar níveis intermediários', exact: true });
    await expect(more).toBeVisible();
    await more.click();
    await page.getByRole('menuitem', { name: 'Seção', exact: true }).first().click();
    await expect(frame.locator('section[data-visual-editor-selected="true"]')).toHaveCount(1);
    await shell.expectNoHorizontalOverflow();
    if (width > 900) {
      await shell.openStructure();
      await shell.propertyTab('Estilo').click();
      await shell.expectNoHorizontalOverflow();
    }
  });
}

test('the shell and the controls of the piece follow the light and dark theme of the host', async ({
  page,
}) => {
  const { frame, driver, shell } = await start(page);
  await driver.select('Primeiro parágrafo');
  const surface = (): Promise<string> =>
    page.locator('.editor-toolbar').evaluate((node) => getComputedStyle(node).backgroundColor);
  const controls = (name: string): Promise<string> =>
    frame
      .locator('visual-editor-controls')
      .evaluate((node, property) => (node as HTMLElement).style.getPropertyValue(property), name);
  const light = await surface();
  const lightControls = await controls('--ve-surface');
  expect(lightControls).not.toBe('');
  expect(await controls('--ve-accent')).not.toBe('');
  const identity = await driver.identity();
  await page.locator('.playground-controls').getByRole('button', { name: 'Tema escuro' }).click();
  await expect.poll(surface).not.toBe(light);
  await expect.poll(() => controls('--ve-surface')).not.toBe(lightControls);
  // The same window: a theme never reloads the piece.
  expect((await driver.identity()).nonce).toBe(identity.nonce);
  await shell.mode('HTML').click();
  const code = page.getByRole('textbox', { name: 'HTML', exact: true });
  await expect(code.locator('.cm-line > span').first()).toHaveCSS('filter', /invert/);
  await shell.mode('Visual').click();
  await page.locator('.playground-controls').getByRole('button', { name: 'Tema claro' }).click();
  await expect.poll(surface).toBe(light);
});

test('the defaults of the document include its title and, in an e-mail, the preview text', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  const shell = new ShellDriver(page);
  await driver.start();
  const properties = page.locator('.editor-properties');
  const title = properties.getByRole('textbox', { name: 'Título da página', exact: true });
  await expect(title).toBeVisible();
  await expect(properties.getByRole('textbox', { name: 'Texto de prévia' })).toHaveCount(0);
  const initial = await title.inputValue();
  await title.fill('Página de teste');
  await expect(shell.feedback()).toHaveText('Alterações aplicadas');
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(title).toHaveValue(initial);
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  await expect(title).toHaveValue('Página de teste');
  const before = await driver.identity();
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'E-mail', exact: true })
    .click();
  await driver.ready(before);
  const subject = properties.getByRole('textbox', { name: 'Título do e-mail', exact: true });
  const preheader = properties.getByRole('textbox', { name: 'Texto de prévia', exact: true });
  await expect(properties).toContainText('Aparece ao lado do assunto na caixa de entrada');
  await subject.fill('Novidades da semana');
  await preheader.pressSequentially('Um resumo rápido', { delay: 10 });
  await shell.mode('HTML').click();
  const code = page.getByRole('textbox', { name: 'HTML', exact: true });
  await expect(code).toContainText('<title>Novidades da semana</title>');
  await expect(code).toContainText('Um resumo rápido');
  await shell.mode('Visual').click();
  // The preview text typed in one go is one step; the title before it is another.
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(preheader).toHaveValue('');
  await expect(subject).toHaveValue('Novidades da semana');
});
