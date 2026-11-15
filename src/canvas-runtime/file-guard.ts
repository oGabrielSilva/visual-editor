import type { CanvasContext } from './context';

const ANNOUNCE_INTERVAL = 500;

/**
 * A file dragged from the system straight over the frame. The frame never takes it: its drop is
 * cancelled before any listener of the document sees it (no navigation to the file, no data for
 * the page), and the host is told, without any data, that a file drag is over the piece so it can
 * raise its own layer, which accepts the file through the upload of the host or refuses it.
 */
export class FileGuard {
  #announced = -Infinity;

  constructor(private readonly ctx: CanvasContext) {
    const options = { capture: true, signal: ctx.signal } as const;
    for (const type of ['dragenter', 'dragover', 'drop'] as const)
      window.addEventListener(type, (event) => this.#guard(event), options);
  }

  #guard(event: DragEvent): void {
    if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    if (event.type === 'drop') return;
    const now = performance.now();
    if (now - this.#announced < ANNOUNCE_INTERVAL) return;
    this.#announced = now;
    this.ctx.send('file-drag', {});
  }
}
