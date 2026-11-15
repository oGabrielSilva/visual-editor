import { expect, test } from '@playwright/test';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { CanvasDriver } from './canvas-driver';
import { ShellDriver } from './shell';

/**
 * Building from scratch: a piece built from nothing with the mouse only, and again
 * with the keyboard only, in an e-mail and in a page, without ever opening the HTML mode.
 */
type Kind = 'page' | 'email';

const PLACEHOLDER = 'Escreva seu conteúdo.';
const KIND_BUTTON: Readonly<Record<Kind, string>> = { page: 'Landing page', email: 'E-mail' };

const playgroundButton = (page: Page, name: string): Locator =>
  page.locator('.playground-controls').getByRole('button', { name, exact: true });

const selected = (frame: FrameLocator): Locator =>
  frame.locator('[data-visual-editor-selected="true"]').first();

/** Opens an empty piece of `kind`: the playground creates one when nothing was saved. */
async function blank(page: Page, kind: Kind, keyboard: boolean): Promise<CanvasDriver> {
  const driver = new CanvasDriver(page);
  await driver.start();
  // A piece of the other kind first, so the one asked for is created again, empty.
  const order: Kind[] = kind === 'page' ? ['email', 'page'] : ['email'];
  for (const next of order) {
    const previous = await driver.identity();
    const button = playgroundButton(page, KIND_BUTTON[next]);
    if (keyboard) {
      await button.focus();
      await page.keyboard.press('Enter');
    } else await button.click();
    await driver.ready(previous);
  }
  await expect(driver.frame().getByText(PLACEHOLDER, { exact: true })).toBeVisible();
  return driver;
}

/** Nothing of the HTML mode was opened at any moment of the proof. */
async function neverHtml(page: Page, shell: ShellDriver): Promise<void> {
  await expect(page.locator('.cm-editor')).toHaveCount(0);
  await expect(shell.mode('Visual')).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Reads the piece again when the window was written anew under the reading: a revision whose
 * reconciliation failed is shown in a new window, which is a fallback of the editor, not a step.
 */
async function settled<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= 5 || !String(error).includes('Execution context was destroyed')) throw error;
    }
  }
}

const count = (frame: FrameLocator, text: string) => frame.getByText(text, { exact: true }).count();

for (const kind of ['page', 'email'] as const) {
  test(`builds ${kind === 'page' ? 'a page' : 'an e-mail'} from nothing with the mouse only`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const driver = await blank(page, kind, false);
    const shell = new ShellDriver(page);
    const frame = driver.frame();
    const insert = async (name: string, appears: Locator): Promise<void> => {
      const before = await appears.count();
      const previous = await driver.identity();
      await shell.paletteBlock(name).click();
      await expect(appears).toHaveCount(before + 1);
      await driver.ready(previous);
    };
    await shell.leftTab('Blocos').click();
    await insert(
      'Seção',
      frame.getByText(kind === 'page' ? 'Uma nova seção' : 'Uma nova seção para sua mensagem.', {
        exact: true,
      }),
    );
    await insert('Duas colunas', frame.getByText('Primeira coluna', { exact: true }));
    await insert(
      'Texto',
      frame.getByText('Escreva uma mensagem para sua próxima conversa.', { exact: true }),
    );
    await insert('Imagem', frame.getByRole('img', { name: 'Imagem de demonstração' }));
    await insert('Botão', frame.getByText('Saiba mais', { exact: true }));

    // Edit a text in place and conclude it with the button of the formatting strip.
    await frame
      .getByText('Escreva uma mensagem para sua próxima conversa.', { exact: true })
      .click();
    await expect(driver.editable()).toHaveCount(1);
    await driver.editable().selectText();
    await page.keyboard.insertText('Texto escrito à mão');
    // A click on another text concludes this one and opens that one.
    await frame.getByText(PLACEHOLDER, { exact: true }).click();
    await expect(driver.editable()).toHaveText(PLACEHOLDER);
    await expect(frame.getByText('Texto escrito à mão', { exact: true })).toHaveCount(1);

    // Move the button, the last block, to just after the edited text with its handle: it ends
    // up before the image which used to precede it.
    const beforeImage = () =>
      frame.getByText('Saiba mais', { exact: true }).evaluate((button) => {
        const image = document.querySelector('img[alt="Imagem de demonstração"]');
        return (
          !!image && !!(button.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      });
    expect(await beforeImage()).toBe(false);
    await driver.move('Saiba mais', 'Texto escrito à mão');
    await expect.poll(beforeImage).toBe(true);

    // Duplicate the edited text from the bar of the block, then remove the copy.
    // The bar of the button just moved covers the text above it: a click on another block
    // first takes the bar away, as a person would do. A click on the text then selects its
    // block and opens it; the bar of the block stays available.
    await frame.getByText(PLACEHOLDER, { exact: true }).click();
    await frame.getByText('Texto escrito à mão', { exact: true }).click();
    await frame.getByRole('button', { name: 'Duplicar', exact: true }).click();
    await expect.poll(() => count(frame, 'Texto escrito à mão')).toBe(2);
    await frame.getByRole('button', { name: 'Remover', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Remover este bloco?' })
      .getByRole('button', { name: 'Remover', exact: true })
      .click();
    await expect.poll(() => count(frame, 'Texto escrito à mão')).toBe(1);

    // Undo the removal and redo it, with the buttons of the top bar.
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await expect.poll(() => count(frame, 'Texto escrito à mão')).toBe(2);
    await page.getByRole('button', { name: 'Refazer', exact: true }).click();
    await expect.poll(() => count(frame, 'Texto escrito à mão')).toBe(1);

    await expect(frame.getByText('Primeira coluna', { exact: true })).toHaveCount(1);
    await expect(frame.getByRole('img', { name: 'Imagem de demonstração' })).toHaveCount(1);
    await neverHtml(page, shell);
  });

  test(`builds ${kind === 'page' ? 'a page' : 'an e-mail'} from nothing with the keyboard only`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const driver = await blank(page, kind, true);
    const shell = new ShellDriver(page);
    const frame = driver.frame();

    // Into the piece: the frame takes the keyboard, Tab reaches its first block, Space selects.
    await page.locator('iframe.editor-preview').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(selected(frame)).toContainText(PLACEHOLDER);

    /** Alt + Enter on the selected block, then the picker: search, choose, Enter. */
    const insert = async (name: string, appears: Locator): Promise<void> => {
      const before = await appears.count();
      const previous = await driver.identity();
      await page.keyboard.press('Alt+Enter');
      const picker = page.getByRole('menu', { name: 'Adicionar bloco' });
      await expect(picker).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
      await page.keyboard.type(name);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(appears).toHaveCount(before + 1);
      await driver.ready(previous);
      // The keyboard is back in the piece, on the block the new one was added to.
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
    };
    /**
     * Walks with the arrows to the innermost block which shows `text`: right into a block which
     * holds it, down when it comes later in the piece, up when it came before. Every key must
     * move the selection; one which does not fails the proof.
     */
    const reach = async (text: string) => {
      for (let step = 0; step < 60; step++) {
        const state = await selected(frame).evaluate((element, value) => {
          const blocks = [...document.querySelectorAll<HTMLElement>('[data-visual-editor-node]')];
          const goal = blocks
            .filter((block) => block.innerText.trim() === value)
            .find((block) => !block.querySelector('[data-visual-editor-node]'));
          if (!goal) return { id: '', key: 'missing' };
          const id = element.getAttribute('data-visual-editor-node') ?? '';
          if (goal === element) return { id, key: 'done' };
          if (element.contains(goal)) return { id, key: 'ArrowRight' };
          return {
            id,
            key:
              element.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING
                ? 'ArrowDown'
                : 'ArrowUp',
          };
        }, text);
        if (state.key === 'done') return;
        if (state.key === 'missing') throw new Error(`MISSING_BLOCK:${text}`);
        await page.keyboard.press(state.key);
        await expect
          .poll(() => selected(frame).getAttribute('data-visual-editor-node'))
          .not.toBe(state.id);
      }
      await expect(selected(frame)).toHaveText(text);
    };

    await insert('Botão', frame.getByText('Saiba mais', { exact: true }));
    await insert('Imagem', frame.getByRole('img', { name: 'Imagem de demonstração' }));
    await insert(
      'Texto',
      frame.getByText('Escreva uma mensagem para sua próxima conversa.', { exact: true }),
    );
    await insert('Duas colunas', frame.getByText('Primeira coluna', { exact: true }));
    await insert(
      'Seção',
      frame.getByText(kind === 'page' ? 'Uma nova seção' : 'Uma nova seção para sua mensagem.', {
        exact: true,
      }),
    );

    // Edit a text: reach it, Enter opens it, type, Ctrl/Cmd + Enter concludes.
    await reach('Escreva uma mensagem para sua próxima conversa.');
    await page.keyboard.press('Enter');
    await expect(driver.editable()).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Texto do teclado');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(driver.editable()).toHaveCount(0);
    await expect(frame.getByText('Texto do teclado', { exact: true })).toHaveCount(1);
    await expect(selected(frame)).toHaveText('Texto do teclado');

    // Move it up with Alt + arrow: one step, undone and redone with the keys.
    // Where the text sits: how deep, and how many blocks of the piece come before it.
    const place = () =>
      settled(() =>
        frame.getByText('Texto do teclado', { exact: true }).evaluate((element) => {
          let depth = 0;
          for (let node = element.parentElement; node; node = node.parentElement) depth++;
          const blocks = [...document.querySelectorAll('[data-visual-editor-node]')];
          const before = blocks.filter(
            (block) =>
              !block.contains(element) &&
              !!(block.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
          ).length;
          return `${depth}:${before}`;
        }),
      );
    // The block which held it and the text block right before it, before the move.
    const surroundings = () =>
      settled(() =>
        frame.getByText('Texto do teclado', { exact: true }).evaluate((element) => {
          const block = element.closest('[data-visual-editor-node]') ?? element;
          const chain: string[] = [];
          for (
            let node = block.parentElement?.closest('[data-visual-editor-node]');
            node;
            node = node.parentElement?.closest('[data-visual-editor-node]')
          )
            chain.push(node.getAttribute('data-visual-editor-node') ?? '');
          const leaves = [
            ...document.querySelectorAll<HTMLElement>('[data-visual-editor-node]'),
          ].filter((candidate) => !candidate.querySelector('[data-visual-editor-node]'));
          const previous = leaves[leaves.indexOf(block as HTMLElement) - 1];
          Object.assign(window, { testPrevious: previous });
          return chain.join('>');
        }),
      );
    const start = await place();
    const holderBefore = await surroundings();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(place).not.toBe(start);
    const moved = await place();
    // Up one step: it moved to other containers, or passed the block which was before it.
    const destination = await frame
      .getByText('Texto do teclado', { exact: true })
      .evaluate((element) => {
        const block = element.closest('[data-visual-editor-node]') ?? element;
        const chain: string[] = [];
        for (
          let node = block.parentElement?.closest('[data-visual-editor-node]');
          node;
          node = node.parentElement?.closest('[data-visual-editor-node]')
        )
          chain.push(node.getAttribute('data-visual-editor-node') ?? '');
        const previous = (window as unknown as { testPrevious?: Element }).testPrevious;
        return {
          holder: chain.join('>'),
          passed:
            !!previous &&
            !!(block.compareDocumentPosition(previous) & Node.DOCUMENT_POSITION_FOLLOWING),
        };
      });
    expect(destination.holder !== holderBefore || destination.passed).toBe(true);
    await expect(frame.getByText('Texto do teclado', { exact: true })).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(place).toBe(start);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(place).toBe(moved);

    // Duplicate with Ctrl/Cmd + D, remove the copy with Delete and the confirmation.
    await expect(selected(frame)).toHaveText('Texto do teclado');
    await page.keyboard.press('ControlOrMeta+d');
    await expect.poll(() => count(frame, 'Texto do teclado')).toBe(2);
    await page.keyboard.press('Delete');
    const dialog = page.getByRole('dialog', { name: 'Remover este bloco?' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Remover', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => count(frame, 'Texto do teclado')).toBe(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => count(frame, 'Texto do teclado')).toBe(2);
    await page.keyboard.press('ControlOrMeta+y');
    await expect.poll(() => count(frame, 'Texto do teclado')).toBe(1);

    await expect(frame.getByText('Primeira coluna', { exact: true })).toHaveCount(1);
    await expect(frame.getByRole('img', { name: 'Imagem de demonstração' })).toHaveCount(1);
    await expect(frame.getByText('Saiba mais', { exact: true })).toHaveCount(1);
    await neverHtml(page, shell);
  });
}

/**
 * Editing a text and clicking another one opens the other one
 * at the first click. The text just edited is confirmed by that click, the strip of formatting
 * goes idle, and nothing under the pointer may move between the press and the release.
 */
for (const kind of ['page', 'email'] as const)
  for (let round = 1; round <= 3; round++)
    test(`one click on another text opens it after an edition (${kind}, ${round})`, async ({
      page,
    }) => {
      const driver = await blank(page, kind, false);
      const shell = new ShellDriver(page);
      const frame = driver.frame();
      const previous = await driver.identity();
      await shell.leftTab('Blocos').click();
      await shell.paletteBlock('Texto').click();
      const text = frame.getByText('Escreva uma mensagem para sua próxima conversa.', {
        exact: true,
      });
      await expect(text).toHaveCount(1);
      await driver.ready(previous);
      const frameTop = () =>
        page
          .locator('iframe.editor-preview')
          .evaluate((element) => element.getBoundingClientRect().top);
      await text.click();
      await expect(driver.editable()).toHaveCount(1);
      const top = await frameTop();
      await driver.editable().selectText();
      await page.keyboard.insertText(`Editado ${round}`);
      await frame.getByText(PLACEHOLDER, { exact: true }).click();
      // The other text opens at once, and the first one kept what was typed.
      await expect(driver.editable()).toHaveText(PLACEHOLDER);
      await expect(frame.getByText(`Editado ${round}`, { exact: true })).toHaveCount(1);
      // The piece did not move under the pointer when the strip went from one text to the other.
      expect(await frameTop()).toBe(top);
    });
