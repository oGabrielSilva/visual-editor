import { expect } from '@playwright/test';
import type { FrameLocator, Locator, Page } from '@playwright/test';

interface FrameIdentity {
  readonly nonce: string;
  readonly revision: string;
  readonly restored: string;
}

/** Drives the editing area through its real boundary: the page, the frame and their messages. */
export class CanvasDriver {
  constructor(readonly page: Page) {}

  frame(): FrameLocator {
    return this.page.frameLocator('iframe.editor-preview');
  }

  element(): Locator {
    return this.page.locator('iframe.editor-preview');
  }

  /** The element whose text is being edited in place, inside the frame. */
  editable(): Locator {
    return this.frame().locator('[contenteditable="true"]');
  }

  /** The formatting strip of the shell, always above the piece and never over it. */
  bar(): Locator {
    return this.page.locator('.editor-canvas-text-bar');
  }

  /** The same strip, only while it serves a text being edited in place. */
  activeBar(): Locator {
    return this.page.locator('.editor-canvas-text-bar[data-editing-node]');
  }

  async identity(): Promise<FrameIdentity> {
    return this.element().evaluate((element) => ({
      nonce: (element as HTMLElement).dataset.readyNonce ?? '',
      revision: (element as HTMLElement).dataset.readyRevision ?? '',
      restored: (element as HTMLElement).dataset.restoredNonce ?? '',
    }));
  }

  /** Waits for the runtime to acknowledge a window or a revision other than `previous`. */
  async ready(previous?: FrameIdentity): Promise<void> {
    await expect(this.frame().locator('[data-visual-editor-controls]')).toHaveCount(1);
    await expect
      .poll(async () => {
        const current = await this.identity();
        if (!current.nonce || current.restored !== current.nonce) return false;
        return (
          !previous || current.nonce !== previous.nonce || current.revision !== previous.revision
        );
      })
      .toBe(true);
  }

  async import(html: string): Promise<void> {
    const previous = await this.identity();
    await this.page
      .locator('.editor-file-input')
      .setInputFiles({ name: 'canvas.html', mimeType: 'text/html', buffer: Buffer.from(html) });
    await expect(this.page.locator('.editor-feedback')).toContainText('Conteúdo importado');
    await this.ready(previous);
  }

  /** Counts loads of the frame and records the handshakes the runtime sends to the host. */
  async observe(): Promise<void> {
    await this.page.addInitScript(() => {
      if (window !== window.top) return;
      const loads = (): void => {
        const frame = document.querySelector<HTMLIFrameElement>('iframe.editor-preview');
        if (!frame || frame.dataset.loadObserved) return;
        frame.dataset.loadObserved = 'true';
        frame.dataset.loads = '0';
        frame.addEventListener('load', () => {
          frame.dataset.loads = String(Number(frame.dataset.loads) + 1);
        });
      };
      new MutationObserver(loads).observe(document, { childList: true, subtree: true });
      window.addEventListener('message', (event: MessageEvent<unknown>) => {
        const frame = document.querySelector<HTMLIFrameElement>('iframe.editor-preview');
        if (
          !frame ||
          event.source !== frame.contentWindow ||
          !event.data ||
          typeof event.data !== 'object'
        )
          return;
        const value = event.data;
        if (!('nonce' in value) || typeof value.nonce !== 'string' || !('type' in value)) return;
        if (value.type === 'ready') {
          frame.dataset.readyNonce = value.nonce;
          if ('revision' in value && typeof value.revision === 'number')
            frame.dataset.readyRevision = String(value.revision);
        } else if (value.type === 'viewport-restored') {
          frame.dataset.restoredNonce = value.nonce;
          if ('sequence' in value && typeof value.sequence === 'number')
            frame.dataset.restoredSequence = String(value.sequence);
        }
      });
    });
  }

  async start(): Promise<void> {
    await this.observe();
    await this.page.goto('/');
    await expect(
      this.frame().getByRole('heading', { name: 'Uma ideia para o seu próximo passo' }),
    ).toBeVisible();
    await this.ready();
  }

  /** One click on the text: the block is selected and its own element becomes editable. */
  async edit(text: string): Promise<Locator> {
    await expect(this.frame().locator('[data-visual-editor-controls]')).toHaveCount(1);
    await this.frame().getByText(text, { exact: true }).click();
    const editable = this.editable();
    await expect(editable).toHaveCount(1);
    await expect(this.activeBar()).toHaveCount(1);
    return editable;
  }

  /** Replaces the whole text of the element under edition by typing, like a person would. */
  async replace(text: string): Promise<void> {
    await this.editable().press('ControlOrMeta+a');
    await this.page.keyboard.insertText(text);
  }

  /** Concludes the edition by keyboard; the block stays selected. */
  async finish(): Promise<void> {
    await this.editable().press('ControlOrMeta+Enter');
    await expect(this.editable()).toHaveCount(0);
  }

  /** Selects a block as a block: the text it opens is concluded without changes. */
  async select(text: string): Promise<void> {
    await this.frame().getByText(text, { exact: true }).click();
    if (await this.editable().count()) await this.editable().press('Escape');
    await expect(this.editable()).toHaveCount(0);
  }

  async move(source: string, target: string): Promise<void> {
    await expect(this.frame().locator('[data-visual-editor-controls]')).toHaveCount(1);
    await this.frame().getByText(source, { exact: true }).click();
    await expect
      .poll(() =>
        this.frame()
          .getByText(source, { exact: true })
          .evaluate((element) =>
            element
              .closest('[data-visual-editor-node]')
              ?.getAttribute('data-visual-editor-selected'),
          ),
      )
      .toBe('true');
    // A click on text opens it; Escape returns to the block, where the action bar lives.
    if (await this.editable().count()) await this.editable().press('Escape');
    const handle = this.frame().getByRole('button', { name: 'Mover', exact: true });
    await expect(handle).toBeVisible();
    const from = await handle.boundingBox();
    const to = await this.frame().getByText(target, { exact: true }).boundingBox();
    if (!from || !to) throw new Error('MISSING_GESTURE_TARGET');
    await this.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.8, { steps: 15 });
    await this.page.mouse.up();
  }
}
