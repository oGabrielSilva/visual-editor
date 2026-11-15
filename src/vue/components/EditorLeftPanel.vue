<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkbench } from '../workbench';
import EditorTabs from './ui/EditorTabs.vue';
import EditorScrollArea from './ui/EditorScrollArea.vue';
import EditorBlockPalette from './EditorBlockPalette.vue';
import EditorTemplateGallery from './EditorTemplateGallery.vue';
import EditorStructureTree from './EditorStructureTree.vue';

/** What can be added to the piece and how it is organized: blocks, models and the structure. */
const workbench = useWorkbench();
const { state, locale, busy } = workbench;
const t = workbench.t;
const tab = ref('blocks');
const tabs = computed(() => [
  { value: 'blocks', label: t('editor.blocks'), icon: 'i-lucide-layout-grid' },
  { value: 'templates', label: t('editor.templates'), icon: 'i-lucide-layout-template' },
  { value: 'structure', label: t('editor.structure'), icon: 'i-lucide-list-tree' },
]);
</script>

<template>
  <EditorTabs v-model="tab" :items="tabs" :label="t('editor.panel')" class="editor-panel-tabs">
    <template #blocks>
      <EditorScrollArea><EditorBlockPalette /></EditorScrollArea>
    </template>
    <template #templates>
      <EditorScrollArea>
        <EditorTemplateGallery
          :controller="workbench.controller()"
          :locale="locale"
          :disabled="state.readOnly || busy"
          @select="workbench.templates.choose($event)"
        />
      </EditorScrollArea>
    </template>
    <template #structure>
      <EditorScrollArea><EditorStructureTree /></EditorScrollArea>
    </template>
  </EditorTabs>
</template>
