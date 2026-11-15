<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, useId, watch } from 'vue';
import type { EditorDocumentData, SourceInput } from '../../core/document';
import type { SelectionPreviewRenderer } from '../../renderers/selection-preview';
import type { EditorController } from '../controller';
import { documentProjectionKey } from '../projection-key';
import { EDITOR_PANEL_MEDIA_QUERY } from '../responsive-panel';
import type { EditorMessages } from '../locale';
import { EditorTheme } from '../theme';
import type { EditorThemeOptions } from '../theme';
import { EditorIconRegistry } from '../icons';
import { createWorkbench, WORKBENCH } from '../workbench';
import type { EditorImagePicker } from '../services/image-requests';
import type { EditorVariable } from '../variables';
import CanvasSurface from './CanvasSurface.vue';
import EditorBlockMenus from './EditorBlockMenus.vue';
import EditorDiagnostics from './EditorDiagnostics.vue';
import EditorDialogs from './EditorDialogs.vue';
import EditorLeftPanel from './EditorLeftPanel.vue';
import EditorNoticeIndicator from './EditorNoticeIndicator.vue';
import EditorPreview from './EditorPreview.vue';
import EditorProperties from './EditorProperties.vue';
import EditorSourcePane from './EditorSourcePane.vue';
import EditorTopBar from './EditorTopBar.vue';
import EditorButton from './ui/EditorButton.vue';
import EditorNotice from './ui/EditorNotice.vue';
import EditorSidePanel from './ui/EditorSidePanel.vue';
import EditorUiProvider from './ui/EditorUiProvider.vue';

EditorIconRegistry.register();

const props = defineProps<{
  controller: EditorController;
  selectionRenderer?: SelectionPreviewRenderer;
  messages?: EditorMessages;
  /** Overrides for a host without a Nuxt UI theme; by default the editor inherits the host's. */
  theme?: EditorThemeOptions;
  /** Older image contract: the editor emits `request-image` and the host attaches the asset. */
  assetPicker?: boolean;
  formPicker?: boolean;
  variables?: readonly EditorVariable[];
  /** The image library of the host; takes precedence over `assetPicker`. */
  imagePicker?: EditorImagePicker;
  /** Test mode: the preview reports whether entering a text changed its appearance. */
  diagnostics?: boolean;
}>();
const emit = defineEmits<{
  save: [payload: { document: EditorDocumentData; source: SourceInput }];
  error: [code: string];
  'request-image': [nodeId: string | undefined];
  'request-form': [nodeId: string | undefined];
}>();
const workbench = createWorkbench({
  controller: () => props.controller,
  renderer: () => props.selectionRenderer,
  messages: () => props.messages,
  variables: () => props.variables ?? [],
  imagePicker: () => props.imagePicker,
  requestImage: () => (props.assetPicker ? (nodeId) => emit('request-image', nodeId) : undefined),
  saved: (payload) => emit('save', payload),
  failed: (code) => emit('error', code),
});
provide(WORKBENCH, workbench);
const { state, busy, feedback } = workbench;
const t = workbench.t;
const theme = computed(() => new EditorTheme(props.theme).variables());
const preview = computed(() => {
  void documentProjectionKey(state.value);
  return props.controller.previewHtml();
});
const bar = ref<InstanceType<typeof EditorTopBar>>();
const dialogs = ref<InstanceType<typeof EditorDialogs>>();
const mobile = ref(false);
const leftOpen = ref(false);
const rightOpen = ref(false);
const recoveryOpen = ref(false);
// The buttons which open the drawers; each one receives the focus back when its drawer closes.
const leftTrigger = shallowRef<HTMLElement>();
const rightTrigger = shallowRef<HTMLElement>();
const instanceId = useId();
const leftPanelId = `${instanceId}-left-panel`;
const rightPanelId = `${instanceId}-right-panel`;
let media: MediaQueryList | undefined;
/** A drawer covers the piece: a text being edited there is concluded first. */
const openPanel = async (side: 'left' | 'right'): Promise<void> => {
  if (!(await workbench.flush())) return;
  if (side === 'left') leftOpen.value = true;
  else rightOpen.value = true;
};
/** Reaching for a panel concludes a text being edited in the piece before any change. */
const concludeInline = (): void => {
  if (workbench.inlineEditingId.value) void workbench.flush();
};
const mediaChange = (): void => {
  mobile.value = media?.matches ?? false;
  if (!mobile.value) {
    leftOpen.value = false;
    rightOpen.value = false;
  }
};
watch(
  () => props.controller,
  () => {
    recoveryOpen.value = false;
  },
  { flush: 'sync' },
);
defineExpose({ insertVariable: workbench.insertVariable });
onMounted(() => {
  leftTrigger.value = bar.value?.trigger('left');
  rightTrigger.value = bar.value?.trigger('right');
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
    class="visual-editor"
    :class="`is-${state.mode}`"
    :style="theme"
    :aria-label="t('editor.title')"
    @keydown="workbench.shortcuts.handle($event)"
  >
    <EditorUiProvider>
      <EditorTopBar
        ref="bar"
        :asset-picker="!!assetPicker || !!imagePicker"
        :form-picker="!!formPicker"
        :mobile="mobile"
        :left-open="leftOpen"
        :right-open="rightOpen"
        :left-panel-id="leftPanelId"
        :right-panel-id="rightPanelId"
        @open-left="openPanel('left')"
        @open-right="openPanel('right')"
        @request-form="emit('request-form', undefined)"
      >
        <template #brand>
          <slot name="brand">
            <span class="editor-brand-mark" aria-hidden="true">E</span>
            <strong class="editor-brand-name">{{ t('editor.title') }}</strong>
          </slot>
        </template>
      </EditorTopBar>
      <EditorDiagnostics />
      <div
        v-if="state.pendingRichText && !state.pendingRichText.valid"
        class="editor-recovery-banner"
        role="alert"
      >
        <EditorNotice :title="t('recovery.blocked')" tone="error">
          <template #actions>
            <EditorButton intent="secondary" @click="recoveryOpen = true">{{
              t('recovery.review')
            }}</EditorButton>
            <EditorButton @click="dialogs?.downloadRecovery()">{{
              t('recovery.download')
            }}</EditorButton>
          </template>
        </EditorNotice>
      </div>
      <div class="editor-workspace" :aria-busy="busy">
        <EditorSidePanel
          :id="leftPanelId"
          :open="leftOpen"
          :mobile="mobile"
          side="left"
          :label="t('editor.panelTitle')"
          :close-label="t('editor.closePanel')"
          :return-focus="leftTrigger"
          @update:open="leftOpen = $event"
          @pointerdown.capture="concludeInline"
        >
          <EditorLeftPanel />
        </EditorSidePanel>
        <div class="editor-canvas-area">
          <EditorSourcePane v-if="state.mode === 'html'" />
          <CanvasSurface
            v-if="selectionRenderer && state.mode === 'visual'"
            :controller="controller"
            :renderer="selectionRenderer"
            :diagnostics="diagnostics"
          />
          <div v-else class="editor-preview-area">
            <EditorPreview
              :html="preview"
              :label="t('editor.preview')"
              :width="workbench.width.value"
            />
          </div>
        </div>
        <EditorSidePanel
          :id="rightPanelId"
          :open="rightOpen"
          :mobile="mobile"
          side="right"
          :label="t('editor.properties')"
          :close-label="t('editor.closePanel')"
          :return-focus="rightTrigger"
          @update:open="rightOpen = $event"
          @pointerdown.capture="concludeInline"
        >
          <EditorProperties
            :form-picker="formPicker"
            @request-form="emit('request-form', $event)"
          />
        </EditorSidePanel>
      </div>
      <footer class="editor-statusbar">
        <span class="editor-feedback" role="status" aria-live="polite">{{
          busy ? t('feedback.busy') : feedback
        }}</span>
        <EditorNoticeIndicator />
      </footer>
      <EditorBlockMenus />
      <EditorDialogs ref="dialogs" v-model:recovery-open="recoveryOpen" />
    </EditorUiProvider>
  </section>
</template>
