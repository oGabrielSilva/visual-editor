<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkbench } from '../workbench';
import { BlockPalette } from '../services/block-palette';
import EditorInput from './ui/EditorInput.vue';
import EditorSelect from './ui/EditorSelect.vue';
import EditorEmpty from './ui/EditorEmpty.vue';
import EditorButton from './ui/EditorButton.vue';
import EditorPropertyGroup from './ui/EditorPropertyGroup.vue';

/** The blocks a person can add: searched, grouped, dragged to the piece or added with a click. */
const workbench = useWorkbench();
const { state, busy } = workbench;
const t = workbench.t;
const query = ref('');
const palette = computed(() => new BlockPalette(t));
const groups = computed(() =>
  palette.value.groups(workbench.controller().blocks(state.value.document.kind), query.value),
);
const sections = computed(() =>
  groups.value.map((group) => ({ id: group.category, label: group.label, openByDefault: true })),
);
const disabled = computed(
  () => state.value.readOnly || busy.value || state.value.mode !== 'visual',
);
type Position = 'auto' | 'before' | 'after' | 'inside' | 'end';
/** Where a click (or Enter) on a block puts it, relative to the selected block. */
const position = ref<Position>('auto');
const selectedRegion = computed(() => {
  const id = state.value.selectedNodeId;
  void state.value.document.revision;
  return id ? workbench.controller().resolveSelection(id) : undefined;
});
const positions = computed(() => {
  const region = selectedRegion.value;
  const relative = !region;
  return [
    { value: 'auto', label: t('palette.positionAuto') },
    { value: 'before', label: t('palette.positionBefore'), disabled: relative },
    { value: 'after', label: t('palette.positionAfter'), disabled: relative },
    { value: 'inside', label: t('palette.positionInside'), disabled: !region?.container },
    { value: 'end', label: t('palette.positionEnd') },
  ];
});
// A position the selection no longer allows (nothing selected, or not a container) is not kept
// on screen: the field shows the default again, which is what a click would do.
watch(positions, (items) => {
  if (items.find((item) => item.value === position.value)?.disabled) position.value = 'auto';
});
const choosePosition = (value: string): void => {
  if (['auto', 'before', 'after', 'inside', 'end'].includes(value))
    position.value = value as Position;
};
const destination = (): Parameters<typeof workbench.commands.insert>[1] => {
  const region = selectedRegion.value;
  const where = position.value;
  if (where === 'end') return 'end';
  if (where === 'auto' || !region) return undefined;
  if (where === 'inside' && !region.container) return undefined;
  return { targetId: region.id, placement: where };
};
const add = (type: string): void => {
  if (workbench.canvas.value?.paletteDragged()) return;
  workbench.busy.value = true;
  void workbench.commands.insert(type, destination()).finally(() => {
    workbench.busy.value = false;
  });
};
</script>

<template>
  <div class="editor-palette">
    <EditorInput
      v-model="query"
      type="search"
      icon="i-lucide-search"
      :label="t('palette.search')"
      :placeholder="t('palette.search')"
    />
    <p class="editor-help">
      {{ t(state.mode === 'visual' ? 'palette.hint' : 'palette.visualOnly') }}
    </p>
    <label class="editor-palette-position">
      <span class="editor-help">{{ t('palette.position') }}</span>
      <EditorSelect
        :model-value="position"
        :items="positions"
        :label="t('palette.position')"
        :disabled="disabled"
        @change="choosePosition"
      />
    </label>
    <EditorEmpty v-if="!groups.length" icon="i-lucide-search" :title="t('palette.empty')" />
    <!-- A search opens every group which has a match, whatever was folded before. -->
    <EditorPropertyGroup v-else :groups="sections" :context-id="query.trim() ? 'search' : 'browse'">
      <template v-for="group in groups" :key="group.category" #[group.category]>
        <div class="editor-palette-grid" role="list" :aria-label="group.label">
          <div v-for="block in group.blocks" :key="block.type" role="listitem">
            <EditorButton
              intent="secondary"
              block
              :icon="block.icon"
              :disabled="disabled"
              :data-editor-block-type="block.type"
              class="editor-palette-block"
              @pointerdown="
                (event: PointerEvent) => workbench.canvas.value?.startPalette(block.type, event)
              "
              @click="add(block.type)"
              >{{ block.label }}</EditorButton
            >
          </div>
        </div>
      </template>
    </EditorPropertyGroup>
  </div>
</template>
