<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, shallowRef, ref, watch } from 'vue';
import { FORM_PREVIEWS } from '../services/form-preview';
import type { FramePreviewSource, SelectionPreview } from '../../renderers/selection-preview';
import { normalizePreviewLanguage, PREVIEW_FRAMESET } from '../../renderers/selection-preview';
import { FrameWindowGuard } from '../canvas/frame-window';
import type { CanvasBridgeLabels, CanvasBridgeTheme } from '../../renderers/canvas-bridge';
import type { CanvasRegion } from '../../core/canvas-layout';
import type { CanvasBlockAction } from '../../core/canvas-contract';
import { PreviewMessagePolicy } from '../../security/preview-message';
import type {
  CanvasBounds,
  CanvasEvent,
  CanvasViewport,
  CanvasTextState,
} from '../../security/preview-message';
import type { RichTextCommandName } from '../../rich-text/commands';
import type { CanvasTextStyle } from '../../security/text-presentation';

const props = defineProps<{
  /** The document shown, bound to its renderer: an HTML document or a block piece. */
  source: FramePreviewSource;
  selectedNodeId?: string;
  title: string;
  selectionLabel: string;
  readOnly?: boolean;
  labels?: CanvasBridgeLabels;
  isCurrent?: (identity: { id: string; revision: number }) => boolean;
  /** Test mode: the frame reports whether entering a text changed its appearance. */
  diagnostics?: boolean;
  getMovementTargets?: (
    id: string,
  ) => readonly { targetId: string; placements: readonly ('before' | 'after' | 'inside')[] }[];
  /** Friendly name of a selectable block, drawn next to it in the piece. */
  describe?: (region: CanvasRegion) => string | undefined;
  /** Colors of the shell for the controls drawn over the piece. */
  theme?: CanvasBridgeTheme | undefined;
  /** The host opens no block menu (a block piece): the frame never asks for one. */
  withoutMenu?: boolean;
  /**
   * A presentation of the same revision (the dark preview of a block piece): a new value
   * renders the window again although the revision did not change.
   */
  variant?: string;
  /** Friendly names of the variables of the host by key, shown over each `{{key}}`. */
  variables?: Readonly<Record<string, string>>;
}>();
const emit = defineEmits<{
  select: [id: string];
  appearance: [event: { nodeId: string; style: CanvasTextStyle }];
  /** The window was written again: whatever was mounted inside it is gone. */
  reset: [];
  /** The piece cannot be shown (`frameset`: a page of frames; `window`; `render`), or can again. */
  failure: [reason: 'frameset' | 'window' | 'render' | undefined];
  'text-unsupported': [id: string];
  'text-toolbar': [id: string];
  'text-begin': [id: string];
  'text-draft': [event: { nodeId: string; html: string }];
  'text-commit': [event: { nodeId: string; html: string }];
  'text-cancel': [id: string];
  'text-state': [event: { nodeId: string; state: CanvasTextState }];
  'text-fidelity': [changed: number];
  history: [direction: 'undo' | 'redo'];
  move: [event: { sourceId: string; targetId: string; placement: 'before' | 'after' | 'inside' }];
  action: [event: { nodeId: string; action: CanvasBlockAction }];
  insertion: [event: { targetId: string; placement: 'before' | 'after' | 'inside' } | 'end'];
  /** The "+" of a block: bounds of that block inside the frame. */
  'insert-request': [event: { nodeId: string; bounds: CanvasBounds; keyboard: boolean }];
  /** The secondary button on a block: a point inside the frame. */
  'context-menu': [event: { nodeId: string; x: number; y: number; keyboard: boolean }];
  /** An image file was dropped over this image of the piece. */
  'image-drop': [nodeId: string];
  /** A file from the system is dragged straight over the frame. */
  'file-drag': [];
  shortcut: [command: 'save'];
  'image-resize': [event: { nodeId: string; width: number; height: number }];
}>();
const frame = ref<HTMLIFrameElement>();
const preview = shallowRef<SelectionPreview>();
// The window is written once; later revisions are reconciled inside it by the runtime.
const srcdoc = shallowRef<string>();
const mounted = ref(false);
// A window rewritten before it answered is replaced by a new element: two sources assigned to
// the same frame in a row may leave it showing the first one.
const frameKey = ref(0);
const messages = new PreviewMessagePolicy();
let viewport: CanvasViewport = { x: 0, y: 0 };
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let pendingDraft: { nodeId: string; html: string } | undefined;
let documentId: string | undefined;
let written:
  | {
      documentId: string;
      renderer: object;
      selectionLabel: string;
      title: string;
      labels: CanvasBridgeLabels | undefined;
      describe: unknown;
      language: string | undefined;
    }
  | undefined;
let hostLanguage: string | undefined;
let languageObserver: MutationObserver | undefined;
let restoringViewport = false;
let bridgeReady = false;
let viewportReady = false;
let failed = false;
// A revision which arrives while the window is being asked who it is waits for the answer.
let renderQueued = false;
let recovery: { documentId: string; revision: number; attempts: number } | undefined;
// What crossed the boundary while the window was being asked who it is: a selection or a checked
// intent on its way in, a command on its way out.
const HELD_LIMIT = 200;
let held: {
  outgoing: Readonly<Record<string, unknown>>[];
  incoming: (string | CanvasEvent)[];
} = { outgoing: [], incoming: [] };
const guard = new FrameWindowGuard({
  ask: (challenge) => frame.value?.contentWindow?.postMessage({ type: 'hello', challenge }, '*'),
  lost: () => lose(),
});
/** Nothing is shown in place of the piece and nothing is posted until a window is written. */
function fail(reason: 'frameset' | 'window' | 'render'): void {
  guard.reset();
  held = { outgoing: [], incoming: [] };
  dropDraft();
  pendingFocus = undefined;
  bridgeReady = false;
  viewportReady = false;
  renderQueued = false;
  preview.value = undefined;
  if (srcdoc.value !== undefined) frameKey.value += 1;
  srcdoc.value = undefined;
  written = undefined;
  failed = true;
  emit('reset');
  emit('failure', reason);
}
/**
 * The window no longer holds the runtime: its secret is dropped, nothing more is posted to it
 * and a new window is written with a new secret. A document which keeps taking the window away
 * is not written a third time.
 */
function lose(): void {
  const current = { documentId: props.source.id, revision: props.source.revision };
  const attempts =
    recovery?.documentId === current.documentId && recovery.revision === current.revision
      ? recovery.attempts
      : 0;
  bridgeReady = false;
  preview.value = undefined;
  held = { outgoing: [], incoming: [] };
  if (attempts >= 2) {
    fail('window');
    return;
  }
  recovery = { ...current, attempts: attempts + 1 };
  // Never the same element: the window it shows is not the editor's any more.
  write();
}
let pendingFocus:
  | {
      documentId: string;
      revision: number;
      nonce: string;
      nodeId: string;
      origin: Element | null;
    }
  | undefined;
function permitsFocus(origin: Element | null): boolean {
  const element = frame.value;
  if (!element?.isConnected) return false;
  const ownerDocument = element.ownerDocument;
  const active = ownerDocument.activeElement;
  return active === origin || active === ownerDocument.body || active === element;
}
function restorePendingFocus(): void {
  const request = pendingFocus;
  const current = preview.value;
  if (!request || !current) return;
  if (
    !mounted.value ||
    request.documentId !== documentId ||
    request.revision !== current.revision ||
    request.nonce !== current.nonce ||
    request.nodeId !== props.selectedNodeId ||
    !current.nodeIds.includes(request.nodeId) ||
    (props.isCurrent && !props.isCurrent({ id: request.documentId, revision: request.revision })) ||
    !permitsFocus(request.origin)
  ) {
    pendingFocus = undefined;
    return;
  }
  if (!bridgeReady || !viewportReady) return;
  pendingFocus = undefined;
  frame.value?.focus({ preventScroll: true });
  post({ type: 'focus', nodeId: request.nodeId });
}
function focusChanged(): void {
  if (pendingFocus && !permitsFocus(pendingFocus.origin)) pendingFocus = undefined;
}
/** Drafts are coalesced: validating a text costs far more than receiving it. */
function flushDraft(): void {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = undefined;
  const draft = pendingDraft;
  pendingDraft = undefined;
  if (draft) emit('text-draft', draft);
}
function dropDraft(): void {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = undefined;
  pendingDraft = undefined;
}
// Pictures of the connected forms, when the host offers them; a new one draws the window again.
const formPreviews = inject(FORM_PREVIEWS, undefined);
function options() {
  return {
    readOnly: props.readOnly ?? false,
    title: props.title,
    ...(hostLanguage ? { lang: hostLanguage } : {}),
    ...(props.labels ? { labels: props.labels } : {}),
    ...(props.diagnostics ? { diagnostics: true } : {}),
    ...(props.withoutMenu ? { menu: false as const } : {}),
    ...(props.describe ? { describe: props.describe } : {}),
    ...(props.theme ? { theme: props.theme } : {}),
    ...(props.variables ? { variables: props.variables } : {}),
    ...(formPreviews ? { formPreview: formPreviews.lookup } : {}),
  };
}
/** A new window: the first load, another document or controller, or a failed reconciliation. */
function write(): void {
  if (srcdoc.value !== undefined && !bridgeReady) frameKey.value += 1;
  guard.reset();
  held = { outgoing: [], incoming: [] };
  renderQueued = false;
  dropDraft();
  pendingFocus = undefined;
  bridgeReady = false;
  viewportReady = false;
  restoringViewport = true;
  if (documentId !== props.source.id) viewport = { x: 0, y: 0 };
  documentId = props.source.id;
  written = {
    documentId: props.source.id,
    renderer: props.source.renderer,
    selectionLabel: props.selectionLabel,
    title: props.title,
    labels: props.labels,
    describe: props.describe,
    language: hostLanguage,
  };
  let next: SelectionPreview;
  try {
    next = props.source.build(props.selectionLabel, options());
  } catch (error: unknown) {
    // A piece which cannot be drawn is said so in its place, never left as an empty area.
    fail(error instanceof Error && error.message === PREVIEW_FRAMESET ? 'frameset' : 'render');
    return;
  }
  preview.value = next;
  srcdoc.value = next.html;
  emit('reset');
  if (failed) {
    failed = false;
    emit('failure', undefined);
  }
}
function render(): void {
  if (!mounted.value) return;
  if (guard.waiting) {
    renderQueued = true;
    return;
  }
  const current = preview.value;
  const target = frame.value?.contentWindow;
  if (
    !current ||
    !target ||
    !bridgeReady ||
    !written ||
    written.documentId !== props.source.id ||
    written.renderer !== props.source.renderer ||
    written.selectionLabel !== props.selectionLabel ||
    written.title !== props.title ||
    written.labels !== props.labels ||
    written.describe !== props.describe ||
    written.language !== hostLanguage
  ) {
    write();
    return;
  }
  let next: SelectionPreview;
  try {
    next = props.source.update(props.selectionLabel, current, options());
  } catch {
    // Never leave the window on a revision the host has left: write a new one instead.
    write();
    return;
  }
  preview.value = next;
  target.postMessage(
    {
      type: 'document',
      nonce: next.nonce,
      revision: next.revision,
      html: next.html,
      regions: next.regions,
      readOnly: next.readOnly,
    },
    '*',
  );
}
watch(
  [
    () => props.source.id,
    () => props.source.revision,
    () => props.source.renderer,
    () => props.selectionLabel,
    () => props.title,
    () => props.readOnly,
    () => props.labels,
    () => props.describe,
    () => props.variant,
    () => formPreviews?.version.value,
  ],
  render,
);
// A change of colors never rebuilds the window: the running controls take the new values.
watch(
  () => props.theme,
  (theme) => {
    if (theme && bridgeReady) post({ type: 'theme', theme });
  },
);

/**
 * Only a window whose runtime answered with the secret, since its last load, is posted to. What
 * the host has to say while the window is being asked who it is waits for the answer, and is
 * dropped with the window when none comes.
 */
function post(command: Readonly<Record<string, unknown>>): void {
  if (!preview.value || !bridgeReady) return;
  if (guard.waiting) {
    if (held.outgoing.length < HELD_LIMIT) held.outgoing.push(command);
    return;
  }
  frame.value?.contentWindow?.postMessage(
    { ...command, nonce: preview.value.nonce, revision: preview.value.revision },
    '*',
  );
}
function receive(event: MessageEvent<unknown>): void {
  if (
    !preview.value ||
    (props.isCurrent &&
      !props.isCurrent({ id: documentId ?? '', revision: preview.value.revision }))
  )
    return;
  const source = frame.value?.contentWindow;
  const host = {
    selectedNodeId: props.selectedNodeId,
    recentNodeId: recent && performance.now() < recent.until ? recent.id : undefined,
  };
  const id = messages.selection(event.data, event.source, source, preview.value);
  const intent = id
    ? undefined
    : messages.canvas(event.data, event.source, source, preview.value, host);
  if (guard.waiting) {
    // The frame loaded: until its runtime answers the question nothing is acted on. What was
    // already on its way is checked now, in its order, and kept for the answer.
    if (intent?.type === 'ready' && guard.confirm(intent.challenge)) {
      bridgeReady = true;
      loaded();
      const { outgoing, incoming } = held;
      held = { outgoing: [], incoming: [] };
      for (const command of outgoing) post(command);
      for (const entry of incoming) {
        if (typeof entry === 'string') select(entry);
        else dispatch(entry);
      }
      if (renderQueued) {
        renderQueued = false;
        render();
      }
    } else if (held.incoming.length < HELD_LIMIT) {
      if (id) held.incoming.push(id);
      else if (intent) held.incoming.push(intent);
    }
    return;
  }
  if (id) select(id);
  else if (intent) dispatch(intent);
}
/** The block selected before the current one, for a second: see `image-resize`. */
let recent: { id: string; until: number } | undefined;
/**
 * The frame asks for a menu or a picker only while it holds the keyboard: a press in it gives
 * it the focus. A request from a frame the person is not using is not shown, and only a request
 * made while it holds the keyboard counts as one of the keyboard.
 */
function holdsKeyboard(): boolean {
  const element = frame.value;
  return !!element && element.ownerDocument.activeElement === element;
}
function select(id: string): void {
  pendingFocus = undefined;
  emit('select', id);
}
function dispatch(intent: CanvasEvent): void {
  switch (intent.type) {
    case 'ready':
      bridgeReady = true;
      loaded();
      break;
    case 'viewport-restored':
      restoringViewport = false;
      viewportReady = bridgeReady;
      restorePendingFocus();
      break;
    case 'viewport':
      if (!restoringViewport) viewport = intent.viewport;
      break;
    case 'morph-failed':
      write();
      break;
    case 'geometry':
      if (!restoringViewport) viewport = intent.viewport;
      break;
    case 'appearance':
      emit('appearance', { nodeId: intent.nodeId, style: intent.style });
      break;
    case 'text-unsupported':
      emit('text-unsupported', intent.nodeId);
      break;
    case 'text-toolbar':
      emit('text-toolbar', intent.nodeId);
      break;
    case 'text-begin':
      pendingFocus = undefined;
      emit('text-begin', intent.nodeId);
      break;
    case 'text-draft':
      pendingDraft = { nodeId: intent.nodeId, html: intent.html };
      draftTimer ??= setTimeout(flushDraft, 40);
      break;
    case 'text-commit':
      dropDraft();
      pendingFocus = undefined;
      emit('text-commit', { nodeId: intent.nodeId, html: intent.html });
      break;
    case 'text-cancel':
      dropDraft();
      emit('text-cancel', intent.nodeId);
      break;
    case 'text-state':
      emit('text-state', {
        nodeId: intent.nodeId,
        state: {
          marks: intent.marks,
          styles: intent.styles,
          link: intent.link,
          href: intent.href,
          empty: intent.empty,
          canUndo: intent.canUndo,
          canRedo: intent.canRedo,
          rect: intent.rect,
        },
      });
      break;
    case 'text-fidelity':
      emit('text-fidelity', intent.changed);
      break;
    case 'history':
      pendingFocus = undefined;
      emit('history', intent.direction);
      break;
    case 'move':
      pendingFocus = undefined;
      emit('move', {
        sourceId: intent.sourceId,
        targetId: intent.targetId,
        placement: intent.placement,
      });
      break;
    case 'action':
      pendingFocus = undefined;
      emit('action', { nodeId: intent.nodeId, action: intent.action });
      break;
    case 'insertion':
      pendingFocus = undefined;
      emit('insertion', { targetId: intent.targetId, placement: intent.placement });
      break;
    case 'insertion-end':
      pendingFocus = undefined;
      emit('insertion', 'end');
      break;
    case 'insert-request':
      if (!holdsKeyboard()) break;
      emit('insert-request', {
        nodeId: intent.nodeId,
        bounds: intent.bounds,
        keyboard: intent.keyboard === true,
      });
      break;
    case 'context-menu':
      if (!holdsKeyboard()) break;
      pendingFocus = undefined;
      emit('context-menu', {
        nodeId: intent.nodeId,
        x: intent.x,
        y: intent.y,
        keyboard: intent.keyboard === true,
      });
      break;
    case 'file-drag':
      emit('file-drag');
      break;
    case 'image-drop':
      pendingFocus = undefined;
      emit('image-drop', intent.nodeId);
      break;
    case 'shortcut':
      emit('shortcut', intent.command);
      break;
    case 'image-resize':
      pendingFocus = undefined;
      emit('image-resize', {
        nodeId: intent.nodeId,
        width: intent.width,
        height: intent.height,
      });
      break;
  }
}
function highlight(): void {
  if (pendingFocus && pendingFocus.nodeId !== props.selectedNodeId) pendingFocus = undefined;
  post({ type: 'highlight', nodeId: props.selectedNodeId });
  if (props.selectedNodeId)
    post({
      type: 'targets',
      sourceId: props.selectedNodeId,
      targets: props.getMovementTargets?.(props.selectedNodeId) ?? [],
    });
}
function measure(): void {
  post({ type: 'measure' });
}
function restoreViewport(value: CanvasViewport): void {
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    value.x < 0 ||
    value.y < 0 ||
    value.x > 1_000_000 ||
    value.y > 1_000_000
  )
    return;
  viewport = { ...value };
  viewportReady = false;
  post({ type: 'viewport', ...viewport });
}
function textCommand(command: RichTextCommandName, value: string | null): void {
  post({ type: 'text-command', command, value });
}
function rejectText(nodeId: string, reason: 'begin' | 'draft' | 'commit'): void {
  post({ type: 'text-rejected', nodeId, reason });
}
/** Returns the keyboard to the text being edited inside the frame. */
function focusText(): void {
  frame.value?.focus({ preventScroll: true });
  post({ type: 'text-focus' });
}
function openText(nodeId: string): void {
  pendingFocus = undefined;
  if (!props.readOnly) post({ type: 'text-open', nodeId });
}
function focusNode(id: string, origin: Element | null = null): void {
  const current = preview.value;
  pendingFocus = undefined;
  if (
    !mounted.value ||
    !documentId ||
    !current?.nodeIds.includes(id) ||
    id !== props.selectedNodeId ||
    !permitsFocus(origin)
  )
    return;
  pendingFocus = {
    documentId,
    revision: current.revision,
    nonce: current.nonce,
    nodeId: id,
    origin,
  };
  restorePendingFocus();
}
/** `file`: an image file is dragged, which replaces an image it is dropped on. */
function trackInsertion(point: { x: number; y: number }, file = false): void {
  if (!props.readOnly) post({ type: 'insertion', phase: 'move', ...point, file });
}
function commitInsertion(point: { x: number; y: number }, file = false): void {
  if (!props.readOnly) post({ type: 'insertion', phase: 'drop', ...point, file });
}
/**
 * Gives the keyboard back to the selected block after a menu of the shell closes, unless the
 * person already took it elsewhere: only from the page itself, the frame, a menu still closing
 * or the trigger of the menu, which the primitive focuses as it closes.
 */
function returnFocus(origin: Element | null = null): void {
  const id = props.selectedNodeId;
  const element = frame.value;
  if (!id || !element) return;
  const active = element.ownerDocument.activeElement;
  const free =
    !active ||
    active === element.ownerDocument.body ||
    active === element ||
    active === origin ||
    active.classList.contains('editor-menu-anchor') ||
    // The menu which asked is still closing: its own search field or item.
    !!active.closest('[role="menu"]');
  if (free) focusNode(id, active);
}
function cancelInsertion(): void {
  post({ type: 'insertion', phase: 'cancel' });
}
/** Destinations a new block accepts, sent when a drag from the palette begins. */
function insertionTargets(
  targets: readonly { targetId: string; placements: readonly ('before' | 'after' | 'inside')[] }[],
): void {
  if (!props.readOnly) post({ type: 'insertion-targets', targets });
}
/** Shows in the piece the block the pointer rests on elsewhere in the shell, as in the tree. */
function hover(nodeId: string | undefined): void {
  if (!nodeId || preview.value?.nodeIds.includes(nodeId)) post({ type: 'hover', nodeId });
}
function getFrameElement(): HTMLIFrameElement | undefined {
  return frame.value;
}
/** The frame element finished a load: of the window just written, or of something else. */
function frameLoaded(): void {
  if (srcdoc.value === undefined || !preview.value) return;
  guard.loaded();
}
function loaded(): void {
  if (!viewportReady) restoreViewport(viewport);
  highlight();
  if (props.theme && bridgeReady) post({ type: 'theme', theme: props.theme });
}
watch(
  () => props.selectedNodeId,
  (_id, previous) => {
    recent = previous ? { id: previous, until: performance.now() + 1_000 } : undefined;
    highlight();
  },
);
onMounted(() => {
  const root = frame.value?.ownerDocument.documentElement;
  hostLanguage = normalizePreviewLanguage(root?.lang);
  if (root) {
    languageObserver = new MutationObserver(() => {
      const value = normalizePreviewLanguage(root.lang);
      if (value === hostLanguage) return;
      hostLanguage = value;
      render();
    });
    languageObserver.observe(root, { attributes: true, attributeFilter: ['lang'] });
  }
  mounted.value = true;
  render();
  window.addEventListener('message', receive);
  document.addEventListener('focusin', focusChanged, true);
  // The person is about to act in the host: it must see the latest text first.
  document.addEventListener('pointerdown', flushDraft, true);
  document.addEventListener('keydown', flushDraft, true);
});
onBeforeUnmount(() => {
  mounted.value = false;
  languageObserver?.disconnect();
  pendingFocus = undefined;
  bridgeReady = false;
  viewportReady = false;
  guard.reset();
  dropDraft();
  window.removeEventListener('message', receive);
  document.removeEventListener('focusin', focusChanged, true);
  document.removeEventListener('pointerdown', flushDraft, true);
  document.removeEventListener('keydown', flushDraft, true);
});
defineExpose({
  highlight,
  measure,
  restoreViewport,
  focusNode,
  returnFocus,
  textCommand,
  rejectText,
  openText,
  focusText,
  flushDraft,
  refresh: render,
  insertionTargets,
  hover,
  trackInsertion,
  commitInsertion,
  cancelInsertion,
  getFrameElement,
});
</script>

<template>
  <iframe
    :key="frameKey"
    ref="frame"
    class="editor-preview editor-selection-preview"
    :title="title"
    :srcdoc="srcdoc"
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
    @load="frameLoaded"
  ></iframe>
</template>
