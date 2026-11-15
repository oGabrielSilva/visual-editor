import { expect, test } from '@playwright/test';
import { ShellDriver } from './shell';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { EditorDocument } from '../../src/core/document';

/** Synthetic pointer transactions exercise the real bridge; native pan/tap needs the separate mobile control. */
class TouchSafetyDriver {
  constructor(readonly page: Page) {}

  frame() {
    return this.page.frameLocator('iframe.editor-preview');
  }

  handle() {
    return this.frame().getByRole('button', { name: 'Mover', exact: true });
  }

  async start(
    html = '<main><p id="gesture-first">Primeiro gesto</p><p id="gesture-second" style="margin-top:80px">Segundo gesto</p></main>',
  ): Promise<void> {
    await this.page.goto('/');
    await expect(
      this.frame().getByRole('heading', { name: 'Uma ideia para o seu próximo passo' }),
    ).toBeVisible();
    await this.page
      .locator('.editor-file-input')
      .setInputFiles({ name: 'gesture.html', mimeType: 'text/html', buffer: Buffer.from(html) });
    await expect(this.page.locator('.editor-feedback')).toContainText('Conteúdo importado');
    await expect(this.frame().locator('[data-visual-editor-controls]')).toHaveCount(1);
    await this.frame().locator('#gesture-first').click();
    await expect(this.frame().locator('#gesture-first')).toHaveAttribute(
      'data-visual-editor-selected',
      'true',
    );
    // A click opens the text in place; Escape concludes it and returns the block actions.
    await expect(this.frame().locator('#gesture-first')).toHaveAttribute('contenteditable', 'true');
    await this.frame().locator('#gesture-first').press('Escape');
    await expect(this.frame().locator('[contenteditable]')).toHaveCount(0);
    await expect(this.handle()).toBeVisible();
    await this.handle().evaluate((element) => {
      const handle = element as HTMLElement;
      handle.dataset.captures = '0';
      handle.dataset.releases = '0';
      handle.setPointerCapture = (id) => {
        handle.dataset.capturedPointer = String(id);
        handle.dataset.captures = String(Number(handle.dataset.captures) + 1);
      };
      handle.hasPointerCapture = (id) => handle.dataset.capturedPointer === String(id);
      handle.releasePointerCapture = (id) => {
        if (handle.dataset.capturedPointer !== String(id)) return;
        delete handle.dataset.capturedPointer;
        handle.dataset.releases = String(Number(handle.dataset.releases) + 1);
        handle.dispatchEvent(
          new PointerEvent('lostpointercapture', { bubbles: true, composed: true, pointerId: id }),
        );
      };
    });
    await this.page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe.editor-preview');
      if (!frame) throw new Error('MISSING_FRAME');
      frame.dataset.moveIntents = '0';
      window.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (
          event.source !== frame.contentWindow ||
          !event.data ||
          typeof event.data !== 'object' ||
          !('type' in event.data) ||
          event.data.type !== 'move'
        )
          return;
        frame.dataset.moveIntents = String(Number(frame.dataset.moveIntents) + 1);
      });
    });
  }

  async snapshot() {
    const downloaded = this.page.waitForEvent('download');
    await new ShellDriver(this.page).file('Exportar documento');
    const path = await (await downloaded).path();
    if (!path) throw new Error('MISSING_DOCUMENT');
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return EditorDocument.from(value).snapshot();
  }

  async pointer(
    type: string,
    pointerId = 41,
    pointerType = 'touch',
    primary = true,
    target: 'handle' | 'surface' = 'handle',
    atTarget = type !== 'pointerdown',
  ): Promise<boolean> {
    const element = target === 'handle' ? this.handle() : this.frame().locator('#gesture-first');
    return element.evaluate(
      (node, args) => {
        const destination = document.querySelector('#gesture-second');
        if (!destination) throw new Error('MISSING_DESTINATION');
        const rect = (args.atTarget ? destination : node).getBoundingClientRect();
        const event = new PointerEvent(args.type, {
          bubbles: true,
          composed: true,
          cancelable: true,
          pointerId: args.pointerId,
          pointerType: args.pointerType,
          isPrimary: args.primary,
          button: 0,
          buttons: args.type === 'pointerup' ? 0 : 1,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height * 0.8,
        });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      },
      { type, pointerId, pointerType, primary, atTarget },
    );
  }

  async begin(pointerType = 'touch'): Promise<void> {
    expect(await this.pointer('pointerdown', 41, pointerType)).toBe(true);
    expect(await this.pointer('pointermove', 41, pointerType)).toBe(true);
    await expect(this.frame().locator('.drop')).toBeVisible();
  }

  async settle(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
}

test('surface touch pointer streams neither capture nor prevent pan nor synthesize selection', async ({
  page,
}) => {
  const driver = new TouchSafetyDriver(page);
  await driver.start();
  const before = await driver.snapshot();
  const source = driver.frame().locator('#gesture-first');
  await source.evaluate((element) => {
    const node = element as HTMLElement;
    node.dataset.captures = '0';
    node.setPointerCapture = () => {
      node.dataset.captures = String(Number(node.dataset.captures) + 1);
    };
  });
  expect(await driver.pointer('pointerdown', 91, 'touch', true, 'surface')).toBe(false);
  expect(await driver.pointer('pointermove', 91, 'touch', true, 'surface')).toBe(false);
  expect(await driver.pointer('pointerup', 91, 'touch', true, 'surface')).toBe(false);
  await expect(source).toHaveAttribute('data-captures', '0');
  await expect(source).toHaveAttribute('data-visual-editor-selected', 'true');
  await driver.settle();
  expect(await driver.snapshot()).toEqual(before);
});

for (const interruption of [
  'second-touch',
  'lost-capture',
  'pointercancel',
  'escape',
  'selection-change',
] as const) {
  test(`cancels ${interruption} without a revision, history change or late drop`, async ({
    page,
  }) => {
    const driver = new TouchSafetyDriver(page);
    await driver.start();
    const before = await driver.snapshot();
    const undo = page.getByRole('button', { name: 'Desfazer', exact: true });
    const undoEnabled = await undo.isEnabled();
    await driver.begin();
    if (interruption === 'second-touch') {
      await driver.pointer('pointerdown', 42, 'touch', false, 'surface');
      await driver.pointer('pointerup', 42, 'touch', false, 'surface');
    } else if (interruption === 'lost-capture') {
      await driver
        .handle()
        .evaluate((element) => (element as HTMLElement).releasePointerCapture(41));
    } else if (interruption === 'pointercancel') {
      await driver.pointer('pointercancel');
    } else if (interruption === 'selection-change') {
      await driver.frame().locator('#gesture-second').click();
      await expect(driver.frame().locator('#gesture-second')).toHaveAttribute(
        'data-visual-editor-selected',
        'true',
      );
      // The click also opened the text; concluding it brings the block actions back.
      await driver.frame().locator('#gesture-second').press('Escape');
      await expect(driver.frame().locator('[contenteditable]')).toHaveCount(0);
    } else await driver.handle().press('Escape');
    await expect(driver.frame().locator('.drop')).toBeHidden();
    await driver.pointer('pointerup');
    await driver.pointer('pointerup');
    await driver.settle();
    expect(await driver.snapshot()).toEqual(before);
    expect(await undo.isEnabled()).toBe(undoEnabled);
    await expect(page.locator('iframe.editor-preview')).toHaveAttribute('data-move-intents', '0');
    await expect(driver.handle()).toHaveAttribute('data-captures', '1');
    await expect(driver.handle()).toHaveAttribute('data-releases', '1');
  });
}

test('ignores a foreign mouse terminal and commits its primary pointer exactly once with one undo', async ({
  page,
}) => {
  const driver = new TouchSafetyDriver(page);
  await driver.start();
  const before = await driver.snapshot();
  await driver.begin('mouse');
  await driver.pointer('pointerdown', 77, 'mouse', true, 'surface');
  await driver.pointer('pointerup', 77, 'mouse', true, 'surface');
  await driver.pointer('pointercancel', 77, 'mouse', true, 'surface');
  await expect(driver.frame().locator('.drop')).toBeVisible();
  await driver.pointer('pointerup', 41, 'mouse');
  await expect(driver.frame().locator('main > p')).toHaveText(['Segundo gesto', 'Primeiro gesto']);
  const after = await driver.snapshot();
  expect(after.revision).toBe(before.revision + 1);
  await expect(page.locator('iframe.editor-preview')).toHaveAttribute('data-move-intents', '1');
  await driver.pointer('pointerup', 41, 'mouse');
  await driver.settle();
  expect(await driver.snapshot()).toEqual(after);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(driver.frame().locator('main > p')).toHaveText(['Primeiro gesto', 'Segundo gesto']);
  const undone = await driver.snapshot();
  expect(undone.nodes).toEqual(before.nodes);
  expect(undone.css).toBe(before.css);
});

test('palette touch stays uncaptured and its click command inserts only once', async ({ page }) => {
  const driver = new TouchSafetyDriver(page);
  await driver.start();
  const before = await driver.snapshot();
  await page
    .locator('.editor-panel-tabs')
    .getByRole('tab', { name: 'Blocos', exact: true })
    .click();
  const button = page.locator('.editor-palette-grid button').first();
  await expect(button).toBeVisible();
  const result = await button.evaluate((element) => {
    const node = element as HTMLElement;
    let captures = 0;
    node.setPointerCapture = () => {
      captures++;
    };
    const prevented = ['pointerdown', 'pointermove', 'pointerup'].map((type, index) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerType: 'touch',
        pointerId: 90,
        isPrimary: true,
        button: 0,
        clientX: 10 + index * 25,
        clientY: 10 + index * 40,
      });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    });
    return { captures, prevented };
  });
  expect(result).toEqual({ captures: 0, prevented: [false, false, false] });
  expect(await driver.snapshot()).toEqual(before);
  await button.dispatchEvent('click');
  await expect.poll(async () => (await driver.snapshot()).revision).toBe(before.revision + 1);
});

test('preserves content metadata and canonical data while host language updates preview controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      document.documentElement.lang = 'pt_BR';
      observer.disconnect();
    });
    if (document.documentElement) document.documentElement.lang = 'pt_BR';
    else observer.observe(document, { childList: true, subtree: true });
  });
  const driver = new TouchSafetyDriver(page);
  await driver.start(
    '<html lang="es"><head><title>Título del contenido</title></head><body><main><p id="gesture-first">Primeiro gesto</p><p id="gesture-second">Segundo gesto</p></main></body></html>',
  );
  const before = await driver.snapshot();
  const controls = driver.frame().locator('[data-visual-editor-controls]');
  await expect(controls).toHaveAttribute('role', 'region');
  await expect(controls).toHaveAttribute('aria-label', 'Editar texto');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt_BR');
  await expect(controls).toHaveAttribute('lang', 'und');
  await page.evaluate(() => {
    document.documentElement.lang = 'en';
  });
  await expect(controls).toHaveAttribute('lang', 'en');
  await expect(driver.frame().locator('html')).toHaveAttribute('lang', 'es');
  await expect
    .poll(() => driver.frame().locator('head > title').textContent())
    .toBe('Título del contenido');
  await page.evaluate(() => {
    document.documentElement.lang = 'not a language';
  });
  await expect(controls).toHaveAttribute('lang', 'und');
  await expect(driver.frame().locator('html')).toHaveAttribute('lang', 'es');
  await page.evaluate(() => {
    document.documentElement.lang = 'pt-BR';
  });
  await expect(controls).toHaveAttribute('lang', 'pt-BR');
  expect(await driver.snapshot()).toEqual(before);
  const sizes = await driver.handle().evaluate((element) => {
    const coarse = matchMedia('(pointer:coarse)').matches;
    const rect = element.getBoundingClientRect();
    return { coarse, width: rect.width, height: rect.height };
  });
  expect(sizes.width).toBeGreaterThanOrEqual(sizes.coarse ? 44 : 24);
  expect(sizes.height).toBeGreaterThanOrEqual(sizes.coarse ? 44 : 24);
  expect(errors).toEqual([]);
});
