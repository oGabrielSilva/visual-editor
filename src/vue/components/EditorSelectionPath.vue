<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import UBreadcrumb from '@nuxt/ui/components/Breadcrumb.vue';
import type { EditorController } from '../controller';
import { selectionProjectionKey } from '../projection-key';
import { useWorkbench } from '../workbench';
import { BlockPresentation } from '../services/block-presentation';
import { SelectionPath } from '../services/selection-path';
import type { PathEntry } from '../services/selection-path';
import EditorButton from './ui/EditorButton.vue';
import EditorMenu from './ui/EditorMenu.vue';

const props = defineProps<{ controller: EditorController }>();
const emit = defineEmits<{ select: [id: string] }>();
const workbench = useWorkbench();
const { state } = workbench;
const t = workbench.t;
const root = ref<HTMLElement>();
const width = ref(0);
const presentation = new BlockPresentation();
const path = new SelectionPath();
let observer: ResizeObserver | undefined;
const entries = computed<PathEntry[]>(() => {
  void selectionProjectionKey(state.value);
  const result: PathEntry[] = [];
  const visited = new Set<string>();
  let current = state.value.selectedNodeId
    ? props.controller.resolveSelection(state.value.selectedNodeId)
    : undefined;
  while (current && result.length < 30 && !visited.has(current.id)) {
    visited.add(current.id);
    result.unshift({
      id: current.id,
      label: t(presentation.regionLabelKey(current)),
      icon: presentation.regionIcon(current),
    });
    current = current.parentId ? props.controller.resolveSelection(current.parentId) : undefined;
  }
  return result;
});
const collapsed = computed(() => path.collapse(entries.value, path.capacity(width.value)));
const items = computed(() => [
  ...collapsed.value.head.map((entry) => ({ ...entry, slot: 'level' as const })),
  ...(collapsed.value.hidden.length
    ? [{ id: 'hidden', label: t('canvas.pathMore'), icon: '', slot: 'more' as const }]
    : []),
  ...collapsed.value.tail.map((entry) => ({ ...entry, slot: 'level' as const })),
]);
onMounted(() => {
  observer = new ResizeObserver((records) => {
    width.value = records[0]?.contentRect.width ?? 0;
  });
  if (root.value) {
    width.value = root.value.clientWidth;
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="root" class="editor-canvas-breadcrumb">
    <UBreadcrumb
      v-if="entries.length"
      as="nav"
      :items="items"
      :aria-label="t('canvas.selection')"
      separator-icon="i-lucide-chevron-right"
      class="editor-path"
    >
      <template #level="{ item }">
        <EditorButton
          size="xs"
          :icon="item.icon"
          :active="item.id === state.selectedNodeId"
          :aria-current="item.id === state.selectedNodeId ? 'true' : undefined"
          @click="emit('select', item.id)"
          >{{ item.label }}</EditorButton
        >
      </template>
      <template #more>
        <EditorMenu
          :label="t('canvas.pathMore')"
          :items="collapsed.hidden.map((entry) => ({ ...entry }))"
          @select="emit('select', $event)"
        >
          <EditorButton size="xs" icon="i-lucide-ellipsis" :aria-label="t('canvas.pathMore')" />
        </EditorMenu>
      </template>
    </UBreadcrumb>
    <span v-else class="editor-path-idle">{{ t('canvas.pathIdle') }}</span>
  </div>
</template>
