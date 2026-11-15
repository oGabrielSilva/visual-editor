<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue';
import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

export interface EditorMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly kbds?: readonly string[];
  /** Items with the same group stay together, between separators. */
  readonly group?: number | string;
  /** A heading instead of a choice. */
  readonly heading?: boolean;
  /** An option which is on or off; choosing it keeps the menu open. */
  readonly checked?: boolean;
  /** With `checked`: one choice among the items of its group, with the state the primitive draws. */
  readonly radio?: boolean;
}

const props = withDefaults(
  defineProps<{
    items: readonly EditorMenuItem[];
    label: string;
    open?: boolean | undefined;
    /** A search field above the items. */
    filter?: boolean;
    filterPlaceholder?: string;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'bottom' | 'left' | 'right';
    disabled?: boolean;
  }>(),
  {
    open: undefined,
    filter: false,
    filterPlaceholder: '',
    align: 'start',
    side: 'bottom',
    disabled: false,
  },
);
const emit = defineEmits<{ select: [id: string]; 'update:open': [open: boolean] }>();
// Each opening starts from the whole list: what was searched before is not remembered.
const search = ref('');
const toggled = (open: boolean): void => {
  search.value = '';
  emit('update:open', open);
};
watch(
  () => props.open,
  () => {
    search.value = '';
  },
);
// Accessible names travel as attributes of the primitives, beyond their typed options.
const contentAttrs = computed(() => ({ 'aria-label': props.label }));
const filterAttrs = computed(() => ({ 'aria-label': props.filterPlaceholder }));
const groups = computed<DropdownMenuItem[][]>(() => {
  const result = new Map<number | string, DropdownMenuItem[]>();
  for (const item of props.items) {
    const group = item.group ?? 0;
    const entry: DropdownMenuItem = item.heading
      ? { type: 'label', label: item.label }
      : {
          label: item.label,
          ...(item.icon ? { icon: item.icon } : {}),
          ...(item.description ? { description: item.description } : {}),
          ...(item.kbds?.length ? { kbds: [...item.kbds] } : {}),
          ...(item.danger ? { color: 'error' as const } : {}),
          disabled: !!item.disabled,
          // An option keeps the menu open and shows which one is on; with a search field the
          // menu is a list, where a plain item with a mark reads the same for everyone.
          ...(item.checked === undefined
            ? { onSelect: () => emit('select', item.id) }
            : item.radio
              ? {
                  // A choice which is on or off, drawn and announced by the primitive itself
                  // (menuitemcheckbox with aria-checked); the group keeps one of them on.
                  type: 'checkbox' as const,
                  checked: item.checked,
                  onUpdateChecked: () => undefined,
                  onSelect: (event: Event) => {
                    event.preventDefault();
                    emit('select', item.id);
                  },
                }
              : {
                  icon: item.checked ? 'i-lucide-check' : 'i-lucide-minus',
                  'aria-pressed': item.checked,
                  onSelect: (event: Event) => {
                    event.preventDefault();
                    emit('select', item.id);
                  },
                }),
        };
    result.set(group, [...(result.get(group) ?? []), entry]);
  }
  return [...result.values()];
});
</script>

<template>
  <UDropdownMenu
    v-bind="open === undefined ? {} : { open }"
    :items="groups"
    :portal="false"
    :disabled="disabled"
    :filter="filter ? { placeholder: filterPlaceholder, ...filterAttrs } : false"
    :content="{ align, side, collisionPadding: 8, ...contentAttrs }"
    size="sm"
    :ui="{ content: 'editor-menu-content' }"
    :search-term="search"
    @update:search-term="search = $event"
    @update:open="toggled"
  >
    <slot />
    <template #empty><slot name="empty" /></template>
  </UDropdownMenu>
</template>
