import type { CanvasBridgeConfiguration } from '../renderers/canvas-bridge';
import { RICH_TEXT_COMMANDS, RICH_TEXT_LIMITS } from '../rich-text/commands';
import type { RichTextCommandName } from '../rich-text/commands';
import { ActionBar } from './action-bar';
import { BlockDrag } from './block-drag';
import { CanvasContext } from './context';
import { DocumentSync } from './document-sync';
import { DropTargets } from './drop-targets';
import { EmbedMarkers } from './embed-markers';
import { FileGuard } from './file-guard';
import { ImageTools } from './image-tools';
import { KeyboardIntents } from './keyboard';
import { ControlsOverlay } from './overlay';
import { PointerIntents } from './pointer-intents';
import { SelectionLayer } from './selection-layer';
import { TextSession } from './text-session';
import { ViewportRestorer } from './viewport';
import { VariableMarks } from './variable-marks';

const CHALLENGE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The only executable code of the opaque preview. It composes the modules of the runtime and
 * routes the messages of the host; each interaction lives in its own module.
 */
export function installCanvasBridge(cfg: CanvasBridgeConfiguration): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installCanvasBridge(cfg), { once: true });
    return;
  }
  const overlay = new ControlsOverlay(cfg);
  const ctx = new CanvasContext(cfg, overlay.element);
  const signal = ctx.signal;
  const editingId = (): string | undefined => text.id;
  const selection: SelectionLayer = new SelectionLayer(ctx, overlay, editingId);
  const text: TextSession = new TextSession(ctx, (id) => selection.highlight(id));
  const targets = new DropTargets(ctx, overlay);
  const bar: ActionBar = new ActionBar(ctx, overlay, {
    edit: () => text.begin(ctx.selectedId, 'end'),
    grab: (event) => drag.grab(event),
    editingId,
  });
  const drag: BlockDrag = new BlockDrag(ctx, targets, text, bar.handle);
  const images = new ImageTools(ctx, overlay);
  new EmbedMarkers(ctx, overlay, drag);
  const viewport = new ViewportRestorer(ctx);
  new PointerIntents(ctx, text, drag);
  new FileGuard(ctx);
  new VariableMarks(ctx, overlay);
  new KeyboardIntents(ctx, text, drag, viewport, images);
  const sync = new DocumentSync(ctx, { text, drag, targets, selection, images });

  const textCommand = (message: Record<string, unknown>): void => {
    if (
      typeof message.command !== 'string' ||
      !(RICH_TEXT_COMMANDS as readonly string[]).includes(message.command) ||
      !(
        message.value === undefined ||
        message.value === null ||
        (typeof message.value === 'string' && message.value.length <= RICH_TEXT_LIMITS.commandValue)
      )
    )
      return;
    text.run(message.command as RichTextCommandName, message.value ?? null);
  };
  const handlers: Readonly<Record<string, (message: Record<string, unknown>) => void>> = {
    highlight: (message) => {
      if (message.nodeId !== undefined && typeof message.nodeId !== 'string') return;
      if (drag.sourceId && message.nodeId !== drag.sourceId) drag.cancel();
      // The host selected another block (the tree, the path): a size the keys left goes now.
      if (message.nodeId !== ctx.selectedId) images.flushKeys();
      selection.highlight(message.nodeId);
    },
    targets: (message) => targets.setMovement(message.sourceId, message.targets),
    'insertion-targets': (message) => targets.setInsertion(message.targets),
    hover: (message) => {
      if (message.nodeId === undefined || typeof message.nodeId === 'string')
        selection.hover(message.nodeId);
    },
    measure: () => ctx.schedule(),
    theme: (message) => overlay.theme(message.theme),
    'text-focus': () => text.focus('keep'),
    'text-open': (message) => {
      const id = message.nodeId;
      if (typeof id === 'string') text.end('finish', () => text.begin(id, 'end'));
    },
    'text-command': textCommand,
    'text-rejected': (message) => {
      if (typeof message.nodeId !== 'string' || text.id !== message.nodeId) return;
      if (message.reason === 'begin') text.reject(message.nodeId);
      else text.resume(message.nodeId);
    },
    focus: (message) => {
      if (typeof message.nodeId === 'string')
        ctx.marked.get(message.nodeId)?.focus({ preventScroll: true });
    },
    viewport: (message) => viewport.request(message.x, message.y),
    insertion: (message) => drag.insertion(message.phase, message.x, message.y, message.file),
  };
  window.addEventListener(
    'message',
    (event: MessageEvent<unknown>) => {
      if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
      const message = event.data as Record<string, unknown>;
      // After every load of its frame the host asks, without any secret, who is in the window.
      // Only this runtime can answer with the secret; a page which took the window cannot.
      if (message.type === 'hello' && message.nonce === undefined) {
        if (typeof message.challenge === 'string' && CHALLENGE.test(message.challenge))
          ctx.send('ready', { challenge: message.challenge });
        return;
      }
      if (message.nonce !== cfg.nonce || typeof message.type !== 'string') return;
      if (message.type === 'document') {
        sync.apply(message);
        return;
      }
      if (message.revision !== ctx.channel.revision) return;
      if (Object.hasOwn(handlers, message.type)) handlers[message.type]?.(message);
    },
    { signal },
  );

  const interrupt = (): void => {
    viewport.cancelDeferred();
    drag.interrupt();
    // The host may act on the draft next (save, panel, undo): hand it the latest text now.
    ctx.channel.flushDraft();
  };
  window.addEventListener('blur', interrupt, { signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') interrupt();
    },
    { signal },
  );
  // The keyboard came back to the frame: it belongs to the text which is open.
  window.addEventListener('focus', () => text.reclaim(), { signal });
  const observer = new ResizeObserver(() => ctx.schedule());
  observer.observe(document.body);
  window.addEventListener(
    'pagehide',
    () => {
      interrupt();
      observer.disconnect();
      ctx.dispose();
    },
    { once: true },
  );
  ctx.send('ready', {});
  ctx.schedule();
}
