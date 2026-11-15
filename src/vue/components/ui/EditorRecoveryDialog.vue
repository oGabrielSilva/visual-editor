<script setup lang="ts">
import UModal from '@nuxt/ui/components/Modal.vue';
import type { EditorLocale } from '../../locale';
import CodeEditor from '../CodeEditor.vue';
import EditorButton from './EditorButton.vue';
import { EditorDialogFocus } from './editor-dialog-focus';

defineProps<{
  open: boolean;
  html: string;
  readOnly: boolean;
  locale: EditorLocale;
  invalid: boolean;
}>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  'update:html': [html: string];
  apply: [];
  discard: [];
  download: [];
}>();
const focus = new EditorDialogFocus();
const content = {
  onOpenAutoFocus: (event: Event): void => focus.open(event),
  onCloseAutoFocus: (event: Event): void => focus.close(event),
};
</script>

<template>
  <UModal
    :open="open"
    :content="content"
    :title="locale.text('recovery.title')"
    :description="locale.text('recovery.description')"
    :portal="false"
    :transition="false"
    :close="false"
    :ui="{
      overlay: 'editor-confirm-overlay',
      content: 'editor-confirm-dialog is-wide editor-recovery-dialog',
      footer: 'editor-confirm-actions',
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <CodeEditor
        :model-value="html"
        language="html"
        :label="locale.text('recovery.content')"
        :description="locale.text('editor.codeKeyboardHelp')"
        :readonly="readOnly"
        :error="invalid ? locale.text('feedback.invalid') : ''"
        @update:model-value="emit('update:html', $event)"
      />
    </template>
    <template #footer>
      <EditorButton @click="emit('download')">{{ locale.text('recovery.download') }}</EditorButton>
      <EditorButton intent="destructive" @click="emit('discard')">{{
        locale.text('recovery.discard')
      }}</EditorButton>
      <EditorButton @click="emit('update:open', false)">{{
        locale.text('canvas.cancel')
      }}</EditorButton>
      <EditorButton intent="primary" :disabled="readOnly || invalid" @click="emit('apply')">{{
        locale.text('actions.apply')
      }}</EditorButton>
    </template>
  </UModal>
</template>
