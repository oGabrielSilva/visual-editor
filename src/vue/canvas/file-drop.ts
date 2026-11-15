import { ref } from 'vue';
import type { Ref } from 'vue';
import type { PaletteFrame } from './palette-drag';

export interface FileDropPorts {
  frame(): PaletteFrame | undefined;
  /** The host declared an upload and the document can change. */
  enabled(): boolean;
  /** The drag entered the window: the piece learns where a new block may land. */
  begin(): void;
}

const ANSWER_TIMEOUT = 500;
/** A layer raised by the frame's word alone goes away unless a real drag reaches it soon. */
const LAYER_TIMEOUT = 1_500;

/**
 * An image file dragged from the desktop to the piece. Over an image it replaces that image;
 * anywhere else it lands as a new image. The frame never receives the file: while the drag
 * lasts a layer of the shell takes the pointer and the frame only answers where the point
 * lands, exactly as it does for a block of the palette.
 */
export class FileDrop {
  readonly active: Ref<boolean> = ref(false);
  #pending: File | undefined;
  #area: HTMLElement | undefined;
  #expiry: ReturnType<typeof setTimeout> | undefined;
  #layer: ReturnType<typeof setTimeout> | undefined;
  /** The drag may land: an upload is declared and the document can change. Else it is refused. */
  #accepting = false;
  readonly #enter = (event: DragEvent): void => this.enter(event);
  readonly #leave = (event: DragEvent): void => this.leave(event);
  // A drag of the system fires no pointer events: one means the layer is not covering a drag.
  readonly #pointer = (): void => this.lower();

  constructor(private readonly ports: FileDropPorts) {}

  /** Listens inside the area of one editor: a drag over another editor of the page is not its. */
  listen(area: HTMLElement): void {
    this.dispose();
    this.#area = area;
    area.addEventListener('dragenter', this.#enter);
    area.addEventListener('dragleave', this.#leave);
    area.addEventListener('pointermove', this.#pointer);
    area.addEventListener('pointerdown', this.#pointer);
  }

  dispose(): void {
    this.#area?.removeEventListener('dragenter', this.#enter);
    this.#area?.removeEventListener('dragleave', this.#leave);
    this.#area?.removeEventListener('pointermove', this.#pointer);
    this.#area?.removeEventListener('pointerdown', this.#pointer);
    this.#area = undefined;
    if (this.#expiry) clearTimeout(this.#expiry);
    this.#expiry = undefined;
    this.#clearLayerTimer();
    this.#pending = undefined;
    this.active.value = false;
  }

  #clearLayerTimer(): void {
    if (this.#layer) clearTimeout(this.#layer);
    this.#layer = undefined;
  }

  /** Raises the layer for a drag: to take the file, or only to refuse it. */
  #raise(): void {
    if (this.active.value) return;
    this.#accepting = this.ports.enabled();
    this.active.value = true;
    if (this.#accepting) this.ports.begin();
  }

  private lower(): void {
    this.#clearLayerTimer();
    if (!this.active.value) return;
    this.active.value = false;
    if (this.#accepting) this.ports.frame()?.cancelInsertion();
  }

  /**
   * The frame says a file from the system is over it: the layer rises above the frame, so the
   * rest of the drag (and the drop) reaches the shell and never the page. Without a drag over the
   * layer soon after, the word of the frame alone does not keep it up.
   */
  external(): void {
    if (!this.#area) return;
    this.#raise();
    this.#clearLayerTimer();
    this.#layer = setTimeout(() => this.lower(), LAYER_TIMEOUT);
  }

  /** The file whose destination the frame has just answered; taken once. */
  take(): File | undefined {
    const file = this.#pending;
    this.#pending = undefined;
    return file;
  }

  private point(event: DragEvent): { x: number; y: number } | undefined {
    const bounds = this.ports.frame()?.getFrameElement()?.getBoundingClientRect();
    if (!bounds) return undefined;
    const x = event.clientX - bounds.x;
    const y = event.clientY - bounds.y;
    return x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height ? { x, y } : undefined;
  }

  private enter(event: DragEvent): void {
    const files = !!event.dataTransfer && [...event.dataTransfer.types].includes('Files');
    if (files) this.#raise();
  }

  private leave(event: DragEvent): void {
    // Leaving the editor (or the window), not moving between two elements of it.
    const next = event.relatedTarget;
    if (!this.active.value || (next instanceof Node && this.#area?.contains(next))) return;
    this.lower();
  }

  over(event: DragEvent): void {
    if (!this.active.value) return;
    event.preventDefault();
    this.#clearLayerTimer();
    if (!this.#accepting) {
      // Read-only, or no upload declared: the file is refused, and never reaches the piece.
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    const point = this.point(event);
    if (point) this.ports.frame()?.trackInsertion(point, true);
    else this.ports.frame()?.cancelInsertion();
  }

  drop(event: DragEvent): void {
    if (!this.active.value) return;
    event.preventDefault();
    this.#clearLayerTimer();
    this.active.value = false;
    if (!this.#accepting || !this.ports.enabled()) return;
    const file = [...(event.dataTransfer?.files ?? [])].find((entry) =>
      entry.type.startsWith('image/'),
    );
    const point = this.point(event);
    if (!file || !point) {
      this.ports.frame()?.cancelInsertion();
      return;
    }
    this.#pending = file;
    this.ports.frame()?.commitInsertion(point, true);
    if (this.#expiry) clearTimeout(this.#expiry);
    this.#expiry = setTimeout(() => {
      this.#expiry = undefined;
      if (this.#pending === file) this.#pending = undefined;
    }, ANSWER_TIMEOUT);
  }
}
