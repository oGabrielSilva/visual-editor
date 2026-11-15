<script setup lang="ts">
import { computed } from 'vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import EditorButton from './EditorButton.vue';
import { EditorDialogFocus } from './editor-dialog-focus';

const props = defineProps<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  disabled?: boolean;
  confirmIntent?: 'primary' | 'destructive';
  returnFocus?: HTMLElement | undefined;
  /** Room for code or a preview instead of a short question. */
  wide?: boolean;
  /** Where the focus goes when the dialog opens; the cancel button by default. */
  initialFocus?: string;
}>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  confirm: [];
}>();
const focus = new EditorDialogFocus();
const content = computed(() => ({
  onOpenAutoFocus: (event: Event): void =>
    focus.open(event, props.initialFocus ?? '[data-editor-confirm-cancel]'),
  onCloseAutoFocus: (event: Event): void => focus.close(event, props.returnFocus),
}));
</script>

<template>
  <UModal
    :open="open"
    :content="content"
    :title="title"
    :description="description"
    :portal="false"
    :transition="false"
    :close="false"
    :ui="{
      overlay: 'editor-confirm-overlay',
      content: wide ? 'editor-confirm-dialog is-wide' : 'editor-confirm-dialog',
      footer: 'editor-confirm-actions',
    }"
    @update:open="emit('update:open', $event)"
  >
    <template v-if="$slots.default" #body><slot /></template>
    <template #footer>
      <slot name="actions" />
      <EditorButton
        data-editor-confirm-cancel
        intent="secondary"
        @click="emit('update:open', false)"
        >{{ cancelLabel }}</EditorButton
      >
      <EditorButton
        :intent="confirmIntent ?? 'destructive'"
        :disabled="disabled"
        @click="emit('confirm')"
        >{{ confirmLabel }}</EditorButton
      >
    </template>
  </UModal>
</template>
