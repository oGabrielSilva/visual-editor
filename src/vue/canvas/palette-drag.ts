import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';

export interface PaletteFrame {
  /** `file`: an image file is dragged, which replaces an image it is dropped on. */
  trackInsertion(point: { x: number; y: number }, file?: boolean): void;
  commitInsertion(point: { x: number; y: number }, file?: boolean): void;
  cancelInsertion(): void;
  getFrameElement(): HTMLIFrameElement | undefined;
}

export interface PaletteDragPorts {
  frame(): PaletteFrame | undefined;
  readOnly(): boolean;
  accepts(type: string): boolean;
  /** The gesture begins: a text being edited is concluded and the valid destinations are sent. */
  begin(): void;
}

interface Gesture {
  readonly type: string;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
  readonly capture: HTMLElement;
}

const DROP_ANSWER_TIMEOUT = 500;

/**
 * A block dragged from the palette to the piece. The pointer stays with the palette button; the
 * frame only receives points and answers with the destination it found under the last one.
 */
export class PaletteDrag {
  readonly gesture: ShallowRef<Gesture | undefined> = shallowRef();
  #suppressClick = false;
  #frame = 0;
  #dropTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #listeners: readonly (readonly [string, (event: never) => void, boolean?])[];

  constructor(private readonly ports: PaletteDragPorts) {
    this.#listeners = [
      ['pointermove', (event: PointerEvent) => this.track(event), false],
      ['pointerup', (event: PointerEvent) => this.finish(event)],
      ['pointercancel', (event: PointerEvent) => this.interrupted(event)],
      ['lostpointercapture', (event: PointerEvent) => this.interrupted(event)],
      ['blur', () => this.cancel()],
      ['keydown', (event: KeyboardEvent) => this.key(event)],
    ];
  }

  /** The type waiting for the answer of the frame after a drop. */
  get pendingType(): string | undefined {
    return this.gesture.value?.type;
  }

  get active(): boolean {
    return !!this.gesture.value;
  }

  private listen(on: boolean): void {
    for (const [type, listener, passive] of this.#listeners) {
      const handler = listener as EventListener;
      if (on) window.addEventListener(type, handler, passive === false ? { passive: false } : {});
      else window.removeEventListener(type, handler);
    }
  }

  private release(gesture: Gesture): void {
    try {
      if (gesture.capture.hasPointerCapture(gesture.pointerId))
        gesture.capture.releasePointerCapture(gesture.pointerId);
    } catch {
      // The pointer transaction is already cancelled if its element was detached.
    }
  }

  cancel(): void {
    const current = this.gesture.value;
    if (this.#dropTimer) clearTimeout(this.#dropTimer);
    this.#dropTimer = undefined;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.ports.frame()?.cancelInsertion();
    this.gesture.value = undefined;
    this.listen(false);
    if (current) this.release(current);
  }

  private interrupted(event: PointerEvent): void {
    const current = this.gesture.value;
    if (current?.pointerId !== event.pointerId) return;
    this.#suppressClick = current.active;
    this.cancel();
  }

  private key(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.gesture.value) return;
    this.#suppressClick = true;
    event.preventDefault();
    this.cancel();
  }

  private point(event: PointerEvent): { x: number; y: number } | undefined {
    const bounds = this.ports.frame()?.getFrameElement()?.getBoundingClientRect();
    if (!bounds) return undefined;
    const x = event.clientX - bounds.x;
    const y = event.clientY - bounds.y;
    return [x, y].every(Number.isFinite) &&
      x >= 0 &&
      y >= 0 &&
      x <= bounds.width &&
      y <= bounds.height
      ? { x, y }
      : undefined;
  }

  private track(event: PointerEvent): void {
    const current = this.gesture.value;
    if (!current || current.pointerId !== event.pointerId) return;
    const active =
      current.active || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6;
    if (active !== current.active) this.gesture.value = { ...current, active };
    if (!active) return;
    event.preventDefault();
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const location = this.point(event);
      if (location) this.ports.frame()?.trackInsertion(location);
      else this.ports.frame()?.cancelInsertion();
    });
  }

  private finish(event: PointerEvent): void {
    const current = this.gesture.value;
    if (!current || current.pointerId !== event.pointerId) return;
    this.#suppressClick = current.active;
    const location = this.point(event);
    this.listen(false);
    this.release(current);
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    if (current.active && location) {
      // The frame answers with the destination; without an answer nothing is inserted.
      this.ports.frame()?.commitInsertion(location);
      this.#dropTimer = setTimeout(() => this.cancel(), DROP_ANSWER_TIMEOUT);
    } else this.cancel();
  }

  /** A press on a palette block: it becomes a drag only after the pointer travels. */
  start(type: string, event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      if (!this.gesture.value && event.isPrimary) this.#suppressClick = false;
      return;
    }
    if (
      this.gesture.value ||
      !event.isPrimary ||
      this.ports.readOnly() ||
      !this.ports.accepts(type) ||
      event.button !== 0 ||
      !(event.currentTarget instanceof HTMLElement)
    )
      return;
    this.ports.begin();
    const capture = event.currentTarget;
    try {
      capture.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    this.#suppressClick = false;
    this.gesture.value = {
      type,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
      capture,
    };
    this.listen(true);
  }

  /** True once after a drag, so the click which ends it does not insert a second block. */
  dragged(): boolean {
    const value = this.#suppressClick || (this.gesture.value?.active ?? false);
    this.#suppressClick = false;
    return value;
  }
}
