<script setup lang="ts">
import { onBeforeUnmount, ref, useId } from 'vue';
import { useWorkbench } from '../workbench';
import { Debouncer } from '../services/live-change';
import CodeEditor from './CodeEditor.vue';
import EditorButton from './ui/EditorButton.vue';
import EditorField from './ui/EditorField.vue';
import EditorSwitch from './ui/EditorSwitch.vue';

/**
 * The HTML mode. What is typed is the pending source of the session; after a pause it is applied
 * to the document when valid, and stays pending with its notices when it is not.
 */
const APPLY_DELAY = 600;
const workbench = useWorkbench();
const { state } = workbench;
const t = workbench.t;
const wrap = ref(true);
// Several editors may share a page: each one labels its own fields.
const instanceId = useId();
const debounce = new Debouncer(APPLY_DELAY);
const pending = (): boolean =>
  state.value.draftSource.html !== state.value.source.html ||
  state.value.draftSource.css !== state.value.source.css;
const applyNow = (): void => {
  debounce.cancel();
  if (state.value.readOnly || !pending()) return;
  const controller = workbench.controller();
  let ok: boolean;
  try {
    ok = controller.applyDraft();
  } catch {
    ok = false;
  }
  // The notices of a refused source are listed above; the line below only confirms success.
  workbench.feedback.value = ok ? t('feedback.applied') : '';
};
const edit = (field: 'html' | 'css', value: string): void => {
  if (state.value.readOnly) return;
  workbench.controller().setDraft(field, value);
  debounce.schedule(applyNow);
};
const restore = (): void => {
  debounce.cancel();
  workbench.controller().discardDraft();
};
onBeforeUnmount(() => debounce.cancel());
</script>

<template>
  <div class="editor-source-pane">
    <div class="editor-source-actions">
      <EditorSwitch v-model="wrap" :label="t('editor.wrapLines')" />
      <span class="editor-source-state">{{
        t(pending() ? 'editor.sourcePending' : 'editor.sourceApplied')
      }}</span>
      <EditorButton
        intent="secondary"
        icon="i-lucide-check"
        :disabled="state.readOnly || !pending()"
        @click="applyNow"
        >{{ t('actions.applyNow') }}</EditorButton
      >
      <EditorButton
        icon="i-lucide-rotate-ccw"
        :disabled="state.readOnly || !pending()"
        @click="restore"
        >{{ t('actions.restore') }}</EditorButton
      >
    </div>
    <EditorField
      :id="`${instanceId}-html-code`"
      class="editor-source-html"
      :label="t('editor.html')"
      :help="t('editor.htmlHelp')"
      ><CodeEditor
        :model-value="state.draftSource.html"
        language="html"
        :label="t('editor.html')"
        :description="t('editor.codeKeyboardHelp')"
        :readonly="state.readOnly"
        :wrap="wrap"
        @update:model-value="edit('html', $event)"
    /></EditorField>
    <EditorField
      :id="`${instanceId}-css-code`"
      class="editor-source-css"
      :label="t('editor.css')"
      :help="t('editor.cssHelp')"
      ><CodeEditor
        :model-value="state.draftSource.css"
        language="css"
        :label="t('editor.css')"
        :description="t('editor.codeKeyboardHelp')"
        :readonly="state.readOnly"
        :wrap="wrap"
        @update:model-value="edit('css', $event)"
    /></EditorField>
  </div>
</template>
