import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { inFrame, start } from './shell-support';

/**
 * Drags an image file from outside the browser to a point of the frame and drops it there. The
 * events are the ones a desktop drag produces on the shell; the file never reaches the frame.
 */
const dropFile = async (page: Page, point: { x: number; y: number }): Promise<void> => {
  const origin = await page.locator('iframe.editor-preview').boundingBox();
  if (!origin) throw new Error('MISSING_FRAME_GEOMETRY');
  const at = { x: origin.x + point.x, y: origin.y + point.y };
  await page.evaluate((client) => {
    const data = new DataTransfer();
    data.items.add(new File(['x'], 'nova-foto.png', { type: 'image/png' }));
    const area = document.querySelector('.visual-editor');
    area?.dispatchEvent(
      new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: client.x,
        clientY: client.y,
      }),
    );
    Object.assign(window, { droppedFile: data });
  }, at);
  const layer = page.locator('.editor-file-drop');
  await expect(layer).toHaveCount(1);
  await page.evaluate((client) => {
    const data = (window as unknown as { droppedFile: DataTransfer }).droppedFile;
    const layer = document.querySelector('.editor-file-drop');
    for (const type of ['dragover', 'dragover', 'drop'])
      layer?.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: client.x,
          clientY: client.y,
        }),
      );
  }, at);
};

test('an image file dropped on an image replaces it; dropped elsewhere it is a new image', async ({
  page,
}) => {
  const { frame, shell } = await start(page);
  const images = frame.locator('img');
  await expect(images).toHaveCount(1);
  const photo = frame.getByRole('img', { name: 'Foto de exemplo' });
  const box = await inFrame(page, photo);
  await dropFile(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  // The upload of the playground answers with an image of its library, named after the file.
  await expect(frame.getByRole('img', { name: 'nova-foto.png' })).toHaveCount(1);
  await expect(images).toHaveCount(1);
  await expect(frame.getByRole('img', { name: 'Foto de exemplo' })).toHaveCount(0);
  await expect(shell.feedback()).toContainText('Alterações aplicadas');
  // The replaced image is the selected block, though nothing was selected before the drop.
  await expect(frame.getByRole('img', { name: 'nova-foto.png' })).toHaveAttribute(
    'data-visual-editor-selected',
    'true',
  );
  // One step of undo brings the first image back.
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(frame.getByRole('img', { name: 'Foto de exemplo' })).toHaveCount(1);
  await expect(images).toHaveCount(1);

  // Over a paragraph the file lands next to it, as a new image.
  const paragraph = await inFrame(page, frame.getByText('Primeiro parágrafo', { exact: true }));
  await dropFile(page, { x: paragraph.x + 20, y: paragraph.y + paragraph.height * 0.8 });
  await expect(images).toHaveCount(2);
  await expect(frame.getByRole('img', { name: 'Foto de exemplo' })).toHaveCount(1);
  await expect(frame.getByRole('img', { name: 'nova-foto.png' })).toHaveCount(1);
});

test('the link of an image is set, changed and removed from the panel', async ({ page }) => {
  const { frame, shell } = await start(page);
  const photo = frame.getByRole('img', { name: 'Foto de exemplo' });
  await photo.click();
  await expect(photo).toHaveAttribute('data-visual-editor-selected', 'true');
  await shell.propertyTab('Conteúdo').click();
  const field = page.locator('.editor-properties').getByLabel('Destino do link', { exact: true });
  await field.fill('https://example.com/destino');
  await expect
    .poll(() =>
      frame
        .locator('img[alt="Foto de exemplo"]')
        .evaluate((element) => element.closest('a')?.getAttribute('href') ?? ''),
    )
    .toBe('https://example.com/destino');
  // The image itself stays the same element, with its own attributes.
  await expect(frame.locator('img[alt="Foto de exemplo"]')).toHaveAttribute('width', '400');
  await page
    .locator('.editor-properties')
    .getByRole('button', { name: 'Remover link', exact: true })
    .click();
  await expect
    .poll(() =>
      frame.locator('img[alt="Foto de exemplo"]').evaluate((element) => !!element.closest('a')),
    )
    .toBe(false);
  await expect(frame.locator('img[alt="Foto de exemplo"]')).toHaveCount(1);
});

test('the piece scrolls by itself while a block is held near its lower edge', async ({ page }) => {
  const paragraphs = Array.from(
    { length: 40 },
    (_, index) => `<p style="margin:0;padding:12px">Parágrafo ${index + 1}</p>`,
  ).join('');
  const { driver, frame } = await start(page, `<main><section>${paragraphs}</section></main>`);
  await driver.select('Parágrafo 1');
  const handle = frame.getByRole('button', { name: 'Mover', exact: true });
  await expect(handle).toBeVisible();
  const from = await handle.boundingBox();
  const origin = await page.locator('iframe.editor-preview').boundingBox();
  if (!from || !origin) throw new Error('MISSING_GESTURE_GEOMETRY');
  const scrollY = () => frame.locator('body').evaluate(() => window.scrollY);
  expect(await scrollY()).toBe(0);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // The lower edge of the piece as the page shows it: the frame may reach below the window.
  const viewport = page.viewportSize();
  const bottom = Math.min(origin.y + origin.height, viewport?.height ?? Infinity) - 12;
  await page.mouse.move(origin.x + origin.width / 2, bottom, { steps: 12 });
  // The pointer rests: the piece keeps scrolling on its own clock.
  await expect.poll(scrollY, { timeout: 5000 }).toBeGreaterThan(200);
  await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2, { steps: 4 });
  const resting = await scrollY();
  await page.waitForTimeout(300);
  expect(await scrollY()).toBe(resting);
  await page.mouse.up();
  // The block landed far below where it started, next to a block reached by the scroll.
  await expect
    .poll(() =>
      frame
        .locator('section')
        .evaluate((section) =>
          [...section.children].findIndex((child) => child.textContent === 'Parágrafo 1'),
        ),
    )
    .toBeGreaterThan(5);
});

/** Drags a file from the system straight over the frame, as when the window is entered there. */
const dragIntoFrame = async (page: Page) =>
  page
    .frameLocator('iframe.editor-preview')
    .locator('body')
    .evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'direto.png', { type: 'image/png' }));
      // What the page itself would see, were the drop delivered to it.
      const seen: string[] = [];
      document.body.addEventListener('drop', () => seen.push('drop'));
      document.body.addEventListener('dragover', () => seen.push('dragover'));
      const fire = (type: string) => {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: 40,
          clientY: 40,
        });
        document.querySelector('p')?.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const entered = fire('dragenter');
      const over = fire('dragover');
      const dropped = fire('drop');
      return { entered, over, dropped, seen };
    });

test('a file dragged straight over the frame never reaches the page in it', async ({ page }) => {
  const { frame } = await start(page);
  const result = await dragIntoFrame(page);
  expect(result).toEqual({ entered: true, over: true, dropped: true, seen: [] });
  // The shell raised its own layer above the frame, which takes the rest of the drag.
  await expect(page.locator('.editor-file-drop')).toHaveCount(1);
  // Without a drag over it, the layer does not stay over the piece.
  await expect(page.locator('.editor-file-drop')).toHaveCount(0, { timeout: 4000 });
  await expect(frame.locator('img')).toHaveCount(1);
});

test('a read-only piece refuses a dropped file without changing anything', async ({ page }) => {
  const { driver, frame } = await start(page);
  const previous = await driver.identity();
  await page
    .locator('.playground-controls')
    .getByRole('button', { name: 'Somente leitura', exact: true })
    .click();
  await driver.ready(previous);
  const photo = frame.getByRole('img', { name: 'Foto de exemplo' });
  const box = await inFrame(page, photo);
  await dropFile(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(600);
  await expect(frame.getByRole('img', { name: 'Foto de exemplo' })).toHaveCount(1);
  await expect(frame.locator('img')).toHaveCount(1);
  await expect(page.locator('.editor-file-drop')).toHaveCount(0);
  // Straight over the frame too: nothing for the page, nothing for the document.
  const result = await dragIntoFrame(page);
  expect(result.seen).toEqual([]);
  expect(result.dropped).toBe(true);
  await expect(frame.locator('img')).toHaveCount(1);
});
