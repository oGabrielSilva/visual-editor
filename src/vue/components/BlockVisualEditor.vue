<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, useId } from 'vue';
import type { BlockDocumentData } from '../../core/block-document';
import type { SelectionPreviewRenderer } from '../../renderers/selection-preview';
import type { BlockEditorController } from '../block-controller';
import { BLOCK_WORKBENCH, createBlockWorkbench } from '../block-workbench';
import type { EditorMessages } from '../locale';
import { EditorTheme } from '../theme';
import type { EditorThemeOptions } from '../theme';
import { EditorIconRegistry } from '../icons';
import { EDITOR_PANEL_MEDIA_QUERY } from '../responsive-panel';
import type { EditorImagePicker } from '../services/image-requests';
import { FORM_PREVIEWS, FormPreviewCache } from '../services/form-preview';
import type { EditorFormPreview } from '../services/form-preview';
import type { EditorSavedBlocks } from '../services/saved-blocks';
import type { PreviewWidth } from '../workbench';
import type { EditorVariable } from '../variables';
import BlockCanvas from './blocks/BlockCanvas.vue';
import BlockPalette from './blocks/BlockPalette.vue';
import BlockProperties from './blocks/BlockProperties.vue';
import EditorBadge from './ui/EditorBadge.vue';
import EditorButton from './ui/EditorButton.vue';
import EditorIconButton from './ui/EditorIconButton.vue';
import EditorScrollArea from './ui/EditorScrollArea.vue';
import EditorSeparator from './ui/EditorSeparator.vue';
import EditorSidePanel from './ui/EditorSidePanel.vue';
import EditorUiProvider from './ui/EditorUiProvider.vue';

EditorIconRegistry.register();

/**
 * The editor of a block piece (schema 2): the palette and templates on the left, the piece in
 * the editing frame, generated from the blocks, and the panel of the selected block (or of the
 * global styles) on the right. It sits beside `VisualEditor`, which edits HTML documents.
 */
const props = defineProps<{
  controller: BlockEditorController;
  selectionRenderer: SelectionPreviewRenderer;
  messages?: EditorMessages;
  theme?: EditorThemeOptions;
  imagePicker?: EditorImagePicker;
  /** Blocks saved in the library of the host to use again; without it the palette has no such section. */
  savedBlocks?: EditorSavedBlocks;
  variables?: readonly EditorVariable[];
  /** Pictures of the forms connected to the piece, shown in their slots while editing. */
  formPreview?: EditorFormPreview;
  /** Test mode of the frame runtime. */
  diagnostics?: boolean;
}>();
const emit = defineEmits<{
  save: [document: BlockDocumentData];
  error: [code: string];
}>();
const workbench = createBlockWorkbench({
  controller: () => props.controller,
  messages: () => props.messages,
  imagePicker: () => props.imagePicker,
  savedBlocks: () => props.savedBlocks,
  saved: (document) => emit('save', document),
  failed: (code) => emit('error', code),
});
provide(BLOCK_WORKBENCH, workbench);
const formPreviews = new FormPreviewCache(() => props.formPreview);
provide(FORM_PREVIEWS, formPreviews);
onBeforeUnmount(() => formPreviews.dispose());
const { state, busy, feedback, width } = workbench;
const t = workbench.t;
const theme = computed(() => new EditorTheme(props.theme).variables());
const palette = ref<InstanceType<typeof BlockPalette>>();
const properties = ref<InstanceType<typeof BlockProperties>>();
const dark = workbench.dark;
/** The review lives in the panel of the piece: the selection goes, and the panel opens on it. */
const review = async (): Promise<void> => {
  if (!(await workbench.run((editor) => editor.select(undefined), ''))) return;
  if (mobile.value) rightOpen.value = true;
  const done = workbench.runReview();
  await properties.value?.focusReview();
  await done;
};
const instanceId = useId();
const mobile = ref(false);
const leftOpen = ref(false);
const rightOpen = ref(false);
let media: MediaQueryList | undefined;
const widths: readonly { value: PreviewWidth; icon: string; label: string }[] = [
  { value: 'desktop', icon: 'i-lucide-monitor', label: 'editor.desktop' },
  { value: 'tablet', icon: 'i-lucide-tablet', label: 'editor.tablet' },
  { value: 'mobile', icon: 'i-lucide-smartphone', label: 'editor.mobile' },
];
/** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Y) and Ctrl/Cmd+S outside fields of the shell. */
const keydown = (event: KeyboardEvent): void => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
    return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    void workbench.save();
  } else if (key === 'z' || key === 'y') {
    event.preventDefault();
    workbench.history(key === 'y' || event.shiftKey ? 'redo' : 'undo');
  }
};
/** The "+" of a block: the keyboard goes to the palette, once the mobile panel has opened. */
const insertRequest = async (): Promise<void> => {
  if (mobile.value) leftOpen.value = true;
  await nextTick();
  palette.value?.focus();
  // The mobile panel mounts its content and takes the focus on its first frame: put it back.
  if (mobile.value) requestAnimationFrame(() => palette.value?.focus());
};
const mediaChange = (): void => {
  mobile.value = media?.matches ?? false;
  if (!mobile.value) {
    leftOpen.value = false;
    rightOpen.value = false;
  }
};
onMounted(() => {
  media = window.matchMedia(EDITOR_PANEL_MEDIA_QUERY);
  mediaChange();
  media.addEventListener('change', mediaChange);
});
onBeforeUnmount(() => {
  media?.removeEventListener('change', mediaChange);
  workbench.dispose();
});
</script>

<template>
  <section
    class="visual-editor is-visual is-blocks"
    :style="theme"
    :aria-label="t('editor.title')"
    :data-block-revision="state.document.revision"
    @keydown="keydown"
  >
    <EditorUiProvider>
      <header class="editor-toolbar">
        <div class="editor-brand">
          <slot name="brand">
            <strong class="editor-brand-name">{{ t('editor.title') }}</strong>
          </slot>
          <EditorBadge>{{
            t(state.document.kind === 'email' ? 'editor.email' : 'editor.page')
          }}</EditorBadge>
        </div>
        <EditorIconButton
          v-if="mobile"
          icon="i-lucide-panel-left"
          :label="t('editor.panel')"
          @click="leftOpen = true"
        />
        <EditorIconButton
          v-if="mobile"
          icon="i-lucide-panel-right"
          :label="t('editor.propertiesPanel')"
          @click="rightOpen = true"
        />
        <div class="editor-history">
          <EditorIconButton
            icon="i-lucide-undo-2"
            :label="t('actions.undo')"
            :kbds="['meta', 'Z']"
            :disabled="!workbench.canHistory('undo')"
            @mousedown.prevent
            @click="workbench.history('undo')"
          />
          <EditorIconButton
            icon="i-lucide-redo-2"
            :label="t('actions.redo')"
            :kbds="['meta', 'shift', 'Z']"
            :disabled="!workbench.canHistory('redo')"
            @mousedown.prevent
            @click="workbench.history('redo')"
          />
        </div>
        <EditorSeparator />
        <div class="editor-preview-controls" role="group" :aria-label="t('editor.preview')">
          <EditorIconButton
            v-for="option in widths"
            :key="option.value"
            :icon="option.icon"
            :label="t(option.label)"
            :active="width === option.value"
            @click="width = option.value"
          />
        </div>
        <EditorIconButton
          icon="i-lucide-moon"
          :label="t('editor.darkPreview')"
          :active="dark"
          :aria-pressed="dark"
          data-dark-preview
          @click="dark = !dark"
        />
        <span class="editor-toolbar-space" />
        <EditorButton
          icon="i-lucide-list-checks"
          :loading="workbench.reviewing.value"
          data-block-review-run
          @mousedown.prevent
          @click="review()"
          >{{ t('review.run') }}</EditorButton
        >
        <span class="editor-status" aria-live="polite" aria-atomic="true">{{
          t(state.readOnly ? 'editor.readonly' : state.dirty ? 'editor.dirty' : 'editor.saved')
        }}</span>
        <EditorButton
          intent="primary"
          icon="i-lucide-save"
          :disabled="state.readOnly || busy"
          :loading="state.saving"
          @mousedown.prevent
          @click="workbench.save()"
          >{{ t('actions.save') }}</EditorButton
        >
      </header>
      <div class="editor-workspace" :aria-busy="busy">
        <EditorSidePanel
          :id="`${instanceId}-blocks-left`"
          :open="leftOpen"
          :mobile="mobile"
          side="left"
          :label="t('editor.panelTitle')"
          :close-label="t('editor.closePanel')"
          @update:open="leftOpen = $event"
        >
          <EditorScrollArea><BlockPalette ref="palette" /></EditorScrollArea>
        </EditorSidePanel>
        <div class="editor-canvas-area">
          <BlockCanvas
            :renderer="selectionRenderer"
            :variables="variables ?? []"
            :diagnostics="diagnostics"
            @insert-request="insertRequest"
          />
        </div>
        <EditorSidePanel
          :id="`${instanceId}-blocks-right`"
          :open="rightOpen"
          :mobile="mobile"
          side="right"
          :label="t('editor.properties')"
          :close-label="t('editor.closePanel')"
          @update:open="rightOpen = $event"
        >
          <BlockProperties ref="properties" />
        </EditorSidePanel>
      </div>
      <footer class="editor-statusbar">
        <span class="editor-feedback" role="status" aria-live="polite">{{
          busy ? t('feedback.busy') : feedback
        }}</span>
      </footer>
    </EditorUiProvider>
  </section>
</template>
