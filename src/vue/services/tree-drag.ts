import type { CanvasPlacement } from '../../core/canvas-layout';

export interface TreeDrop {
  readonly source: string;
  readonly target: string;
  readonly placement: CanvasPlacement;
}

interface PointerLike {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly isPrimary: boolean;
}

const THRESHOLD = 5;

/** Pointer transaction of a row dragged in the tree. The document changes only after a drop. */
export class TreeDragSession {
  #source: { id: string; pointer: number; x: number; y: number } | undefined;
  #target: { id: string; placement: CanvasPlacement } | undefined;
  #dragging = false;

  get sourceId(): string | undefined {
    return this.#source?.id;
  }

  get dragging(): boolean {
    return this.#dragging;
  }

  start(id: string, event: PointerLike): boolean {
    if (this.#source || event.button !== 0 || !event.isPrimary) return false;
    this.#source = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY };
    this.#target = undefined;
    this.#dragging = false;
    return true;
  }

  /** Returns whether the gesture is a drag; a target only counts while it is one. */
  update(event: PointerLike, target?: { id: string; placement: CanvasPlacement }): boolean {
    const source = this.#source;
    if (!source || event.pointerId !== source.pointer) return false;
    if (Math.hypot(event.clientX - source.x, event.clientY - source.y) >= THRESHOLD)
      this.#dragging = true;
    this.#target = this.#dragging && target && target.id !== source.id ? target : undefined;
    return this.#dragging;
  }

  finish(event: PointerLike): TreeDrop | undefined {
    const source = this.#source;
    if (!source || source.pointer !== event.pointerId) return undefined;
    const target = this.#target;
    const result =
      this.#dragging && target
        ? { source: source.id, target: target.id, placement: target.placement }
        : undefined;
    this.cancel();
    return result;
  }

  cancel(): void {
    this.#source = undefined;
    this.#target = undefined;
    this.#dragging = false;
  }
}
