<script setup lang="ts">
import { computed, ref } from 'vue';
import UPopover from '@nuxt/ui/components/Popover.vue';
import EditorButton from './EditorButton.vue';
import { preserveComposingEscape } from './composition-dismissal';

const props = defineProps<{
  open: boolean;
  label: string;
  disabled: boolean;
  icon?: string;
  /** The trigger shows only its icon; the label stays as its accessible name. */
  iconOnly?: boolean;
}>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();
const root = ref<HTMLElement>();
const content = ref<HTMLElement>();
const triggerAttrs = computed(() => (props.open ? {} : { 'aria-controls': undefined }));
const openAutoFocus = (event: Event): void => {
  event.preventDefault();
  content.value
    ?.querySelector<HTMLElement>('input,button,[role="combobox"]')
    ?.focus({ preventScroll: true });
};
const closeAutoFocus = (event: Event): void => {
  event.preventDefault();
  const active = document.activeElement;
  if (!active || active === document.body || root.value?.contains(active))
    root.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
};
const collisionBoundary = computed(() => {
  void props.open;
  return (
    root.value?.closest('.editor-panel-dialog-body, .editor-side-panel, .editor-canvas-area') ??
    null
  );
});
const options = computed(() => ({
  side: 'bottom' as const,
  align: 'start' as const,
  collisionPadding: 8,
  collisionBoundary: collisionBoundary.value,
  prioritizePosition: true,
  onOpenAutoFocus: openAutoFocus,
  onCloseAutoFocus: closeAutoFocus,
  onEscapeKeyDown: preserveComposingEscape,
  'aria-label': props.label,
}));
</script>

<template>
  <div ref="root" class="editor-context-popover">
    <UPopover
      :open="open"
      :portal="false"
      :content="options"
      :ui="{ content: 'editor-context-popover-surface' }"
      @update:open="emit('update:open', $event)"
    >
      <slot name="trigger" :trigger-attrs="triggerAttrs">
        <EditorButton
          v-bind="{ ...triggerAttrs, ...(icon ? { icon } : {}) }"
          :disabled="disabled"
          :active="open"
          :title="label"
          :aria-label="iconOnly ? label : undefined"
          @mousedown.prevent
          ><template v-if="!iconOnly">{{ label }}</template></EditorButton
        >
      </slot>
      <template #content>
        <div ref="content" class="editor-context-popover-content" role="group" :aria-label="label">
          <slot />
        </div>
      </template>
    </UPopover>
  </div>
</template>
