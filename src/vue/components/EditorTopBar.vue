<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkbench } from '../workbench';
import type { PreviewWidth } from '../workbench';
import EditorButton from './ui/EditorButton.vue';
import EditorIconButton from './ui/EditorIconButton.vue';
import EditorGroup from './ui/EditorGroup.vue';
import EditorSeparator from './ui/EditorSeparator.vue';
import EditorBadge from './ui/EditorBadge.vue';
import EditorMenu from './ui/EditorMenu.vue';
import EditorShortcutHelp from './EditorShortcutHelp.vue';

/** The bar of the document: mode, history, preview width, file actions, state and saving. */
const props = defineProps<{
  assetPicker: boolean;
  formPicker: boolean;
  mobile: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  leftPanelId: string;
  rightPanelId: string;
}>();
const emit = defineEmits<{
  'open-left': [];
  'open-right': [];
  'request-form': [];
}>();
const workbench = useWorkbench();
const { state, busy, width } = workbench;
const t = workbench.t;
const fileInput = ref<HTMLInputElement>();
const root = ref<HTMLElement>();
const widths: readonly { value: PreviewWidth; icon: string; label: string }[] = [
  { value: 'desktop', icon: 'i-lucide-monitor', label: 'editor.desktop' },
  { value: 'tablet', icon: 'i-lucide-tablet', label: 'editor.tablet' },
  { value: 'mobile', icon: 'i-lucide-smartphone', label: 'editor.mobile' },
];
const fileItems = computed(() => [
  {
    id: 'import',
    label: t('actions.import'),
    icon: 'i-lucide-upload',
    disabled: state.value.readOnly || busy.value,
    group: 'file',
  },
  { id: 'export', label: t('actions.export'), icon: 'i-lucide-download', group: 'file' },
  { id: 'exportJson', label: t('actions.exportJson'), icon: 'i-lucide-file-json', group: 'file' },
  ...(props.assetPicker
    ? [
        {
          id: 'image',
          label: t('actions.image'),
          icon: 'i-lucide-image',
          disabled: state.value.readOnly || busy.value,
          group: 'insert',
        },
      ]
    : []),
  ...(props.formPicker && state.value.document.kind === 'page'
    ? [
        {
          id: 'form',
          label: t('actions.form'),
          icon: 'i-lucide-text-cursor-input',
          disabled: state.value.readOnly || busy.value,
          group: 'insert',
        },
      ]
    : []),
]);
const download = (data: string, name: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const file = (id: string): void => {
  const controller = workbench.controller();
  if (id === 'import') fileInput.value?.click();
  else if (id === 'export')
    void workbench.act(
      () => download(controller.exportHtml(), 'content.html', 'text/html;charset=utf-8'),
      'feedback.exported',
    );
  else if (id === 'exportJson')
    void workbench.act(
      () => download(controller.exportJson(), 'document.json', 'application/json;charset=utf-8'),
      'feedback.exported',
    );
  else if (id === 'image') void workbench.images.choose();
  else if (id === 'form') emit('request-form');
};
const importFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const chosen = input.files?.[0];
  if (chosen)
    await workbench.act(() => workbench.controller().importFile(chosen), 'feedback.imported');
  input.value = '';
};
/** The button which opened a drawer receives the focus back when it closes. */
const trigger = (side: 'left' | 'right'): HTMLElement | undefined =>
  root.value?.querySelector<HTMLElement>(`[data-editor-panel-trigger="${side}"]`) ?? undefined;
defineExpose({ trigger });
</script>

<template>
  <header ref="root" class="editor-toolbar">
    <div class="editor-brand">
      <slot name="brand" />
      <EditorBadge>{{
        t(state.document.kind === 'email' ? 'editor.email' : 'editor.page')
      }}</EditorBadge>
    </div>
    <EditorIconButton
      data-editor-panel-trigger="left"
      icon="i-lucide-panel-left"
      :label="t('editor.panel')"
      :aria-expanded="leftOpen"
      :aria-controls="leftOpen ? leftPanelId : undefined"
      aria-haspopup="dialog"
      class="editor-mobile-trigger"
      :tabindex="mobile ? undefined : -1"
      @click="emit('open-left')"
    />
    <EditorIconButton
      data-editor-panel-trigger="right"
      icon="i-lucide-panel-right"
      :label="t('editor.propertiesPanel')"
      :aria-expanded="rightOpen"
      :aria-controls="rightOpen ? rightPanelId : undefined"
      aria-haspopup="dialog"
      class="editor-mobile-trigger"
      :tabindex="mobile ? undefined : -1"
      @click="emit('open-right')"
    />
    <EditorGroup :label="t('editor.mode')" class="editor-mode-switch">
      <EditorButton
        intent="secondary"
        :active="state.mode === 'visual'"
        @click="workbench.setMode('visual')"
        >{{ t('editor.visual') }}</EditorButton
      >
      <EditorButton
        intent="secondary"
        :active="state.mode === 'html'"
        @click="workbench.setMode('html')"
        >{{ t('editor.html') }}</EditorButton
      >
    </EditorGroup>
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
    <span class="editor-toolbar-space" />
    <span class="editor-status" aria-live="polite" aria-atomic="true">{{
      t(state.readOnly ? 'editor.readonly' : state.dirty ? 'editor.dirty' : 'editor.saved')
    }}</span>
    <EditorMenu :items="fileItems" :label="t('editor.file')" align="end" @select="file">
      <EditorButton
        icon="i-lucide-file"
        trailing-icon="i-lucide-chevron-down"
        class="editor-file-menu"
        >{{ t('editor.file') }}</EditorButton
      >
    </EditorMenu>
    <EditorShortcutHelp />
    <EditorButton
      intent="primary"
      icon="i-lucide-save"
      :disabled="state.readOnly || busy"
      @click="workbench.save()"
      >{{ t('actions.save') }}</EditorButton
    >
    <input
      ref="fileInput"
      type="file"
      accept=".html,.htm,.json,.css"
      class="editor-file-input"
      :aria-label="t('actions.import')"
      tabindex="-1"
      @change="importFile"
    />
  </header>
</template>
