<script setup lang="ts" generic="T extends EditorTreeNode">
import { computed } from 'vue';
import UTree from '@nuxt/ui/components/Tree.vue';
import UIcon from '@nuxt/ui/runtime/vue/components/Icon.vue';

export interface EditorTreeNode {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly icon: string;
  readonly children?: EditorTreeNode[];
}

const props = withDefaults(
  defineProps<{
    items: T[];
    selectedId?: string | undefined;
    expanded: string[];
    label: string;
    /** Draws only the rows on screen; for pieces with hundreds of blocks. */
    virtualize?: boolean;
    /** A click was the end of a drag: it neither selects nor folds. */
    suppressClick?: () => boolean;
  }>(),
  { selectedId: undefined, virtualize: false, suppressClick: () => false },
);
const emit = defineEmits<{ select: [id: string]; 'update:expanded': [ids: string[]] }>();
const find = (nodes: readonly EditorTreeNode[], id: string): EditorTreeNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.children ? find(node.children, id) : undefined;
    if (found) return found;
  }
  return undefined;
};
const selected = computed(() =>
  props.selectedId ? find(props.items, props.selectedId) : undefined,
);
interface TreeEvent {
  preventDefault(): void;
  readonly detail: { readonly originalEvent: Event };
}
const onSelect = (event: TreeEvent, item: EditorTreeNode): void => {
  if (props.suppressClick()) {
    event.preventDefault();
    return;
  }
  emit('select', item.id);
};
/** A click selects; only the chevron or the keyboard folds a branch. */
const onToggle = (event: TreeEvent): void => {
  const origin = event.detail.originalEvent;
  if (
    props.suppressClick() ||
    (!(origin instanceof KeyboardEvent) &&
      !(origin.target instanceof Element && origin.target.closest('[data-slot="linkTrailing"]')))
  )
    event.preventDefault();
};
</script>

<template>
  <UTree
    :items="items"
    :get-key="(item: EditorTreeNode) => item.id"
    v-bind="selected ? { modelValue: selected as T } : {}"
    :expanded="expanded"
    :virtualize="virtualize ? { estimateSize: 32, overscan: 12 } : false"
    :aria-label="label"
    size="sm"
    color="primary"
    trailing-icon="i-lucide-chevron-down"
    class="editor-tree"
    :ui="{ link: 'editor-tree-row' }"
    @select="onSelect"
    @toggle="onToggle"
    @update:expanded="emit('update:expanded', $event)"
  >
    <template #item-leading="{ item }">
      <UIcon :name="item.icon" class="editor-tree-icon" />
    </template>
    <template #item-label="{ item }">
      <span class="editor-tree-label" :data-editor-node-id="item.id"
        >{{ item.label
        }}<span v-if="item.detail" class="editor-tree-detail">{{ item.detail }}</span></span
      >
    </template>
  </UTree>
</template>
