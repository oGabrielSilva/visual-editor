import { AutoScroll } from './auto-scroll';
import type { CanvasContext } from './context';
import type { DropTargets } from './drop-targets';
import type { TextSession } from './text-session';

interface Gesture {
  readonly sourceId: string;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  moved: boolean;
  readonly capture: HTMLElement;
  last: { x: number; y: number };
}

/**
 * Moves a block with the pointer and follows a block which the host drags in from its palette.
 * One gesture at a time; nothing changes in the document before a completed drop.
 */
export class BlockDrag {
  #gesture: Gesture | undefined;
  #suppressClick = false;
  readonly #touches = new Set<number>();
  readonly #scroll = new AutoScroll();

  constructor(
    private readonly ctx: CanvasContext,
    private readonly targets: DropTargets,
    private readonly text: TextSession,
    private readonly handle: HTMLElement,
  ) {
    const options = { capture: true, signal: ctx.signal } as const;
    document.addEventListener('pointerdown', (event) => this.#press(event), options);
    document.addEventListener('pointermove', (event) => this.#move(event), {
      ...options,
      passive: false,
    });
    document.addEventListener(
      'pointerup',
      (event) => {
        this.#touches.delete(event.pointerId);
        this.#end(event, true);
      },
      options,
    );
    document.addEventListener(
      'pointercancel',
      (event) => {
        this.#touches.delete(event.pointerId);
        this.#end(event, false);
      },
      options,
    );
    document.addEventListener(
      'lostpointercapture',
      (event) => {
        if (this.#gesture?.pointerId === event.pointerId) this.cancel();
      },
      options,
    );
    document.addEventListener('contextmenu', () => this.cancel(), options);
  }

  get sourceId(): string | undefined {
    return this.#gesture?.sourceId;
  }

  /** True once: a drag is never also the click which follows it. */
  consumeClick(): boolean {
    const value = this.#suppressClick;
    this.#suppressClick = false;
    return value;
  }

  cancel(): void {
    const current = this.#gesture;
    this.#gesture = undefined;
    this.#scroll.stop();
    this.targets.clear();
    if (this.ctx.dragging) this.ctx.schedule();
    this.ctx.dragging = false;
    if (!current) return;
    try {
      if (current.capture.hasPointerCapture(current.pointerId))
        current.capture.releasePointerCapture(current.pointerId);
    } catch {
      // A detached capture target must still leave the gesture cancelled.
    }
  }

  /** The window lost the pointer for good: no touch is still down. */
  interrupt(): void {
    this.cancel();
    this.#touches.clear();
  }

  start(event: PointerEvent, sourceId: string | undefined, capture: HTMLElement): boolean {
    if (
      this.ctx.readOnly ||
      this.text.active ||
      this.#gesture ||
      !sourceId ||
      event.button !== 0 ||
      !event.isPrimary ||
      !this.ctx.regions.has(sourceId) ||
      (event.pointerType === 'touch' && (capture !== this.handle || this.#touches.size !== 1))
    )
      return false;
    try {
      capture.setPointerCapture(event.pointerId);
    } catch {
      return false;
    }
    this.#gesture = {
      sourceId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      capture,
      last: { x: event.clientX, y: event.clientY },
    };
    this.ctx.select(sourceId);
    return true;
  }

  /** The handle of the action bar: a text being edited is concluded before its block moves. */
  grab(event: PointerEvent): void {
    if (this.text.active) this.text.end('finish');
    if (this.start(event, this.ctx.selectedId, this.handle)) event.preventDefault();
  }

  #press(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      this.#touches.add(event.pointerId);
      if (this.#touches.size > 1 || !event.isPrimary) this.cancel();
      return;
    }
    if (
      this.ctx.isControls(event) ||
      !(event.target instanceof Element) ||
      this.text.contains(event.target)
    )
      return;
    // Pressing outside the element under edition concludes it before anything else is asked.
    if (this.text.active) this.text.end('finish');
    if (this.text.active) return;
    const id = this.ctx.regionFrom(event.target);
    const capture = id ? this.ctx.marked.get(id) : undefined;
    if (capture) this.start(event, id, capture);
  }

  #move(event: PointerEvent): void {
    const gesture = this.#gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (this.text.active || !gesture.capture.isConnected) {
      this.cancel();
      return;
    }
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.moved = true;
    if (!gesture.moved) return;
    event.preventDefault();
    if (!this.ctx.dragging) this.ctx.schedule();
    this.ctx.dragging = true;
    getSelection()?.removeAllRanges();
    gesture.last = { x: event.clientX, y: event.clientY };
    this.targets.resolve(event.clientX, event.clientY, gesture.sourceId);
    this.#scroll.update(event.clientY, () => {
      if (this.#gesture === gesture)
        this.targets.resolve(gesture.last.x, gesture.last.y, gesture.sourceId);
    });
  }

  #end(event: PointerEvent, commit: boolean): void {
    const current = this.#gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    const eligible =
      commit &&
      current.moved &&
      this.targets.destination &&
      !this.ctx.readOnly &&
      !this.text.active;
    if (eligible) this.targets.resolve(event.clientX, event.clientY, current.sourceId);
    const target = eligible ? this.targets.destination : undefined;
    this.cancel();
    if (target && 'targetId' in target)
      this.ctx.send('move', { sourceId: current.sourceId, ...target });
    if (current.moved) {
      this.#suppressClick = true;
      setTimeout(() => {
        this.#suppressClick = false;
      }, 0);
    }
  }

  /**
   * A block dragged from the palette of the host, or an image file from the desktop, reported
   * as points of this frame.
   */
  insertion(phase: unknown, x: unknown, y: unknown, file: unknown = false): void {
    if (this.ctx.readOnly) return;
    // A drop without a point ends the gesture like a cancel: nothing stays marked or held.
    const point = typeof x === 'number' && typeof y === 'number';
    if (phase === 'cancel' || (phase === 'drop' && !point)) {
      this.#scroll.stop();
      this.targets.clear();
      this.ctx.dragging = false;
      return;
    }
    if (!point) return;
    const isFile = file === true;
    this.ctx.dragging = true;
    this.targets.resolve(x, y, undefined, isFile);
    if (phase !== 'drop') {
      this.#scroll.update(y, () => this.targets.resolve(x, y, undefined, isFile));
      this.ctx.schedule();
      return;
    }
    const destination = this.targets.destination;
    this.#scroll.stop();
    this.targets.clear();
    this.ctx.dragging = false;
    if (!destination) return;
    if ('replace' in destination) {
      // The image which is replaced becomes the selected block, as if it had been clicked.
      this.ctx.select(destination.replace);
      this.ctx.send('image-drop', { nodeId: destination.replace });
    } else if ('targetId' in destination) this.ctx.send('insertion', destination);
    else this.ctx.send('insertion-end', {});
    this.ctx.schedule();
  }
}
