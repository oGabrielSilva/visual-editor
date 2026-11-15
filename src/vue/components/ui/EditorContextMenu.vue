<script setup lang="ts">
import { computed } from 'vue';
import UContextMenu from '@nuxt/ui/components/ContextMenu.vue';
import type { ContextMenuItem } from '@nuxt/ui/components/ContextMenu.vue';
import type { EditorMenuItem } from './EditorMenu.vue';

const props = withDefaults(
  defineProps<{ items: readonly EditorMenuItem[]; label: string; disabled?: boolean }>(),
  { disabled: false },
);
const emit = defineEmits<{ select: [id: string]; 'update:open': [open: boolean] }>();
const contentAttrs = computed(() => ({ 'aria-label': props.label }));
const groups = computed<ContextMenuItem[][]>(() => {
  const result = new Map<number | string, ContextMenuItem[]>();
  for (const item of props.items) {
    const group = item.group ?? 0;
    result.set(group, [
      ...(result.get(group) ?? []),
      {
        label: item.label,
        ...(item.icon ? { icon: item.icon } : {}),
        ...(item.kbds?.length ? { kbds: [...item.kbds] } : {}),
        ...(item.danger ? { color: 'error' as const } : {}),
        disabled: !!item.disabled,
        onSelect: () => emit('select', item.id),
      },
    ]);
  }
  return [...result.values()];
});
</script>

<template>
  <UContextMenu
    :items="groups"
    :portal="false"
    :disabled="disabled || !items.length"
    :content="{ collisionPadding: 8, ...contentAttrs }"
    size="sm"
    :ui="{ content: 'editor-menu-content' }"
    @update:open="emit('update:open', $event)"
  >
    <slot />
  </UContextMenu>
</template>
