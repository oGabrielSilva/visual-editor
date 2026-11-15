<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { CanvasBounds } from '../../security/preview-message';
import type { CanvasBridgeLabels, CanvasBridgeTheme } from '../../renderers/canvas-bridge';
import type { SelectionPreviewRenderer } from '../../renderers/selection-preview';
import { framePreview } from '../../renderers/selection-preview';
import type { CanvasRegion } from '../../core/canvas-layout';
import type { EditorController } from '../controller';
import { documentProjectionKey } from '../projection-key';
import { useWorkbench } from '../workbench';
import { InlineTextCoordinator } from '../canvas/inline-text';
import { PaletteDrag } from '../canvas/palette-drag';
import { FileDrop } from '../canvas/file-drop';
import { CanvasThemeProbe } from '../canvas/canvas-theme';
import { BlockPresentation } from '../services/block-presentation';
import { StripReserve } from '../canvas/strip-reserve';
import { PieceRequests } from '../canvas/piece-requests';
import type { ImageDestination } from '../services/image-requests';
import SelectionPreviewFrame from './SelectionPreviewFrame.vue';
import EditorRichTextControls from './EditorRichTextControls.vue';
import EditorSelectionPath from './EditorSelectionPath.vue';
import EditorButton from './ui/EditorButton.vue';
import EditorEmpty from './ui/EditorEmpty.vue';

const props = defineProps<{
  controller: EditorController;
  renderer: SelectionPreviewRenderer;
  /** Test mode of the frame runtime. */
  diagnostics?: boolean;
}>();
const workbench = useWorkbench();
const { state, locale } = workbench;
const t = workbench.t;
const documentScope = computed(() => documentProjectionKey(state.value));
const source = computed(() => framePreview(props.renderer, state.value.document));
const frame = ref<InstanceType<typeof SelectionPreviewFrame>>();
const root = ref<HTMLElement>();
const viewport = ref<HTMLElement>();
const bar = ref<HTMLElement>();
const controls = ref<InstanceType<typeof EditorRichTextControls>>();
const readOnly = computed(() => state.value.readOnly);
const error = ref('');
// The piece could not be drawn: the reason is shown in its place, with the way out.
const failure = ref<'frameset' | 'window' | 'render'>();
const frameGeneration = ref(0);
const theme = shallowRef<CanvasBridgeTheme>();
const presentation = new BlockPresentation();
const probe = new CanvasThemeProbe();
let observer: ResizeObserver | undefined;
const strip = new StripReserve();
let themeObserver: MutationObserver | undefined;

const fail = (): void => {
  error.value = t('feedback.invalid');
  workbench.report('feedback.invalid');
};
const changed = (): void => {
  error.value = '';
  workbench.feedback.value = t('feedback.applied');
};
const text = new InlineTextCoordinator({
  controller: () => props.controller,
  frame: () => frame.value,
  readOnly: () => readOnly.value,
  selected: () => {
    error.value = '';
  },
  changed,
  failed: fail,
});
const palette = new PaletteDrag({
  frame: () => frame.value,
  readOnly: () => readOnly.value,
  accepts: (type) => props.controller.blocks(state.value.document.kind).includes(type),
  begin: () => {
    // The gesture starts now; the text being edited is concluded while it happens.
    void text.flush();
    frame.value?.insertionTargets(props.controller.insertionTargets());
  },
});
const files = new FileDrop({
  frame: () => frame.value,
  enabled: () => !readOnly.value && workbench.images.acceptsFiles,
  begin: () => {
    void text.flush();
    frame.value?.insertionTargets(props.controller.insertionTargets());
  },
});
const fileDrag = files.active;
const editingId = text.editingId;
const labels = computed<CanvasBridgeLabels>(() => ({
  edit: t('canvas.edit'),
  move: t('canvas.move'),
  up: t('canvas.up'),
  down: t('canvas.down'),
  duplicate: t('canvas.duplicate'),
  remove: t('canvas.remove'),
  before: t('canvas.insertBefore'),
  after: t('canvas.insertAfter'),
  inside: t('canvas.insertInside'),
  parent: t('canvas.parent'),
  html: t('canvas.editHtml'),
  image: t('actions.replaceImage'),
  add: t('canvas.add'),
  resize: t('canvas.resizeImage'),
  resizeHint: t('canvas.resizeImageKeys'),
  replace: t('canvas.replaceImageDrop'),
  embed: t('canvas.embed'),
}));
const describe = computed(() => {
  const translate = locale.value;
  return (region: CanvasRegion): string => translate.text(presentation.regionLabelKey(region));
});
const editingRegion = computed(() => {
  void documentScope.value;
  return editingId.value ? props.controller.resolveSelection(editingId.value) : undefined;
});
const editingAllowsBlocks = computed(() => {
  void documentScope.value;
  return !!editingId.value && props.controller.richTextAllowsBlocksFor(editingId.value);
});
const currentIdentity = (value: { id: string; revision: number }): boolean =>
  value.id === state.value.document.id && value.revision === state.value.document.revision;
const frameElement = (): HTMLIFrameElement | undefined => frame.value?.getFrameElement();
/** A rectangle of the frame in the coordinates of the page, for menus opened next to a block. */
const pageRect = (bounds: CanvasBounds): CanvasBounds | undefined => {
  const origin = frameElement()?.getBoundingClientRect();
  if (!origin) return undefined;
  const left = Math.max(0, bounds.x);
  const top = Math.max(0, bounds.y);
  const right = Math.min(origin.width, bounds.x + bounds.width);
  const bottom = Math.min(origin.height, bounds.y + bounds.height);
  return {
    x: origin.x + left,
    y: origin.y + top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
};
const refreshTheme = (): void => {
  if (!root.value) return;
  const next = probe.read(root.value);
  if (JSON.stringify(next) !== JSON.stringify(theme.value)) theme.value = next;
};
const select = (id: string): void => {
  // The block whose text is open is already the selected one.
  if (editingId.value !== id) void workbench.select(id);
};
const requests = new PieceRequests({
  commands: workbench.commands,
  images: workbench.images,
  readOnly: () => readOnly.value,
  pageRect,
  takeFile: () => files.take(),
  returnFocus: (origin) => frame.value?.returnFocus(origin),
});
const move = (value: {
  sourceId: string;
  targetId: string;
  placement: 'before' | 'after' | 'inside';
}): void => {
  void workbench.commands.move(value.sourceId, value.targetId, value.placement);
};
/** The frame only asks when its text has no step of its own left: the document steps follow. */
const history = (direction: 'undo' | 'redo'): void =>
  workbench.documentHistory(direction, 'feedback.applied');
/** The frame found where the dragged thing lands: a block of the palette or a dropped file. */
const insertion = (
  destination: { targetId: string; placement: 'before' | 'after' | 'inside' } | 'end',
): void => {
  const file = files.take();
  if (file) {
    void workbench.images.upload(file, destination as ImageDestination);
    return;
  }
  const type = palette.pendingType;
  palette.cancel();
  if (!type || readOnly.value) return;
  workbench.busy.value = true;
  void workbench.commands.insert(type, destination).finally(() => {
    workbench.busy.value = false;
  });
};
const imageResize = (value: { nodeId: string; width: number; height: number }): void => {
  void workbench.commands.resizeImage(value.nodeId, value.width, value.height);
};
/** Alt+F10 in the text reaches the formatting bar; Escape there returns to the text. */
const focusBar = (): void => {
  bar.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
};
const barKey = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || event.isComposing || !editingId.value) return;
  if (controls.value?.dismiss()) return;
  event.preventDefault();
  frame.value?.focusText();
};
watch(editingId, (id) => {
  workbench.inlineEditingId.value = id;
  error.value = '';
});
watch(
  () => state.value.pendingRichText?.id,
  (id) => text.sessionMoved(id),
);
watch(
  () => props.controller,
  (_controller, previous) => {
    text.ownerChanged(previous);
    frameGeneration.value++;
    palette.cancel();
    error.value = '';
  },
);
watch([() => state.value.document.id, () => state.value.document.revision, readOnly], () =>
  palette.cancel(),
);
workbench.canvas.value = {
  flush: () => text.flush(),
  cancel: () => text.cancel(),
  edit: (id) => void text.begin(id),
  editingId: () => editingId.value,
  gesture: () => palette.active || fileDrag.value,
  canHistory: (direction) => text.canHistory(direction),
  history: (direction) => text.history(direction),
  insertText: (value) => text.insertText(value),
  hover: (id) => frame.value?.hover(id),
  startPalette: (type, event) => palette.start(type, event),
  paletteDragged: () => palette.dragged(),
};
onMounted(() => {
  refreshTheme();
  observer = new ResizeObserver(() => frame.value?.measure());
  if (viewport.value) observer.observe(viewport.value);
  if (bar.value) strip.watch(bar.value);
  // The color scheme of the host is a class or an attribute on the root element.
  themeObserver = new MutationObserver(refreshTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  });
  // The whole shell of this editor, so the layer is up before the pointer reaches the piece.
  const area = root.value?.closest<HTMLElement>('.visual-editor') ?? root.value;
  if (area) files.listen(area);
});
onBeforeUnmount(() => {
  palette.cancel();
  text.dispose();
  observer?.disconnect();
  strip.dispose();
  themeObserver?.disconnect();
  files.dispose();
  workbench.canvas.value = undefined;
  workbench.inlineEditingId.value = undefined;
});
</script>

<template>
  <div
    ref="root"
    class="editor-canvas-surface"
    :class="{ 'is-palette-dragging': palette.gesture.value || fileDrag }"
    :data-text-fidelity="text.fidelity.value"
  >
    <EditorSelectionPath :controller="controller" @select="select" />
    <div
      ref="bar"
      class="editor-canvas-text-bar editor-richtext is-minimal"
      :class="{ 'is-idle': !editingId }"
      :data-editing-node="editingId"
      :title="t(editingId ? 'canvas.textBarHint' : 'canvas.textBarIdle')"
      :style="strip.height.value ? { minHeight: `${strip.height.value + 1}px` } : undefined"
      aria-keyshortcuts="Alt+F10"
      @keydown="barKey"
    >
      <EditorRichTextControls
        :id="`canvas-richtext-${editingId ?? 'idle'}`"
        ref="controls"
        :commands="text.remote"
        :locale="locale"
        :readonly="readOnly || !editingId"
        :allow-blocks="editingAllowsBlocks"
        :allow-links="editingRegion?.kind !== 'button'"
        :variables="workbench.variables()"
        minimal
      />
    </div>
    <div class="editor-canvas-stage">
      <div
        ref="viewport"
        class="editor-canvas-viewport editor-preview-shell"
        :class="`is-${workbench.width.value}`"
      >
        <SelectionPreviewFrame
          v-show="!failure"
          ref="frame"
          :key="frameGeneration"
          :source="source"
          :is-current="currentIdentity"
          v-bind="state.selectedNodeId ? { selectedNodeId: state.selectedNodeId } : {}"
          :title="t('editor.preview')"
          :selection-label="t('editor.selection')"
          :read-only="readOnly"
          :labels="labels"
          :describe="describe"
          :theme="theme"
          :diagnostics="diagnostics"
          :get-movement-targets="(id) => controller.movementTargets(id)"
          @select="select"
          @appearance="
            workbench.effectiveText.value = {
              documentId: state.document.id,
              revision: state.document.revision,
              targetId: $event.nodeId,
              style: $event.style,
            }
          "
          @reset="text.frameReset()"
          @text-unsupported="error = t('canvas.inPlaceUnsupported')"
          @text-toolbar="focusBar"
          @text-begin="text.textBegin($event)"
          @text-draft="text.textDraft($event)"
          @text-commit="text.textCommit($event)"
          @text-cancel="text.textCancel($event)"
          @text-state="text.textState($event)"
          @text-fidelity="text.fidelity.value = $event"
          @history="history"
          @move="move"
          @action="requests.action($event)"
          @insertion="insertion"
          @insert-request="requests.insert($event)"
          @context-menu="requests.menu($event)"
          @image-drop="requests.imageDrop($event)"
          @file-drag="files.external()"
          @failure="failure = $event"
          @shortcut="workbench.shortcuts.forwarded($event)"
          @image-resize="imageResize"
        />
        <div v-if="failure" class="editor-canvas-failure" role="alert">
          <EditorEmpty
            icon="i-lucide-triangle-alert"
            :title="t(failure === 'frameset' ? 'canvas.failureFrames' : 'canvas.failureTitle')"
            :description="
              t(
                failure === 'frameset'
                  ? 'canvas.failureFramesHint'
                  : failure === 'window'
                    ? 'canvas.failureWindowHint'
                    : 'canvas.failureHint',
              )
            "
          />
          <EditorButton intent="primary" @click="workbench.setMode('html')">{{
            t('canvas.failureOpenHtml')
          }}</EditorButton>
        </div>
        <div
          v-if="fileDrag"
          class="editor-file-drop"
          @dragover="files.over($event)"
          @drop="files.drop($event)"
        />
      </div>
    </div>
    <p v-if="error" class="editor-canvas-error" role="alert">{{ error }}</p>
  </div>
</template>
