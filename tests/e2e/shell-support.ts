import type { Locator, Page } from '@playwright/test';
import { CanvasDriver } from './canvas-driver';
import { ShellDriver } from './shell';
import { E2E_ORIGIN } from './origin';

export const SAMPLE_IMAGE = `${E2E_ORIGIN}/samples/aurora.svg`;

/** A page with a section, a title, two paragraphs and an image served by the playground. */
export const SAMPLE_PAGE = [
  '<main>',
  '<section data-editor-block="section" style="padding:24px">',
  '<h1>Título da página</h1>',
  '<p>Primeiro parágrafo</p>',
  '<p>Segundo parágrafo</p>',
  `<img src="${SAMPLE_IMAGE}" alt="Foto de exemplo" width="400" height="200" style="display:block">`,
  '</section>',
  '</main>',
].join('');

export const start = async (page: Page, html = SAMPLE_PAGE) => {
  const driver = new CanvasDriver(page);
  await driver.start();
  await driver.import(html);
  return { driver, shell: new ShellDriver(page), frame: driver.frame() };
};

export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Drags a block of the palette to a point of the frame, with the pointer of a person. */
export const dragBlock = async (
  page: Page,
  block: Locator,
  x: number,
  y: number,
  beforeDrop?: () => Promise<void>,
): Promise<void> => {
  await block.scrollIntoViewIfNeeded();
  const from = await block.boundingBox();
  const frame = await page.locator('iframe.editor-preview').boundingBox();
  if (!from || !frame) throw new Error('MISSING_DRAG_GEOMETRY');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + x, frame.y + y, { steps: 12 });
  await beforeDrop?.();
  await page.mouse.up();
};

/** The position of an element of the piece, relative to the frame which shows it. */
export const inFrame = async (
  page: Page,
  element: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await element.boundingBox();
  const origin = await page.locator('iframe.editor-preview').boundingBox();
  if (!box || !origin) throw new Error('MISSING_FRAME_GEOMETRY');
  return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
};
