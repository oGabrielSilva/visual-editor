import type { CanvasContext, Placement } from './context';
import type { ControlsOverlay } from './overlay';

export type DropDestination =
  | { readonly targetId: string; readonly placement: Placement }
  | { readonly end: true }
  /** A dropped image file over an image: it takes the place of that image. */
  | { readonly replace: string };

const PLACEMENTS: readonly Placement[] = ['before', 'after', 'inside'];
const EDGE = 0.28;

function placements(value: unknown): value is Placement[] {
  return (
    Array.isArray(value) &&
    value.length <= 3 &&
    value.every((entry) => (PLACEMENTS as readonly unknown[]).includes(entry))
  );
}

/**
 * Decides where a dragged block would land and draws the insertion marker. Only destinations the
 * host declared valid are ever shown; the command itself is validated again by the host.
 */
export class DropTargets {
  readonly #marker: HTMLElement;
  readonly #label: HTMLElement;
  #destination: DropDestination | undefined;
  #movementSource: string | undefined;
  #movement = new Map<string, readonly Placement[]>();
  #insertion: Map<string, readonly Placement[]> | undefined;

  constructor(
    private readonly ctx: CanvasContext,
    overlay: ControlsOverlay,
  ) {
    this.#marker = overlay.node('div', 'drop');
    this.#marker.hidden = true;
    this.#label = overlay.node('span', 'drop-label');
    this.#marker.append(this.#label);
    overlay.shadow.append(this.#marker);
  }

  get destination(): DropDestination | undefined {
    return this.#destination;
  }

  clear(): void {
    this.#destination = undefined;
    this.#marker.hidden = true;
  }

  /** A new revision invalidates every destination the host had declared. */
  reset(): void {
    this.#movementSource = undefined;
    this.#movement = new Map();
    this.#insertion = undefined;
    this.clear();
  }

  #table(entries: unknown): Map<string, readonly Placement[]> | undefined {
    if (!Array.isArray(entries) || entries.length > 10_000) return undefined;
    const next = new Map<string, readonly Placement[]>();
    for (const entry of entries as unknown[]) {
      if (!entry || typeof entry !== 'object') return undefined;
      const { targetId, placements: list } = entry as Record<string, unknown>;
      if (typeof targetId !== 'string' || !this.ctx.regions.has(targetId) || !placements(list))
        return undefined;
      next.set(targetId, list);
    }
    return next;
  }

  /** Where the selected block may be moved to. */
  setMovement(sourceId: unknown, entries: unknown): void {
    if (typeof sourceId !== 'string' || !this.ctx.regions.has(sourceId)) return;
    const table = this.#table(entries);
    if (!table) return;
    this.#movementSource = sourceId;
    this.#movement = table;
    const current = this.#destination;
    if (
      current &&
      'targetId' in current &&
      !table.get(current.targetId)?.includes(current.placement)
    )
      this.clear();
  }

  /** Where a new block may be inserted. */
  setInsertion(entries: unknown): void {
    const table = this.#table(entries);
    if (table) this.#insertion = table;
  }

  #allowed(id: string, placement: Placement, sourceId: string | undefined): boolean {
    if (sourceId)
      return this.#movementSource === sourceId && !!this.#movement.get(id)?.includes(placement);
    if (this.#insertion) return !!this.#insertion.get(id)?.includes(placement);
    return placement !== 'inside' || this.ctx.regions.get(id)?.container === true;
  }

  #descends(sourceId: string, targetId: string): boolean {
    const source = this.ctx.marked.get(sourceId);
    const target = this.ctx.marked.get(targetId);
    return !!source && !!target && source.contains(target);
  }

  /** Blocks laid out side by side are entered from their left and right edges. */
  #horizontal(id: string, rect: DOMRect): boolean {
    for (const sibling of this.ctx.siblings(id)) {
      if (sibling === id) continue;
      const other = this.ctx.marked.get(sibling)?.getBoundingClientRect();
      if (!other || other.width <= 0 || other.height <= 0) continue;
      const overlapsRows = other.top < rect.bottom - 1 && other.bottom > rect.top + 1;
      if (overlapsRows && (other.left >= rect.right - 1 || other.right <= rect.left + 1))
        return true;
    }
    return false;
  }

  #nearest(x: number, y: number): string | undefined {
    let best: string | undefined;
    let distance = Infinity;
    for (const [id, element] of this.ctx.marked) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) continue;
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const value = Math.hypot(dx, dy);
      // On a tie the innermost block wins: the destination then climbs to what accepts it.
      if (value < distance || (value === distance && best && this.#descends(best, id))) {
        best = id;
        distance = value;
      }
    }
    return best;
  }

  #choose(
    id: string,
    x: number,
    y: number,
    sourceId: string | undefined,
  ): { placement: Placement; rect: DOMRect; horizontal: boolean } | undefined {
    const element = this.ctx.marked.get(id);
    if (!element) return undefined;
    const rect = element.getBoundingClientRect();
    const horizontal = this.#horizontal(id, rect);
    const size = horizontal ? rect.width : rect.height;
    const offset = horizontal ? x - rect.left : y - rect.top;
    const ratio = size > 0 ? Math.max(0, Math.min(1, offset / size)) : 0;
    const edge: Placement = ratio < 0.5 ? 'before' : 'after';
    const other: Placement = edge === 'before' ? 'after' : 'before';
    const inside = this.ctx.regions.get(id)?.container === true;
    const order: Placement[] =
      inside && ratio > EDGE && ratio < 1 - EDGE ? ['inside', edge] : [edge, 'inside'];
    for (const placement of order)
      if ((placement !== 'inside' || inside) && this.#allowed(id, placement, sourceId))
        return { placement, rect, horizontal };
    // Only the far edge of this block is valid: it is still the block under the pointer.
    return this.#allowed(id, other, sourceId) ? { placement: other, rect, horizontal } : undefined;
  }

  /**
   * Finds the destination under a point of the frame and shows it, or shows nothing. A file
   * held over an image replaces that image instead of landing next to it.
   */
  resolve(x: number, y: number, sourceId?: string, file = false): void {
    this.clear();
    if (
      this.ctx.readOnly ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x > innerWidth ||
      y > innerHeight
    )
      return;
    if (!this.ctx.marked.size) {
      if (!sourceId) this.#drawEnd();
      return;
    }
    const under = this.ctx.regionFrom(this.ctx.elementAt(x, y));
    if (file && !sourceId && under && this.ctx.regions.get(under)?.media === 'image') {
      const rect = this.ctx.marked.get(under)?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        this.#destination = { replace: under };
        this.#draw('inside', rect, false);
        this.#label.textContent = this.ctx.cfg.labels.replace;
        return;
      }
    }
    let id = under ?? this.#nearest(x, y);
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      if (!sourceId || !this.#descends(sourceId, id)) {
        const choice = this.#choose(id, x, y, sourceId);
        if (choice) {
          this.#destination = { targetId: id, placement: choice.placement };
          this.#draw(choice.placement, choice.rect, choice.horizontal);
          return;
        }
      }
      id = this.ctx.parentOf(id);
    }
  }

  #drawEnd(): void {
    this.#destination = { end: true };
    this.#show('inside', 8, 8, Math.max(12, innerWidth - 16), Math.max(12, innerHeight - 16));
  }

  #draw(placement: Placement, rect: DOMRect, horizontal: boolean): void {
    if (placement === 'inside') {
      const top = Math.max(0, rect.top);
      this.#show(
        placement,
        Math.max(0, rect.left),
        top,
        Math.min(innerWidth, Math.max(12, rect.width)),
        Math.max(8, Math.min(innerHeight - top, rect.bottom - top)),
      );
    } else if (horizontal) {
      const left = placement === 'before' ? rect.left - 1 : rect.right - 2;
      this.#show(placement, Math.max(0, Math.min(left, innerWidth - 3)), rect.top, 3, rect.height);
    } else {
      const top = placement === 'before' ? rect.top - 1 : rect.bottom - 2;
      this.#show(
        placement,
        Math.max(0, rect.left),
        Math.max(0, Math.min(top, innerHeight - 3)),
        Math.min(innerWidth, Math.max(12, rect.width)),
        3,
      );
    }
  }

  #show(placement: Placement, left: number, top: number, width: number, height: number): void {
    this.#marker.hidden = false;
    this.#marker.classList.toggle('is-inside', placement === 'inside');
    this.#marker.classList.toggle('is-low', top < 22);
    this.#marker.style.left = `${left}px`;
    this.#marker.style.top = `${top}px`;
    this.#marker.style.width = `${width}px`;
    this.#marker.style.height = `${height}px`;
    this.#label.textContent = this.ctx.cfg.labels[placement];
  }
}
