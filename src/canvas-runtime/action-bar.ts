import type { CanvasContext } from './context';
import type { ControlsOverlay } from './overlay';
import type { CanvasBlockAction } from '../core/canvas-contract';

export interface ActionBarEvents {
  /** The text of the selected block is opened for editing. */
  edit(): void;
  /** A press on the handle starts moving the selected block. */
  grab(event: PointerEvent, handle: HTMLElement): void;
  /** The element the bar must not cover while its text is being edited. */
  editingId(): string | undefined;
}

const GAP = 6;

/** The actions of the selected block, always next to it and never over a text being edited. */
export class ActionBar {
  readonly #toolbar: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly #edit: HTMLButtonElement;
  readonly #parent: HTMLButtonElement;
  readonly #image: HTMLButtonElement;
  readonly #name: HTMLElement;

  constructor(
    private readonly ctx: CanvasContext,
    private readonly overlay: ControlsOverlay,
    private readonly events: ActionBarEvents,
  ) {
    const labels = ctx.cfg.labels;
    this.#toolbar = overlay.node('div', 'toolbar');
    this.#toolbar.setAttribute('role', 'toolbar');
    this.#toolbar.setAttribute('aria-label', labels.edit);
    this.#toolbar.hidden = true;
    const add = (label: string, icon: string, action: () => void): HTMLButtonElement => {
      const button = overlay.button(label, icon, ctx.signal, action);
      this.#toolbar.append(button);
      return button;
    };
    const ask = (action: CanvasBlockAction) => (): void => {
      if (!ctx.readOnly && ctx.selectedId) ctx.send('action', { nodeId: ctx.selectedId, action });
    };
    this.#name = overlay.node('span', 'name');
    this.#toolbar.append(this.#name);
    this.handle = add(labels.move, 'grip-vertical', () => undefined);
    this.handle.className = 'handle';
    this.handle.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    this.#parent = add(labels.parent, 'corner-left-up', () =>
      ctx.select(ctx.parentOf(ctx.selectedId)),
    );
    this.#edit = add(labels.edit, 'square-pen', () => events.edit());
    add(labels.up, 'arrow-up', ask('up')).setAttribute('aria-keyshortcuts', 'Alt+ArrowUp');
    add(labels.down, 'arrow-down', ask('down')).setAttribute('aria-keyshortcuts', 'Alt+ArrowDown');
    add(labels.duplicate, 'copy', ask('duplicate')).setAttribute('aria-keyshortcuts', 'Control+D');
    this.#image = add(labels.image, 'image', ask('image'));
    // A block piece has no HTML of its own to edit: its host leaves the label out.
    if (labels.html) add(labels.html, 'code-xml', ask('html'));
    this.#toolbar.append(overlay.node('span', 'sep'));
    const remove = add(labels.remove, 'trash-2', ask('remove'));
    remove.classList.add('is-danger');
    remove.setAttribute('aria-keyshortcuts', 'Delete');
    overlay.shadow.append(this.#toolbar);
    this.handle.addEventListener('pointerdown', (event) => events.grab(event, this.handle), {
      signal: ctx.signal,
    });
    this.handle.addEventListener(
      'keydown',
      (event) => {
        if (
          ctx.readOnly ||
          !ctx.selectedId ||
          !event.altKey ||
          (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        ctx.send('action', {
          nodeId: ctx.selectedId,
          action: event.key === 'ArrowUp' ? 'up' : 'down',
        });
      },
      { signal: ctx.signal },
    );
    ctx.onMeasure(() => this.#measure());
  }

  #measure(): void {
    const ctx = this.ctx;
    const id = ctx.selectedId;
    const element = id ? ctx.marked.get(id) : undefined;
    if (ctx.disposed || ctx.readOnly || !id || !element) {
      this.#toolbar.hidden = true;
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight) {
      this.#toolbar.hidden = true;
      return;
    }
    const region = ctx.regions.get(id);
    const editing = this.events.editingId() === id;
    this.#edit.hidden = !region?.editable || editing;
    this.#parent.hidden = !ctx.parentOf(id);
    this.#image.hidden = region?.media !== 'image';
    this.#name.textContent = region?.label ?? '';
    this.#name.hidden = !region?.label;
    this.#toolbar.hidden = false;
    const bounds = this.#toolbar.getBoundingClientRect();
    // Above the block. Without room there, a text being edited keeps the bar below it, never
    // over it; any other block keeps the bar on its own top edge, so the next block stays free.
    const above = rect.top - bounds.height - GAP;
    const below = rect.bottom + GAP;
    const fits = above >= 4;
    const top = fits
      ? above
      : editing
        ? Math.min(below, innerHeight - bounds.height - 4)
        : Math.max(4, Math.min(rect.top, innerHeight - bounds.height - 4));
    // Out of the way of where reading and clicking start: the far side when it is not above.
    const side = fits ? rect.left : rect.right - bounds.width;
    const left = Math.max(4, Math.min(side, innerWidth - bounds.width - 4));
    this.#toolbar.style.left = `${left}px`;
    this.#toolbar.style.top = `${top}px`;
  }
}
