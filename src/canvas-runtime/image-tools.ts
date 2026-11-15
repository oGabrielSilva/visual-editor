import type { CanvasContext } from './context';
import type { ControlsOverlay } from './overlay';
import { CANVAS_IMAGE_WIDTH_LIMIT } from '../core/canvas-contract';

type Corner = 'nw' | 'ne' | 'sw' | 'se';

interface Resize {
  readonly id: string;
  readonly element: HTMLElement;
  readonly pointerId: number;
  readonly corner: Corner;
  readonly startX: number;
  readonly width: number;
  readonly ratio: number;
  readonly style: string | null;
  next: number;
}

const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];
const MINIMUM = 16;
const ANSWER_TIMEOUT = 1_500;
/** A burst of keys is one change: the size is sent once the keys rest this long. */
const KEY_SETTLE = 450;
/** The grip which takes the keyboard; the other three only answer the pointer. */
const KEYBOARD_CORNER: Corner = 'se';

interface Nudge {
  readonly id: string;
  readonly element: HTMLElement;
  readonly width: number;
  readonly ratio: number;
  readonly style: string | null;
  next: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Corner grips on the selected image: the width follows the pointer and keeps the proportion.
 * The keyboard does the same with the arrows, on the focused grip or, from the image itself,
 * with Shift + Alt + left or right.
 */
export class ImageTools {
  readonly #grips = new Map<Corner, HTMLButtonElement>();
  readonly #size: HTMLElement;
  #resize: Resize | undefined;
  #nudge: Nudge | undefined;
  #pending:
    | { element: HTMLElement; style: string | null; timer: ReturnType<typeof setTimeout> }
    | undefined;

  constructor(
    private readonly ctx: CanvasContext,
    overlay: ControlsOverlay,
  ) {
    for (const corner of CORNERS) {
      const grip = overlay.node('button', `grip is-${corner}`);
      grip.type = 'button';
      grip.hidden = true;
      const keyboard = corner === KEYBOARD_CORNER;
      grip.tabIndex = keyboard ? 0 : -1;
      grip.title = ctx.cfg.labels.resize;
      grip.setAttribute('aria-label', keyboard ? ctx.cfg.labels.resizeHint : ctx.cfg.labels.resize);
      if (keyboard) {
        grip.setAttribute(
          'aria-keyshortcuts',
          'ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight',
        );
        grip.addEventListener('keydown', (event) => this.#key(event), { signal: ctx.signal });
        grip.addEventListener('blur', () => this.#commitNudge(), { signal: ctx.signal });
      }
      grip.addEventListener('pointerdown', (event) => this.#start(event, corner, grip), {
        signal: ctx.signal,
      });
      grip.addEventListener('pointermove', (event) => this.#move(event), { signal: ctx.signal });
      grip.addEventListener('pointerup', (event) => this.#end(event, true), { signal: ctx.signal });
      grip.addEventListener('pointercancel', (event) => this.#end(event, false), {
        signal: ctx.signal,
      });
      grip.addEventListener('lostpointercapture', (event) => this.#end(event, false), {
        signal: ctx.signal,
      });
      this.#grips.set(corner, grip);
      overlay.shadow.append(grip);
    }
    this.#size = overlay.node('span', 'size');
    this.#size.hidden = true;
    overlay.shadow.append(this.#size);
    ctx.onMeasure(() => this.#measure());
    // A size the keys left is sent before the pointer or another selection can change the block
    // it belongs to: the host only resizes the block it has selected.
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.ctx.isControls(event)) this.#commitNudge();
      },
      { capture: true, signal: ctx.signal },
    );
    ctx.beforeSelect(() => this.#commitNudge());
  }

  /** Moves the keyboard from the selected image to its resize grip. */
  focusGrip(id: string): boolean {
    const grip = this.#grips.get(KEYBOARD_CORNER);
    if (!grip || grip.hidden || this.#image()?.id !== id) return false;
    grip.focus({ preventScroll: true });
    return true;
  }

  /** Drops the size the keys left without sending it; false when there was none. */
  dropKeys(): boolean {
    if (!this.#nudge) return false;
    this.#dropNudge();
    return true;
  }

  get active(): boolean {
    return !!this.#resize;
  }

  #key(event: KeyboardEvent): void {
    const id = this.ctx.selectedId;
    if (!id || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.key === 'Tab') {
      // Back to the image, or on to the block after it: the grip sits between the two.
      const order = [...this.ctx.marked.keys()];
      const target = event.shiftKey ? id : order[order.indexOf(id) + 1];
      const element = target ? this.ctx.marked.get(target) : undefined;
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      this.#commitNudge();
      element.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Escape' && this.#nudge) {
      event.preventDefault();
      event.stopPropagation();
      this.#dropNudge();
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const delta =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? -step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? step
          : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    this.nudge(id, delta);
  }

  /**
   * Changes the width of the selected image by `delta` pixels, keeping its proportion. The
   * piece shows each step at once; the host receives one size when the keys rest.
   */
  nudge(id: string, delta: number): boolean {
    const image = this.#image();
    if (!image || image.id !== id || this.#resize || !Number.isFinite(delta)) return false;
    let nudge = this.#nudge;
    if (nudge && (nudge.id !== id || !nudge.element.isConnected)) {
      this.#commitNudge();
      nudge = undefined;
    }
    if (!nudge) {
      // A size already sent and not yet answered goes on from where it is shown; a refusal
      // still returns to the style the image had before either change.
      const pending = this.#pending;
      const style =
        pending?.element === image.element ? pending.style : image.element.getAttribute('style');
      this.#settle(pending?.element !== image.element);
      const rect = image.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      nudge = {
        id,
        element: image.element,
        width: rect.width,
        ratio: rect.width / rect.height,
        style,
        next: Math.round(rect.width),
        timer: undefined,
      };
      this.#nudge = nudge;
    }
    if (nudge.timer) clearTimeout(nudge.timer);
    nudge.next = Math.round(
      Math.max(MINIMUM, Math.min(this.#limit(nudge.element), nudge.next + delta)),
    );
    nudge.element.style.width = `${nudge.next}px`;
    nudge.element.style.height = `${Math.round(nudge.next / nudge.ratio)}px`;
    nudge.timer = setTimeout(() => this.#commitNudge(), KEY_SETTLE);
    this.ctx.schedule();
    return true;
  }

  /** Sends the size the keys left, before anything else is asked of the piece. */
  flushKeys(): void {
    this.#commitNudge();
  }

  #commitNudge(): void {
    const nudge = this.#nudge;
    if (!nudge) return;
    this.#nudge = undefined;
    if (nudge.timer) clearTimeout(nudge.timer);
    this.#commit(nudge.id, nudge.element, nudge.style, nudge.width, nudge.next, nudge.ratio);
  }

  #dropNudge(): void {
    const nudge = this.#nudge;
    if (!nudge) return;
    this.#nudge = undefined;
    if (nudge.timer) clearTimeout(nudge.timer);
    if (nudge.element.isConnected) this.#restore(nudge.element, nudge.style);
  }

  #limit(element: HTMLElement): number {
    return Math.min(
      CANVAS_IMAGE_WIDTH_LIMIT,
      element.parentElement?.getBoundingClientRect().width || CANVAS_IMAGE_WIDTH_LIMIT,
    );
  }

  #image(): { id: string; element: HTMLElement } | undefined {
    const id = this.ctx.selectedId;
    const element = id ? this.ctx.marked.get(id) : undefined;
    return id && element && !this.ctx.readOnly && this.ctx.regions.get(id)?.media === 'image'
      ? { id, element }
      : undefined;
  }

  #measure(): void {
    const image = this.#image();
    const rect = image?.element.getBoundingClientRect();
    const visible = !!rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;
    for (const [corner, grip] of this.#grips) {
      grip.hidden = !visible;
      if (!rect || !visible) continue;
      grip.style.left = `${corner.endsWith('w') ? rect.left : rect.right}px`;
      grip.style.top = `${corner.startsWith('n') ? rect.top : rect.bottom}px`;
    }
    const changing = !!this.#resize || !!this.#nudge;
    this.#size.hidden = !changing || !rect;
    if (changing && rect) {
      this.#size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
      this.#size.style.left = `${Math.max(4, rect.left)}px`;
      this.#size.style.top = `${Math.min(innerHeight - 24, rect.bottom + 6)}px`;
    }
  }

  #start(event: PointerEvent, corner: Corner, grip: HTMLElement): void {
    const image = this.#image();
    if (!image || this.#resize || event.button !== 0 || !event.isPrimary) return;
    const rect = image.element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    event.preventDefault();
    this.#commitNudge();
    // Right after the keys the size they sent is still shown: the pointer goes on from it, and a
    // refusal returns to the style the image had before both changes.
    const pending = this.#pending;
    const style =
      pending?.element === image.element ? pending.style : image.element.getAttribute('style');
    this.#settle(pending?.element !== image.element);
    this.#resize = {
      id: image.id,
      element: image.element,
      pointerId: event.pointerId,
      corner,
      startX: event.clientX,
      width: rect.width,
      ratio: rect.width / rect.height,
      style,
      next: rect.width,
    };
    this.ctx.dragging = true;
  }

  #move(event: PointerEvent): void {
    const resize = this.#resize;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    const delta = event.clientX - resize.startX;
    const limit = this.#limit(resize.element);
    resize.next = Math.round(
      Math.max(
        MINIMUM,
        Math.min(limit, resize.width + (resize.corner.endsWith('w') ? -delta : delta)),
      ),
    );
    // A preview on the element itself; the next revision from the host replaces it.
    resize.element.style.width = `${resize.next}px`;
    resize.element.style.height = `${Math.round(resize.next / resize.ratio)}px`;
    this.ctx.schedule();
  }

  #restore(element: HTMLElement, style: string | null): void {
    if (style === null) element.removeAttribute('style');
    else element.setAttribute('style', style);
    this.ctx.schedule();
  }

  /** The host answered with a revision, or never did: the preview is no longer needed. */
  #settle(restore = true): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = undefined;
    clearTimeout(pending.timer);
    if (restore && pending.element.isConnected) this.#restore(pending.element, pending.style);
    const waiting = this.#answered.splice(0);
    for (const then of waiting) then();
  }

  readonly #answered: (() => void)[] = [];

  /**
   * Runs `then` once the size just sent is answered (a revision, or no answer in time); at once
   * when none is on its way. Saving waits for it, so the size of the last key is what is saved.
   */
  afterAnswer(then: () => void): void {
    if (this.#pending) this.#answered.push(then);
    else then();
  }

  /** A revision arrived: its markup already carries the accepted size. */
  documentChanged(): void {
    this.#settle(false);
    // A revision replaced the element under the keys: the size shown is no longer its own.
    if (this.#nudge && !this.#nudge.element.isConnected) this.#dropNudge();
  }

  #end(event: PointerEvent, commit: boolean): void {
    const resize = this.#resize;
    if (!resize || resize.pointerId !== event.pointerId) return;
    this.#resize = undefined;
    this.ctx.dragging = false;
    if (!commit) {
      this.#restore(resize.element, resize.style);
      return;
    }
    this.#commit(resize.id, resize.element, resize.style, resize.width, resize.next, resize.ratio);
  }

  /** Asks the host for the new size; the preview stays until a revision or the timeout. */
  #commit(
    id: string,
    element: HTMLElement,
    style: string | null,
    width: number,
    next: number,
    ratio: number,
  ): void {
    const changed = Math.abs(next - width) >= 1;
    if (!changed || this.ctx.readOnly || !element.isConnected) {
      this.#restore(element, style);
      return;
    }
    this.#pending = {
      element,
      style,
      timer: setTimeout(() => this.#settle(), ANSWER_TIMEOUT),
    };
    this.ctx.send('image-resize', {
      nodeId: id,
      width: next,
      height: Math.max(1, Math.round(next / ratio)),
    });
    this.ctx.schedule();
  }
}
