import { SELECTED_ATTRIBUTE } from '../core/canvas-contract';
import type { CanvasContext } from './context';
import type { ControlsOverlay } from './overlay';

interface Box {
  readonly root: HTMLElement;
  readonly tag: HTMLElement;
}

/**
 * Shows which block is under the pointer and which one is selected: a thin box, the friendly
 * name of the block and, on the hovered one, the button which asks the host for a new block.
 */
export class SelectionLayer {
  readonly #hover: Box;
  readonly #plus: HTMLButtonElement;
  #hoverId: string | undefined;
  #coarse = matchMedia('(pointer:coarse)');
  /** Distance from the pointer to the insertion button on the previous move, while it is shown. */
  #reach: number | undefined;
  #held: number | undefined;
  #last: { x: number; y: number } | undefined;

  constructor(
    private readonly ctx: CanvasContext,
    private readonly overlay: ControlsOverlay,
    private readonly editingId: () => string | undefined,
  ) {
    this.#hover = this.#box('box is-hover');
    this.#plus = overlay.button(ctx.cfg.labels.add, 'plus', ctx.signal, () =>
      this.#requestInsert(),
    );
    this.#plus.className = 'plus';
    this.#hover.root.append(this.#plus);
    overlay.shadow.append(this.#hover.root);
    document.addEventListener('pointermove', (event) => this.#track(event), {
      capture: true,
      passive: true,
      signal: ctx.signal,
    });
    document.documentElement.addEventListener('pointerleave', () => this.hover(undefined), {
      signal: ctx.signal,
    });
    ctx.signal.addEventListener('abort', () => this.#release(), { once: true });
    ctx.onMeasure(() => this.#measure());
  }

  get hoverId(): string | undefined {
    return this.#hoverId;
  }

  #box(className: string): Box {
    const root = this.overlay.node('div', className);
    const tag = this.overlay.node('span', 'tag');
    root.hidden = true;
    root.append(tag);
    return { root, tag };
  }

  #track(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    // Over the trusted controls the pointer still belongs to the block they were drawn for.
    if (this.ctx.isControls(event)) {
      this.#release();
      return;
    }
    const heading = this.#approaching(event);
    const next = event.target instanceof Element ? this.ctx.regionFrom(event.target) : undefined;
    if (next !== this.#hoverId && heading) {
      // The pointer left the block on its way to the button: keep the block until it arrives
      // or stops, instead of moving the button away from under it.
      this.#release();
      this.#held = window.setTimeout(() => this.hover(next), SelectionLayer.#HOLD);
      return;
    }
    this.hover(next);
  }

  static readonly #HOLD = 400;

  /**
   * True while the pointer is travelling towards the visible insertion button: at least half
   * of each move brings it closer. Measured on every move, inside the block as well, so the
   * first move across the edge already knows where the pointer was heading.
   */
  #approaching(event: PointerEvent): boolean {
    const last = this.#last;
    this.#last = { x: event.clientX, y: event.clientY };
    if (this.#plus.hidden || this.#hover.root.hidden) {
      this.#reach = undefined;
      return false;
    }
    const rect = this.#plus.getBoundingClientRect();
    const distance = Math.hypot(
      event.clientX - (rect.left + rect.width / 2),
      event.clientY - (rect.top + rect.height / 2),
    );
    const previous = this.#reach;
    this.#reach = distance;
    if (previous === undefined || !last) return false;
    const moved = Math.hypot(event.clientX - last.x, event.clientY - last.y);
    return moved > 0 && previous - distance >= moved / 2;
  }

  #release(): void {
    if (this.#held !== undefined) window.clearTimeout(this.#held);
    this.#held = undefined;
  }

  hover(id: string | undefined): void {
    this.#release();
    const next = id && this.ctx.marked.has(id) ? id : undefined;
    if (next === this.#hoverId) return;
    this.#hoverId = next;
    this.#reach = undefined;
    this.ctx.schedule();
  }

  highlight(id: string | undefined): void {
    const ctx = this.ctx;
    if (ctx.selectedId) ctx.marked.get(ctx.selectedId)?.removeAttribute(SELECTED_ATTRIBUTE);
    ctx.selectedId = id && ctx.regions.has(id) ? id : undefined;
    if (ctx.selectedId) ctx.marked.get(ctx.selectedId)?.setAttribute(SELECTED_ATTRIBUTE, 'true');
    this.#appearance();
    ctx.schedule();
  }

  /** Where the insertion button is drawn: the hovered block, or the selected one on touch. */
  #insertId(): string | undefined {
    return this.#hoverId ?? (this.#coarse.matches ? this.ctx.selectedId : undefined);
  }

  #requestInsert(): void {
    const id = this.#insertId();
    const element = id ? this.ctx.marked.get(id) : undefined;
    if (!id || !element || this.ctx.readOnly) return;
    const rect = element.getBoundingClientRect();
    // The host opens its picker only for the selected block, in a frame which holds the keyboard.
    if (id !== this.ctx.selectedId) this.ctx.select(id);
    if (!document.hasFocus()) element.focus({ preventScroll: true });
    this.ctx.send('insert-request', {
      nodeId: id,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }

  #place(box: Box, id: string | undefined): DOMRect | undefined {
    const element = id ? this.ctx.marked.get(id) : undefined;
    const rect = element?.getBoundingClientRect();
    if (!id || !rect || rect.bottom <= 0 || rect.top >= innerHeight || rect.width <= 0) {
      box.root.hidden = true;
      return undefined;
    }
    box.root.hidden = false;
    box.root.style.left = `${rect.left}px`;
    box.root.style.top = `${rect.top}px`;
    box.root.style.width = `${rect.width}px`;
    box.root.style.height = `${rect.height}px`;
    const text = this.ctx.regions.get(id)?.label ?? '';
    box.tag.hidden = !text;
    box.tag.textContent = text;
    box.tag.classList.toggle('is-inside', rect.top < 22);
    return rect;
  }

  #measure(): void {
    const ctx = this.ctx;
    if (ctx.disposed) return;
    const selectedId = ctx.selectedId;
    const selected = selectedId ? ctx.marked.get(selectedId) : undefined;
    if (selectedId && selected) {
      const rect = selected.getBoundingClientRect();
      ctx.channel.telemetry('geometry', {
        nodeId: selectedId,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { x: scrollX, y: scrollY },
      });
    } else if (!selectedId)
      ctx.channel.telemetry('viewport', { viewport: { x: scrollX, y: scrollY } });
    const insertId = this.#insertId();
    const hoverId = ctx.dragging ? undefined : (this.#hoverId ?? insertId);
    const hovered = this.#place(this.#hover, hoverId);
    // The selected block already has its outline and its name in the action bar.
    const own = hoverId === selectedId;
    this.#hover.root.classList.toggle('is-selected', own);
    if (own) this.#hover.tag.hidden = true;
    this.#plus.hidden =
      !hovered || ctx.readOnly || hoverId !== insertId || hoverId === this.editingId();
  }

  /** What the selected block looks like, for inherited values in the panel: once per change. */
  #appearance(): void {
    const id = this.ctx.selectedId;
    const element = id ? this.ctx.marked.get(id) : undefined;
    if (!id || !element) return;
    const style = getComputedStyle(element);
    const color = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(style.color);
    if (!color) return;
    const size = Math.max(1, Math.min(160, parseFloat(style.fontSize) || 16));
    const first = style.fontFamily
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '')
      .toLowerCase();
    const font = this.ctx.cfg.fonts?.find((candidate) => candidate.toLowerCase() === first);
    const alignment = style.textAlign;
    const rtl = style.direction === 'rtl';
    this.ctx.send('appearance', {
      nodeId: id,
      style: {
        size,
        lineHeight:
          style.lineHeight === 'normal'
            ? 'normal'
            : Math.max(1, Math.min(500, parseFloat(style.lineHeight) || size)),
        weight: Math.max(100, Math.min(900, parseInt(style.fontWeight) || 400)),
        color: [
          Math.min(255, Number(color[1])),
          Math.min(255, Number(color[2])),
          Math.min(255, Number(color[3])),
          color[4] === undefined ? 1 : Math.min(1, Number(color[4])),
        ],
        family: /mono/i.test(style.fontFamily)
          ? 'monospace'
          : /(?:^|[, ])["']?(?:georgia|times|serif|-webkit-standard)/i.test(style.fontFamily) &&
              !/sans-serif/i.test(style.fontFamily)
            ? 'serif'
            : 'sans-serif',
        ...(font ? { font } : {}),
        align: ['right', 'center', 'justify'].includes(alignment)
          ? alignment
          : alignment === 'end'
            ? rtl
              ? 'left'
              : 'right'
            : alignment === 'start' && rtl
              ? 'right'
              : 'left',
        direction: rtl ? 'rtl' : 'ltr',
      },
    });
  }
}
