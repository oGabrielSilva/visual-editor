import type { CanvasContext } from './context';

export type NavigationCommand = 'selectPrevious' | 'selectNext' | 'selectParent' | 'selectChild';

const MARGIN = 16;

/**
 * Moves the selection with the arrows: up and down to the sibling before or after (or to the
 * block next to it in the document when there is none), left to the block which contains it,
 * right into its first block. Only blocks of the revision on screen are visited, in the order
 * the piece shows them; the page scrolls only as far as needed to show the block reached.
 */
export class BlockNavigation {
  /** The block the last arrow reached, before the host confirms it as the selection. */
  #reached: string | undefined;

  constructor(private readonly ctx: CanvasContext) {}

  /**
   * Where the next arrow starts: the block the previous arrow reached while it still holds the
   * keyboard, otherwise the selected block, otherwise the focused one.
   */
  origin(focused: string | undefined): string | undefined {
    if (focused && focused === this.#reached) return focused;
    return this.ctx.selectedId ?? focused;
  }

  /** A block the person can see: one with a box, not hidden, not inside a closed `details`. */
  visible(id: string): boolean {
    const element = this.ctx.marked.get(id);
    if (!element || !element.getClientRects().length) return false;
    const check = (element as Element & { checkVisibility?: (options?: object) => boolean })
      .checkVisibility;
    if (typeof check === 'function')
      return check.call(element, { checkVisibilityCSS: true, visibilityProperty: true });
    return getComputedStyle(element).visibility !== 'hidden';
  }

  /** The closest visible block which contains `id`. */
  #parent(id: string): string | undefined {
    const seen = new Set<string>();
    let parent = this.ctx.parentOf(id);
    while (parent && !seen.has(parent) && !this.visible(parent)) {
      seen.add(parent);
      parent = this.ctx.parentOf(parent);
    }
    return parent;
  }

  /** The visible block an arrow leads to from `id`, or nothing at the edges of the piece. */
  target(id: string, command: NavigationCommand): string | undefined {
    const ctx = this.ctx;
    const element = ctx.marked.get(id);
    if (!element) return undefined;
    if (command === 'selectParent') return this.#parent(id);
    // Hidden blocks are never reached: the keyboard could not stay on them.
    const order = [...ctx.marked.keys()].filter(
      (candidate) => candidate === id || this.visible(candidate),
    );
    if (command === 'selectChild')
      return order.find((candidate) => candidate !== id && this.#parent(candidate) === id);
    const parent = this.#parent(id);
    const siblings = order.filter((candidate) => this.#parent(candidate) === parent);
    const position = siblings.indexOf(id);
    const sibling = siblings[position + (command === 'selectNext' ? 1 : -1)];
    if (sibling) return sibling;
    const index = order.indexOf(id);
    if (command === 'selectNext')
      // The next block outside this one: what follows its last descendant.
      return order
        .slice(index + 1)
        .find((candidate) => !element.contains(ctx.marked.get(candidate) ?? null));
    // The block before, unless it is one which contains this one.
    return order
      .slice(0, index)
      .reverse()
      .find((candidate) => !ctx.marked.get(candidate)?.contains(element));
  }

  /** Selects the block an arrow leads to, gives it the keyboard and brings it into view. */
  go(id: string, command: NavigationCommand): boolean {
    const next = this.target(id, command);
    const element = next ? this.ctx.marked.get(next) : undefined;
    if (!next || !element) return false;
    this.#reached = next;
    this.ctx.select(next);
    element.focus({ preventScroll: true });
    this.reveal(element);
    return true;
  }

  /**
   * Scrolls the piece the least needed for the block to be seen; never the host page. A block
   * without a box, or fixed to the window, is not brought anywhere by scrolling.
   */
  reveal(element: Element): void {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return;
    for (
      let node: Element | null = element;
      node && node !== document.body;
      node = node.parentElement
    )
      if (getComputedStyle(node).position === 'fixed') return;
    let delta = 0;
    if (rect.top < MARGIN) delta = rect.top - MARGIN;
    else if (rect.bottom > innerHeight - MARGIN)
      delta = Math.min(rect.bottom - innerHeight + MARGIN, rect.top - MARGIN);
    if (delta) scrollBy(0, delta);
  }
}
