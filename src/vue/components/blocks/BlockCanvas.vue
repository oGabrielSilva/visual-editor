<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { CanvasBridgeLabels, CanvasBridgeTheme } from '../../../renderers/canvas-bridge';
import type {
  BlockPreviewInput,
  SelectionPreviewRenderer,
} from '../../../renderers/selection-preview';
import { framePreview } from '../../../renderers/selection-preview';
import type { CanvasBlockAction } from '../../../core/canvas-contract';
import { COMPILE_SUPERSEDED } from '../../../compilation/compile-lanes';
import { useBlockWorkbench } from '../../block-workbench';
import { InlineTextCoordinator } from '../../canvas/inline-text';
import { CanvasThemeProbe } from '../../canvas/canvas-theme';
import type { EditorVariable } from '../../variables';
import SelectionPreviewFrame from '../SelectionPreviewFrame.vue';
import EditorRichTextControls from '../EditorRichTextControls.vue';
import EditorEmpty from '../ui/EditorEmpty.vue';

const props = defineProps<{
  renderer: SelectionPreviewRenderer;
  variables?: readonly EditorVariable[];
  /** Test mode of the frame runtime. */
  diagnostics?: boolean;
}>();
const emit = defineEmits<{
  /** The "+" of a block: the palette inserts after it. */
  'insert-request': [];
}>();
const workbench = useBlockWorkbench();
const { state, locale } = workbench;
const t = workbench.t;
const frame = ref<InstanceType<typeof SelectionPreviewFrame>>();
const root = ref<HTMLElement>();
const input = shallowRef<BlockPreviewInput>();
const failure = ref(false);
const compiling = ref(false);
const theme = shallowRef<CanvasBridgeTheme>();
const probe = new CanvasThemeProbe();
let themeObserver: MutationObserver | undefined;
let job = 0;
let retry: ReturnType<typeof setTimeout> | undefined;

const readOnly = computed(() => state.value.readOnly);
const text = new InlineTextCoordinator({
  controller: () => workbench.controller().textOwner(),
  frame: () => frame.value,
  readOnly: () => readOnly.value,
  selected: () => undefined,
  changed: () => {
    workbench.feedback.value = t('feedback.applied');
  },
  failed: () => {
    workbench.feedback.value = t('feedback.invalid');
  },
});
const editingId = text.editingId;
const editingRegion = computed(() =>
  input.value?.regions.find((region) => region.id === editingId.value),
);
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
  // No "Editar como HTML": the HTML of a block piece is generated. The host converts the piece
  // to an editable HTML document instead.
  image: t('actions.replaceImage'),
  add: t('canvas.add'),
  resize: t('canvas.resizeImage'),
  resizeHint: t('canvas.resizeImageKeys'),
  replace: t('canvas.replaceImageDrop'),
  embed: t('canvas.embed'),
}));
/**
 * Approximation of the dark mode of a reader that inverts the colors of a message and keeps
 * its images: the content is inverted, the images inverted back. Real clients differ (some
 * invert only light backgrounds, some nothing); the toolbar says it is an approximation. The
 * controls of the frame stay as they are.
 */
const DARK_PREVIEW_CSS =
  'html,body{background-color:#121212!important}' +
  'body>:not(visual-editor-controls){filter:invert(1) hue-rotate(180deg)}' +
  'body>:not(visual-editor-controls) img{filter:invert(1) hue-rotate(180deg)}';
/** The friendly name of each variable of the host, for the tags of the frame. */
const variableNames = computed(() =>
  Object.fromEntries((props.variables ?? []).map((variable) => [variable.key, variable.label])),
);
const source = computed(() => {
  const current = input.value;
  if (!current) return undefined;
  const shown = workbench.dark.value
    ? { ...current, source: { ...current.source, css: `${current.source.css}${DARK_PREVIEW_CSS}` } }
    : current;
  return framePreview(props.renderer.blocks, shown);
});

const transient = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message === 'COMPILER_BUSY' || error.message === COMPILE_SUPERSEDED);

/** The preview of each revision; a result of an older revision is dropped. */
const refresh = async (): Promise<void> => {
  clearTimeout(retry);
  const current = ++job;
  const controller = workbench.controller();
  compiling.value = true;
  try {
    const next = await controller.preview();
    if (current !== job) return;
    const translate = locale.value;
    input.value = Object.freeze({
      ...next,
      regions: next.regions.map((region) => {
        const key = controller.labelKey(region.id);
        return Object.freeze({ ...region, ...(key ? { label: translate.text(key) } : {}) });
      }),
    });
    failure.value = false;
  } catch (error: unknown) {
    // A compiler busy with the save, or a newer revision waiting, is not a failure of the piece:
    // the frame stays as it is (with its selection) until the newer preview arrives.
    if (current !== job) return;
    if (!transient(error)) failure.value = true;
    else retry = setTimeout(() => current === job && void refresh(), 200);
  } finally {
    if (current === job) compiling.value = false;
  }
};
watch(
  [() => state.value.document.id, () => state.value.document.revision, locale],
  () => void refresh(),
  { immediate: true },
);

const select = (id: string): void => {
  if (editingId.value !== id) void workbench.run((editor) => editor.select(id), '');
};
const action = (event: { nodeId: string; action: CanvasBlockAction }): void => {
  const id = event.nodeId;
  if (event.action === 'image') void workbench.chooseImage(id);
  else if (event.action === 'up' || event.action === 'down') {
    const direction = event.action;
    void workbench.run((editor) => editor.step(id, direction));
  } else if (event.action === 'duplicate') void workbench.run((editor) => editor.duplicate(id));
  else if (event.action === 'remove')
    void workbench.run((editor) => editor.remove(id), 'feedback.removed');
};
const move = (event: {
  sourceId: string;
  targetId: string;
  placement: 'before' | 'after' | 'inside';
}): void => {
  void workbench.run((editor) => editor.move(event.sourceId, event.targetId, event.placement));
};
const resize = (event: { nodeId: string; width: number }): void => {
  void workbench.run((editor) => editor.setField(event.nodeId, 'width', `${event.width}px`));
};
const insertRequest = (event: { nodeId: string }): void => {
  void workbench
    .run((editor) => editor.select(event.nodeId), '')
    .then((selected) => {
      if (selected) emit('insert-request');
    });
};
const refreshTheme = (): void => {
  if (!root.value) return;
  const next = probe.read(root.value);
  if (JSON.stringify(next) !== JSON.stringify(theme.value)) theme.value = next;
};
watch(
  () => state.value.pendingText?.id,
  (id) => text.sessionMoved(id),
);
workbench.canvas.value = {
  flush: () => text.flush(),
  edit: (id) => void text.begin(id),
  canHistory: (direction) => text.canHistory(direction),
  history: (direction) => text.history(direction),
  insertText: (value) => text.insertText(value),
};
onMounted(() => {
  refreshTheme();
  themeObserver = new MutationObserver(refreshTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  });
});
onBeforeUnmount(() => {
  job++;
  clearTimeout(retry);
  text.dispose();
  themeObserver?.disconnect();
  workbench.canvas.value = undefined;
});
</script>

<template>
  <div
    ref="root"
    class="editor-canvas-surface"
    :data-block-preview-revision="input?.revision"
    :aria-busy="compiling"
  >
    <div
      class="editor-canvas-text-bar editor-richtext is-minimal"
      :class="{ 'is-idle': !editingId }"
      :data-editing-node="editingId"
      :title="t(editingId ? 'canvas.textBarHint' : 'canvas.textBarIdle')"
    >
      <EditorRichTextControls
        :id="`block-richtext-${editingId ?? 'idle'}`"
        :commands="text.remote"
        :locale="locale"
        :readonly="readOnly || !editingId"
        :allow-blocks="!!editingRegion?.blocks"
        :allow-links="editingRegion?.links !== false"
        :variables="variables ?? []"
        minimal
      />
    </div>
    <div class="editor-canvas-stage">
      <div
        class="editor-canvas-viewport editor-preview-shell"
        :class="`is-${workbench.width.value}`"
      >
        <SelectionPreviewFrame
          v-if="source && !failure"
          ref="frame"
          :source="source"
          v-bind="state.selectedBlockId ? { selectedNodeId: state.selectedBlockId } : {}"
          :title="t('editor.preview')"
          :selection-label="t('editor.selection')"
          :read-only="readOnly"
          :labels="labels"
          :theme="theme"
          :diagnostics="diagnostics"
          :variant="workbench.dark.value ? 'dark' : 'light'"
          :variables="variableNames"
          without-menu
          :get-movement-targets="(id) => workbench.controller().movementTargets(id)"
          @select="select"
          @reset="text.frameReset()"
          @text-unsupported="workbench.feedback.value = t('canvas.inPlaceUnsupported')"
          @text-begin="text.textBegin($event)"
          @text-draft="text.textDraft($event)"
          @text-commit="text.textCommit($event)"
          @text-cancel="text.textCancel($event)"
          @text-state="text.textState($event)"
          @history="workbench.history($event)"
          @move="move"
          @action="action"
          @insert-request="insertRequest"
          @shortcut="workbench.save()"
          @image-resize="resize"
        />
        <div v-else-if="failure" class="editor-canvas-failure" role="alert">
          <EditorEmpty
            icon="i-lucide-triangle-alert"
            :title="t('canvas.failureTitle')"
            :description="t('feedback.invalid')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
