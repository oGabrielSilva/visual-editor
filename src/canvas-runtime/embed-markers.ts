import type { BlockDrag } from './block-drag';
import type { CanvasContext } from './context';
import type { ControlsOverlay } from './overlay';

const LIMIT = 40;
const EMBEDS = 'iframe,embed,object';

/**
 * Embedded content never loads inside the editor, and a click on a frame would not reach this
 * document anyway. Each one on screen gets a marker drawn over it, which selects, moves and opens
 * the menu of the block it stands for.
 */
export class EmbedMarkers {
  readonly #markers = new Map<Element, HTMLElement>();
  readonly #boxes = new WeakMap<HTMLElement, string>();
  readonly #layer: HTMLElement;

  constructor(
    private readonly ctx: CanvasContext,
    private readonly overlay: ControlsOverlay,
    private readonly drag: BlockDrag,
  ) {
    this.#layer = overlay.node('div', 'embeds');
    // Below the boxes, the bar and the marker of a drop.
    overlay.shadow.insertBefore(this.#layer, overlay.shadow.children[1] ?? null);
    ctx.onMeasure(() => this.#measure());
  }

  #create(embed: Element): HTMLElement {
    const marker = this.overlay.node('div', 'embed');
    const icon = this.overlay.icon('app-window', 18);
    const label = this.overlay.node('span', 'embed-label');
    label.textContent = this.ctx.cfg.labels.embed;
    // The icon comes from the generated subset; the label is text of the host shell.
    if (icon) marker.innerHTML = icon;
    marker.append(label);
    const id = (): string | undefined => this.ctx.regionFrom(embed);
    const signal = this.ctx.signal;
    marker.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType !== 'touch') this.drag.start(event, id(), marker);
      },
      { signal },
    );
    marker.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.drag.consumeClick()) this.ctx.select(id());
      },
      { signal },
    );
    marker.addEventListener(
      'contextmenu',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const target = id();
        if (!target || this.ctx.readOnly) return;
        this.ctx.marked.get(target)?.focus({ preventScroll: true });
        this.ctx.select(target);
        // Without a block menu in the host, the press only selects the embedded content.
        if (this.ctx.cfg.menu === false) return;
        this.ctx.send('context-menu', {
          nodeId: target,
          x: Math.max(0, Math.min(event.clientX, innerWidth)),
          y: Math.max(0, Math.min(event.clientY, innerHeight)),
        });
      },
      { signal },
    );
    this.#layer.append(marker);
    return marker;
  }

  #measure(): void {
    const seen = new Set<Element>();
    let drawn = 0;
    for (const embed of document.querySelectorAll(EMBEDS)) {
      if (drawn >= LIMIT) break;
      const rect = embed.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || rect.bottom <= 0 || rect.top >= innerHeight)
        continue;
      drawn += 1;
      seen.add(embed);
      const marker = this.#markers.get(embed) ?? this.#create(embed);
      this.#markers.set(embed, marker);
      // Written only when it changed: a marker which is rewritten on every measure is never
      // at rest for whoever waits to click it.
      const box = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
      if (this.#boxes.get(marker) !== box) {
        this.#boxes.set(marker, box);
        marker.style.left = `${rect.left}px`;
        marker.style.top = `${rect.top}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${rect.height}px`;
      }
    }
    for (const [embed, marker] of this.#markers) {
      if (seen.has(embed)) continue;
      marker.remove();
      this.#markers.delete(embed);
    }
  }
}
