// Screenshots of the playground for the project site.
//
//   yarn build && yarn preview --port 6041   (in another terminal)
//   node website/capture.mjs http://127.0.0.1:6041
//
// Every image shows the real editor with its sample content; nothing is drawn by hand.
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = process.argv[2] ?? 'http://127.0.0.1:6041';
const out = new URL('./public/assets/', import.meta.url);
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const shot = (name, target = page.locator('.visual-editor')) =>
  target.screenshot({ path: new URL(`${name}.png`, out).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
const frame = () => page.frameLocator('.editor-canvas-surface iframe');
const settle = async () => {
  await page.waitForTimeout(400);
  await page.evaluate(() => document.fonts.ready);
};

// The block editor with the newsletter template, a heading selected.
await page.goto(`${origin}/?schema=2`);
await page.getByRole('button', { name: 'E-mail', exact: true }).click();
await page.locator('[data-block-template="email-newsletter"]').click();
await frame().getByText('Conhecer as novidades', { exact: true }).waitFor();
await frame().getByText('O destaque do mês', { exact: true }).click();
await settle();
await shot('blocks-email');

// The small screen: values of their own, the panel says so.
await page.locator('.editor-toolbar').getByRole('button', { name: 'Celular', exact: true }).click();
await page.locator('.editor-properties').getByRole('tab', { name: 'Estilo' }).click();
await settle();
await shot('mobile');

// The review before sending, with a button that has no link.
await page.locator('.editor-toolbar').getByRole('button', { name: 'Computador', exact: true }).click();
await page.locator('[data-block-palette-type="button"]').click();
await page.locator('.editor-toolbar').getByRole('button', { name: 'Conferir' }).click();
await page.locator('[data-review-code]').first().waitFor();
await settle();
await shot('review');

// The dark preview.
await page.locator('[data-dark-preview]').click();
await settle();
await shot('dark');

// A landing page made of blocks.
await page.goto(`${origin}/?schema=2`);
await page.locator('[data-block-template="page-material"]').click();
await frame().getByText('Receber o material', { exact: true }).first().waitFor();
await settle();
await shot('blocks-page');

// The HTML document editor in code mode.
await page.goto(`${origin}/`);
await page.locator('.visual-editor').waitFor();
await settle();
await shot('html-document');

await browser.close();
