import type { BlockDrag } from './block-drag';
import type { CanvasContext } from './context';
import type { TextSession } from './text-session';

/**
 * Turns clicks on the piece into intents: one click selects a block and opens its text, a double
 * click on an image asks for another one, the secondary button asks the host for its menu.
 */
export class PointerIntents {
  constructor(
    private readonly ctx: CanvasContext,
    private readonly text: TextSession,
    private readonly drag: BlockDrag,
  ) {
    const options = { capture: true, signal: ctx.signal } as const;
    document.addEventListener('click', (event) => this.#click(event), options);
    document.addEventListener('dblclick', (event) => this.#double(event), options);
    document.addEventListener('contextmenu', (event) => this.#menu(event), options);
    document.addEventListener('submit', (event) => event.preventDefault(), options);
    document.addEventListener(
      'dragstart',
      (event) => {
        // Native image and link drags would steal the gesture which moves the block.
        if (!text.contains(event.target)) event.preventDefault();
      },
      options,
    );
  }

  #click(event: MouseEvent): void {
    event.preventDefault();
    const text = this.text;
    if (text.active && text.contains(event.target) && !text.contains(document.activeElement)) {
      // Some engines leave the keyboard on the body when the frame regains focus by a click.
      text.focus('keep');
      return;
    }
    if (this.ctx.isControls(event) || text.contains(event.target)) return;
    if (this.drag.consumeClick()) return;
    if (!(event.target instanceof Element)) return;
    const id = this.ctx.regionFrom(event.target);
    const point = { x: event.clientX, y: event.clientY };
    // One click: select the block and put the caret where the person clicked.
    text.end('finish', () => {
      if (!text.begin(id, point)) this.ctx.select(id);
    });
  }

  #double(event: MouseEvent): void {
    if (this.ctx.readOnly || this.ctx.isControls(event) || !(event.target instanceof Element))
      return;
    const id = this.ctx.regionFrom(event.target);
    if (!id || this.ctx.regions.get(id)?.media !== 'image') return;
    event.preventDefault();
    if (id !== this.ctx.selectedId) this.ctx.select(id);
    this.ctx.send('action', { nodeId: id, action: 'image' });
  }

  #menu(event: MouseEvent): void {
    // The text under edition keeps the menu of the browser: spelling, paste, selection. So does
    // the whole piece where the host has no block menu to open.
    if (this.text.contains(event.target) || this.ctx.cfg.menu === false) return;
    event.preventDefault();
    // The menu key and Shift + F10 also fire this event: the keyboard already asked for it.
    if (performance.now() - this.ctx.keyboardMenu < 800) return;
    if (this.ctx.isControls(event) || !(event.target instanceof Element)) return;
    const id = this.ctx.regionFrom(event.target);
    if (!id) return;
    const x = Math.max(0, Math.min(event.clientX, innerWidth));
    const y = Math.max(0, Math.min(event.clientY, innerHeight));
    // The host opens a menu only for a frame which holds the keyboard; an engine does not always
    // give it on a press of the secondary button, the block takes it here.
    this.ctx.marked.get(id)?.focus({ preventScroll: true });
    this.text.end('finish', () => {
      this.ctx.select(id);
      this.ctx.send('context-menu', { nodeId: id, x, y });
    });
  }
}
