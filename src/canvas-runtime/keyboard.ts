import type { BlockDrag } from './block-drag';
import type { CanvasContext } from './context';
import type { ImageTools } from './image-tools';
import { BlockNavigation } from './navigation';
import { matchEditorShortcut } from './shared/shortcuts';
import type { TextSession } from './text-session';
import type { ViewportRestorer } from './viewport';

/**
 * Keys pressed while the frame holds the keyboard. The shortcuts are the ones of the shell: the
 * frame only forwards what it cannot do itself, as a typed intent.
 */
export class KeyboardIntents {
  readonly #navigation: BlockNavigation;

  constructor(
    private readonly ctx: CanvasContext,
    private readonly text: TextSession,
    private readonly drag: BlockDrag,
    private readonly viewport: ViewportRestorer,
    private readonly images: ImageTools,
  ) {
    this.#navigation = new BlockNavigation(ctx);
    document.addEventListener('keydown', (event) => this.#key(event), {
      capture: true,
      signal: ctx.signal,
    });
  }

  #key(event: KeyboardEvent): void {
    const { ctx, text } = this;
    this.viewport.cancelDeferred();
    const gesture = !!this.drag.sourceId || ctx.dragging;
    if (event.key === 'Escape') this.drag.cancel();
    const shortcut = matchEditorShortcut(event);
    if (shortcut === 'save') {
      // Saving belongs to the host, which first asks this frame for the text being edited.
      event.preventDefault();
      // A size the keys left goes first, and the save waits for its revision: saved together
      // with a change still being applied, the save would be refused.
      this.images.flushKeys();
      if (!ctx.readOnly)
        this.images.afterAnswer(() => {
          if (!ctx.disposed && !ctx.readOnly) ctx.send('shortcut', { command: 'save' });
        });
      return;
    }
    if (ctx.isControls(event) || text.contains(event.target)) return;
    // Escape after resize keys drops the size not yet sent; it does not climb to the parent.
    if (event.key === 'Escape' && !gesture && this.images.dropKeys()) {
      event.preventDefault();
      return;
    }
    // A burst of resize keys is one change; any other key first sends the size it left.
    if (
      shortcut !== 'shrinkImage' &&
      shortcut !== 'growImage' &&
      !['Shift', 'Alt', 'Control', 'Meta', 'AltGraph'].includes(event.key)
    )
      this.images.flushKeys();
    if (event.key === 'Escape') {
      if (!gesture && !text.active) ctx.select(ctx.parentOf(ctx.selectedId));
      return;
    }
    const editing = text.active;
    // An engine may refuse to focus the text from a script until a key is pressed in the frame:
    // this key gives the keyboard back to the text which is open.
    text.reclaim();
    const id =
      event.target instanceof Element
        ? (ctx.regionFrom(event.target) ?? ctx.selectedId)
        : ctx.selectedId;
    const ask = (action: 'up' | 'down' | 'duplicate' | 'remove'): void => {
      event.preventDefault();
      // The host only changes the selected block: the focused one is selected first.
      if (id !== ctx.selectedId) ctx.select(id);
      ctx.send('action', { nodeId: id, action });
    };
    const element = id ? ctx.marked.get(id) : undefined;
    const from =
      shortcut === 'selectPrevious' ||
      shortcut === 'selectNext' ||
      shortcut === 'selectParent' ||
      shortcut === 'selectChild'
        ? this.#navigation.origin(
            event.target instanceof Element ? ctx.regionFrom(event.target) : undefined,
          )
        : undefined;
    if (
      event.key === 'Tab' &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !editing &&
      id &&
      id === ctx.selectedId &&
      this.images.focusGrip(id)
    ) {
      // From the selected image the next stop is its resize grip, drawn in the layer above.
      event.preventDefault();
    } else if (
      from &&
      !editing &&
      !gesture &&
      (shortcut === 'selectPrevious' ||
        shortcut === 'selectNext' ||
        shortcut === 'selectParent' ||
        shortcut === 'selectChild')
    ) {
      // With a block in hand the arrows walk the blocks, never the page under them.
      event.preventDefault();
      this.#navigation.go(from, shortcut);
    } else if (
      id &&
      element &&
      !editing &&
      !gesture &&
      shortcut === 'menu' &&
      ctx.cfg.menu !== false
    ) {
      event.preventDefault();
      if (id !== ctx.selectedId) ctx.select(id);
      const rect = element.getBoundingClientRect();
      ctx.keyboardMenu = performance.now();
      ctx.send('context-menu', {
        nodeId: id,
        x: Math.max(0, Math.min(innerWidth, rect.left + 8)),
        y: Math.max(0, Math.min(innerHeight, rect.top + Math.min(rect.height, 24))),
        keyboard: true,
      });
    } else if (!ctx.readOnly && id && element && !editing && !gesture && shortcut === 'insert') {
      // The same request as the "+" of the block: the host opens its picker next to it.
      event.preventDefault();
      if (id !== ctx.selectedId) ctx.select(id);
      this.#navigation.reveal(element);
      const rect = element.getBoundingClientRect();
      ctx.send('insert-request', {
        nodeId: id,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        keyboard: true,
      });
    } else if (
      !ctx.readOnly &&
      id &&
      !editing &&
      (shortcut === 'shrinkImage' || shortcut === 'growImage')
    ) {
      event.preventDefault();
      if (id === ctx.selectedId) this.images.nudge(id, shortcut === 'growImage' ? 10 : -10);
    } else if (!ctx.readOnly && id && (shortcut === 'moveUp' || shortcut === 'moveDown'))
      ask(shortcut === 'moveUp' ? 'up' : 'down');
    else if (!ctx.readOnly && (shortcut === 'undo' || shortcut === 'redo')) {
      event.preventDefault();
      text.history(shortcut);
    } else if (!ctx.readOnly && id && !editing && shortcut === 'duplicate') ask('duplicate');
    else if (!ctx.readOnly && id && !editing && shortcut === 'remove') ask('remove');
    else if (shortcut === 'duplicate') event.preventDefault();
    else if (event.key === 'F2' || event.key === 'Enter') {
      event.preventDefault();
      ctx.select(id);
      text.begin(id, 'end');
    } else if (event.key === ' ') {
      event.preventDefault();
      ctx.select(id);
    } else if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    )
      event.preventDefault();
  }
}
