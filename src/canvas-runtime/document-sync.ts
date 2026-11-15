import type { CanvasBridgeRegion } from '../renderers/canvas-bridge';
import type { BlockDrag } from './block-drag';
import { isRegion } from './context';
import type { CanvasContext } from './context';
import type { DropTargets } from './drop-targets';
import type { ImageTools } from './image-tools';
import { DocumentMorph } from './morph';
import type { SelectionLayer } from './selection-layer';
import type { TextSession } from './text-session';

export interface DocumentSyncParts {
  readonly text: TextSession;
  readonly drag: BlockDrag;
  readonly targets: DropTargets;
  readonly selection: SelectionLayer;
  readonly images: ImageTools;
}

/** Brings the next validated revision into the window which is already running. */
export class DocumentSync {
  readonly #morph: DocumentMorph;

  constructor(
    private readonly ctx: CanvasContext,
    private readonly parts: DocumentSyncParts,
  ) {
    this.#morph = new DocumentMorph({
      keep: (node) =>
        node === ctx.controls || (node instanceof Element && node.localName === 'script'),
      frozen: (element) => element === parts.text.element(),
    });
  }

  apply(message: Record<string, unknown>): void {
    const { ctx } = this;
    const { text, drag, targets, selection, images } = this.parts;
    if (
      typeof message.html !== 'string' ||
      typeof message.revision !== 'number' ||
      !Number.isSafeInteger(message.revision) ||
      message.revision < 0 ||
      typeof message.readOnly !== 'boolean' ||
      !Array.isArray(message.regions) ||
      message.regions.length > 100_000 ||
      !message.regions.every(isRegion)
    )
      return;
    const sameRevision = message.revision === ctx.channel.revision;
    const focusedId =
      document.hasFocus() && document.activeElement instanceof Element
        ? ctx.regionFrom(document.activeElement)
        : undefined;
    // The same revision (read-only toggled, labels) never discards a text being edited; another
    // revision ends it: a changed text was confirmed by the host, a clean one opens again.
    const reopen = sameRevision ? undefined : text.supersede();
    drag.cancel();
    // The host already expects this revision, including for the answer to a failure.
    ctx.channel.revision = message.revision;
    try {
      this.#morph.apply(message.html);
      ctx.setRegions(message.regions as CanvasBridgeRegion[]);
      if (ctx.marked.size !== ctx.regions.size) throw new Error('MORPH_INCOMPLETE');
    } catch {
      ctx.channel.defer(undefined);
      ctx.send('morph-failed', {});
      return;
    }
    ctx.readOnly = message.readOnly;
    if (!sameRevision) text.forgetRefusals();
    text.setEditable();
    targets.reset();
    images.documentChanged();
    const selected = ctx.selectedId;
    ctx.selectedId = undefined;
    selection.highlight(selected);
    ctx.send('ready', {});
    const intent = ctx.channel.takeDeferred();
    if (intent) intent();
    else if (reopen && text.editable(reopen)) text.begin(reopen, 'end');
    // A block moved by the keyboard keeps the focus which moved it.
    else if (focusedId && !text.active && document.activeElement !== ctx.marked.get(focusedId))
      ctx.marked.get(focusedId)?.focus({ preventScroll: true });
    ctx.schedule();
  }
}
