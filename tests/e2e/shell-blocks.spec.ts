import { expect, test } from '@playwright/test';
import { CanvasDriver } from './canvas-driver';
import { ShellDriver } from './shell';
import { SAMPLE_PAGE, dragBlock, inFrame, start } from './shell-support';

const paragraphs = (frame: ReturnType<CanvasDriver['frame']>) => frame.locator('section > p');

test('hover shows the kind of the block and a plus which inserts through a searchable picker', async ({
  page,
}) => {
  const { frame, driver } = await start(page);
  const heading = frame.getByRole('heading', { name: 'Título da página' });
  await heading.hover();
  const box = frame.locator('.box');
  await expect(box).toBeVisible();
  await expect(box.locator('.tag')).toHaveText('Título');
  const target = await heading.boundingBox();
  const drawn = await box.boundingBox();
  expect(Math.abs((drawn?.y ?? 0) - (target?.y ?? -99))).toBeLessThan(1.5);
  expect(Math.abs((drawn?.height ?? 0) - (target?.height ?? -99))).toBeLessThan(1.5);
  // The box follows the block when the piece scrolls.
  await frame.locator('body').evaluate(() => {
    document.body.style.minHeight = '3000px';
    scrollTo(0, 40);
  });
  await expect
    .poll(async () =>
      Math.abs(((await box.boundingBox())?.y ?? 0) - ((await heading.boundingBox())?.y ?? -99)),
    )
    .toBeLessThan(1.5);
  await frame.getByText('Primeiro parágrafo', { exact: true }).hover();
  await expect(box.locator('.tag')).toHaveText('Texto');
  const identity = await driver.identity();
  await frame.getByRole('button', { name: 'Adicionar bloco', exact: true }).click();
  const picker = page.getByRole('menu', { name: 'Adicionar bloco' });
  await expect(picker).toBeVisible();
  await picker.locator('input').fill('botao');
  await expect(picker.getByRole('menuitem')).toHaveCount(1);
  await picker.getByRole('menuitem', { name: 'Botão', exact: true }).click();
  await driver.ready(identity);
  await expect(frame.locator('section > p').first().locator('+ a')).toHaveText('Saiba mais');
  // A container also offers the inside of itself.
  // From the lower padding of the section its plus is reached without crossing a child.
  // The lower edge of the section and its plus are brought into view before the pointer rests.
  await frame.locator('section').evaluate((section) => {
    document.body.style.minHeight = '';
    scrollTo(0, 0);
    scrollBy(0, Math.max(0, section.getBoundingClientRect().bottom - innerHeight + 80));
  });
  const area = await frame.locator('section').boundingBox();
  if (!area) throw new Error('MISSING_SECTION');
  await frame.locator('section').hover({ position: { x: area.width / 2, y: area.height - 6 } });
  await expect(box.locator('.tag')).toHaveText('Seção');
  await frame.getByRole('button', { name: 'Adicionar bloco', exact: true }).click();
  await page.getByRole('menu').getByText('Inserir dentro', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Divisor', exact: true }).click();
  await expect(frame.locator('section hr')).toHaveCount(1);
});

test('the action bar stays next to a text while it is edited and never covers it', async ({
  page,
}) => {
  const { frame, driver } = await start(page);
  const editable = await driver.edit('Primeiro parágrafo');
  const toolbar = frame.getByRole('toolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toContainText('Texto');
  for (const name of [
    'Mover',
    'Selecionar elemento pai',
    'Duplicar',
    'Editar como HTML',
    'Remover',
  ])
    await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible();
  const bar = await toolbar.boundingBox();
  const text = await editable.boundingBox();
  if (!bar || !text) throw new Error('MISSING_BAR_GEOMETRY');
  expect(bar.y + bar.height <= text.y + 0.5 || bar.y >= text.y + text.height - 0.5).toBe(true);
  await editable.press('End');
  await page.keyboard.type(' editado', { delay: 0 });
  await expect(toolbar).toBeVisible();
  // An action of the bar concludes the text first, then acts on the block.
  await toolbar.getByRole('button', { name: 'Duplicar', exact: true }).click();
  await expect(frame.getByText('Primeiro parágrafo editado', { exact: true })).toHaveCount(2);
  await expect(driver.editable()).toHaveCount(0);
  // Whatever the position of the block, the bar stays inside the window of the piece.
  await driver.select('Título da página');
  const moved = await inFrame(page, toolbar);
  expect(moved.y).toBeGreaterThanOrEqual(0);
  expect(moved.x).toBeGreaterThanOrEqual(0);
});

test('the secondary button opens the same commands in the piece and in the tree', async ({
  page,
}) => {
  const { frame, shell } = await start(page);
  await frame.getByText('Segundo parágrafo', { exact: true }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Ações do bloco' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Editar texto/,
    /Selecionar elemento pai/,
    /Inserir antes/,
    /Inserir depois/,
    /Duplicar/,
    /Mover para cima/,
    /Mover para baixo/,
    /Editar como HTML/,
    /Copiar bloco/,
    /Colar bloco depois/,
    /Remover/,
  ]);
  await expect(menu.getByRole('menuitem', { name: /Colar bloco depois/ })).toBeDisabled();
  await menu.getByRole('menuitem', { name: /Mover para cima/ }).click();
  await expect(paragraphs(frame)).toHaveText(['Segundo parágrafo', 'Primeiro parágrafo']);
  // Copy one block and paste it after another: one more paragraph, one history step.
  await frame.getByText('Segundo parágrafo', { exact: true }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /Copiar bloco/ }).click();
  await expect(shell.feedback()).toHaveText('Bloco copiado');
  await frame.getByText('Primeiro parágrafo', { exact: true }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /Colar bloco depois/ }).click();
  await expect(paragraphs(frame)).toHaveText([
    'Segundo parágrafo',
    'Primeiro parágrafo',
    'Segundo parágrafo',
  ]);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(paragraphs(frame)).toHaveCount(2);
  // The tree offers the same menu for its rows.
  await shell.openStructure();
  await shell.treeItem('Primeiro parágrafo').click({ button: 'right' });
  const treeMenu = page.getByRole('menu');
  await expect(treeMenu.getByRole('menuitem', { name: /Editar como HTML/ })).toBeVisible();
  await treeMenu.getByRole('menuitem', { name: /Duplicar/ }).click();
  await expect(frame.getByText('Primeiro parágrafo', { exact: true })).toHaveCount(2);
  // An image offers its replacement; a text does not.
  await frame.locator('img').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /Substituir imagem/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Editar texto/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('editing one element as HTML replaces only that element, in one undo step', async ({
  page,
}) => {
  const { frame, driver } = await start(page);
  await frame.getByText('Segundo parágrafo', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Editar como HTML/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar como HTML' });
  const code = dialog.getByRole('textbox', { name: 'HTML do elemento' });
  await expect(code).toHaveText('<p>Segundo parágrafo</p>');
  await code.click();
  await code.press('ControlOrMeta+A');
  await page.keyboard.insertText('<h2 class="trocado">Subtítulo trocado</h2><p>Mais um texto</p>');
  await dialog.getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(frame.locator('section > h2.trocado')).toHaveText('Subtítulo trocado');
  await expect(frame.getByText('Primeiro parágrafo', { exact: true })).toHaveCount(1);
  await expect(frame.getByText('Segundo parágrafo', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(frame.getByText('Segundo parágrafo', { exact: true })).toHaveCount(1);
  await expect(frame.locator('h2.trocado')).toHaveCount(0);
  // The same door from the action bar of the piece.
  await driver.select('Primeiro parágrafo');
  await frame.getByRole('button', { name: 'Editar como HTML', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'HTML do elemento' })).toHaveText(
    '<p>Primeiro parágrafo</p>',
  );
  await dialog.getByRole('button', { name: 'Cancelar edição', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('the structure tree follows the selection both ways, folds, and reorders by dragging', async ({
  page,
}) => {
  const { frame, shell, driver } = await start(page);
  await shell.openStructure();
  const section = shell.treeItem(/^Seção$/).nth(1);
  await expect(section).toHaveAttribute('aria-expanded', 'true');
  await expect(shell.treeItem('Título da página')).toContainText('Título');
  // Piece to tree.
  await driver.select('Segundo parágrafo');
  await expect(shell.treeItem('Segundo parágrafo')).toHaveAttribute('aria-selected', 'true');
  // Tree to piece; the tree stays in place while the properties show the block.
  await shell.treeItem('Título da página').click();
  await expect(frame.getByRole('heading', { name: 'Título da página' })).toHaveAttribute(
    'data-visual-editor-selected',
    'true',
  );
  await expect(shell.treeItem('Título da página')).toBeVisible();
  await expect(page.locator('.editor-selected-kind')).toHaveText('Título');
  // Hovering a row shows the block in the piece.
  await shell.treeItem('Primeiro parágrafo').hover();
  await expect(frame.locator('.box .tag')).toHaveText('Texto');
  // Folding hides the children; selecting one of them in the piece opens the branch again.
  await section.locator('[data-slot="linkTrailing"]').click();
  await expect(section).toHaveAttribute('aria-expanded', 'false');
  await expect(shell.treeItem('Primeiro parágrafo')).toHaveCount(0);
  await driver.select('Primeiro parágrafo');
  await expect(shell.treeItem('Primeiro parágrafo')).toHaveAttribute('aria-selected', 'true');
  // Dragging a row to the upper part of another puts it before; the marker shows where.
  const source = await shell.treeItem('Segundo parágrafo').boundingBox();
  const target = await shell.treeItem('Título da página').boundingBox();
  if (!source || !target) throw new Error('MISSING_TREE_ROWS');
  await page.mouse.move(source.x + 60, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 60, target.y + 3, { steps: 8 });
  await expect(page.locator('.editor-structure-drop.is-before')).toBeVisible();
  await page.mouse.up();
  await expect(frame.locator('section > *').first()).toHaveText('Segundo parágrafo');
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(frame.locator('section > *').first()).toHaveText('Título da página');
});

test('a tree row dragged onto a container goes inside it, and a long piece stays usable', async ({
  page,
}) => {
  const { frame, shell } = await start(
    page,
    '<main><section data-editor-block="section" style="padding:16px"><h2>Dentro</h2></section><p>Solto fora</p></main>',
  );
  await shell.openStructure();
  const source = await shell.treeItem('Solto fora').boundingBox();
  const target = await shell
    .treeItem(/^Seção$/)
    .nth(1)
    .boundingBox();
  if (!source || !target) throw new Error('MISSING_TREE_ROWS');
  await page.mouse.move(source.x + 60, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 60, target.y + target.height / 2, { steps: 8 });
  await expect(page.locator('.editor-structure-drop.is-inside')).toBeVisible();
  await page.mouse.up();
  await expect(frame.locator('section > p')).toHaveText('Solto fora');
  await expect(frame.locator('main > p')).toHaveCount(0);
  // Six hundred blocks: only the rows on screen are drawn, and the last one is still reachable.
  const many = Array.from({ length: 600 }, (_, index) => `<p>Linha ${index + 1}</p>`).join('');
  await new CanvasDriver(page).import(`<main>${many}</main>`);
  const rows = page.locator('.editor-structure').getByRole('treeitem');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThan(200);
  await frame.getByText('Linha 600', { exact: true }).scrollIntoViewIfNeeded();
  await new CanvasDriver(page).select('Linha 600');
  await expect(page.locator('.editor-selected-title')).toHaveText('Linha 600');
});

test('a palette block is dragged into an empty e-mail, an e-mail from a model and a page', async ({
  page,
}) => {
  const driver = new CanvasDriver(page);
  const shell = new ShellDriver(page);
  await driver.start();
  const frame = driver.frame();
  const marker = frame.locator('.drop');
  // A new e-mail: the pointer rests on the empty area below its only text.
  const before = await driver.identity();
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'E-mail', exact: true })
    .click();
  await driver.ready(before);
  const texts = await frame.locator('[data-visual-editor-edit-node]').count();
  await dragBlock(page, shell.paletteBlock('Título'), 300, 420, async () => {
    await expect(marker).toBeVisible();
  });
  await expect(frame.getByText('Seu próximo título', { exact: true })).toBeVisible();
  await expect(frame.locator('[data-visual-editor-edit-node]')).toHaveCount(texts + 1);
  await expect(marker).toBeHidden();
  await expect(shell.feedback()).toHaveText('Alterações aplicadas');
  // An e-mail built from a model.
  await shell.leftTab('Modelos').click();
  await page.getByRole('button', { name: /^Boas-vindas/ }).click();
  await page
    .getByRole('dialog', { name: 'Aplicar este modelo?' })
    .getByRole('button', { name: 'Aplicar alterações', exact: true })
    .click();
  const anchorText = frame.getByText('Uma nova conversa começa aqui', { exact: true });
  await expect(anchorText).toBeVisible();
  await shell.leftTab('Blocos').click();
  const anchor = await inFrame(page, anchorText);
  const buttons = await frame.getByText('Saiba mais', { exact: true }).count();
  await dragBlock(
    page,
    shell.paletteBlock('Botão'),
    anchor.x + 20,
    anchor.y + anchor.height - 2,
    async () => {
      await expect(marker).toBeVisible();
    },
  );
  await expect(frame.getByText('Saiba mais', { exact: true })).toHaveCount(buttons + 1);
  // A page.
  const email = await driver.identity();
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'Landing page', exact: true })
    .click();
  await driver.ready(email);
  await driver.import(SAMPLE_PAGE);
  const paragraph = await inFrame(page, frame.getByText('Primeiro parágrafo', { exact: true }));
  await dragBlock(
    page,
    shell.paletteBlock('Divisor'),
    paragraph.x + 30,
    paragraph.y + paragraph.height - 2,
    async () => {
      await expect(marker).toBeVisible();
      await expect(marker).toContainText('Inserir depois');
    },
  );
  await expect(frame.locator('section > p').first().locator('+ hr')).toHaveCount(1);
});

test('the palette is searched without accents and a click adds after the selected block', async ({
  page,
}) => {
  const { frame, shell, driver } = await start(page);
  const search = page.locator('.editor-palette').getByRole('searchbox', { name: 'Buscar blocos' });
  const blocks = page.locator('.editor-palette-block');
  const total = await blocks.count();
  expect(total).toBeGreaterThan(6);
  await search.fill('TITU');
  await expect(blocks).toHaveText(['Título']);
  await search.fill('nada disso');
  await expect(blocks).toHaveCount(0);
  await expect(page.locator('.editor-palette')).toContainText('Nenhum bloco encontrado');
  await search.fill('');
  await expect(blocks).toHaveCount(total);
  // Groups fold and open again.
  const group = page.locator('.editor-palette').getByRole('button', { name: 'Mídia', exact: true });
  await group.click();
  await expect(shell.paletteBlock('Imagem')).toBeHidden();
  await group.click();
  await expect(shell.paletteBlock('Imagem')).toBeVisible();
  await driver.select('Primeiro parágrafo');
  await shell.paletteBlock('Divisor').click();
  await expect(frame.locator('section > p').first().locator('+ hr')).toHaveCount(1);
});

test('the plus stays under the pointer while the mouse travels to it across the next block', async ({
  page,
}) => {
  const { frame } = await start(page);
  const heading = frame.getByRole('heading', { name: 'Título da página' });
  const target = await heading.boundingBox();
  if (!target) throw new Error('heading is not laid out');
  // Rest near the left end of the heading, far from its plus at the bottom centre.
  await page.mouse.move(target.x + 12, target.y + target.height / 2);
  const plus = frame.getByRole('button', { name: 'Adicionar bloco', exact: true });
  await expect(plus).toBeVisible();
  await expect(frame.locator('.box .tag')).toHaveText('Título');
  const button = await plus.boundingBox();
  if (!button) throw new Error('plus is not laid out');
  const centre = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
  // Leave the heading through its lower edge, well to the side of the plus, and come back up
  // to it over the paragraph below: a real hand never moves in a straight line.
  await page.mouse.move(target.x + 40, target.y + target.height + 14, { steps: 6 });
  await page.mouse.move(centre.x - 30, centre.y + 10, { steps: 10 });
  await page.mouse.move(centre.x, centre.y, { steps: 6 });
  const arrived = await plus.boundingBox();
  expect(Math.abs((arrived?.y ?? -99) - button.y)).toBeLessThan(1.5);
  await expect(frame.locator('.box .tag')).toHaveText('Título');
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByRole('menu', { name: 'Adicionar bloco' })).toBeVisible();
  // Moving away for good lets the hover follow the pointer again.
  await page.keyboard.press('Escape');
  await frame.getByText('Segundo parágrafo', { exact: true }).hover();
  await expect(frame.locator('.box .tag')).toHaveText('Texto');
});
