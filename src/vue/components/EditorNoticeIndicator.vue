<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkbench } from '../workbench';
import { DiagnosticGroups } from '../services/diagnostic-groups';
import EditorContextPopover from './ui/EditorContextPopover.vue';
import EditorBadge from './ui/EditorBadge.vue';

/**
 * The discreet list of everything the import noted about the content, including what was only
 * kept as it came. It never interrupts: the person opens it when they want to know.
 */
const workbench = useWorkbench();
const t = workbench.t;
const open = ref(false);
const groups = computed(() =>
  new DiagnosticGroups(t)
    .group(workbench.state.value.diagnostics)
    .filter((group) => group.severity !== 'error'),
);
const total = computed(() => groups.value.reduce((sum, group) => sum + group.count, 0));
</script>

<template>
  <div v-if="groups.length" class="editor-notice-indicator" :data-notice-count="total">
    <EditorContextPopover
      :open="open"
      :label="`${t('notices.show')} (${total})`"
      icon="i-lucide-info"
      :disabled="false"
      @update:open="open = $event"
    >
      <ul class="editor-diagnostic-list editor-notice-list">
        <li
          v-for="group in groups"
          :key="group.key"
          :data-diagnostic-code="group.code"
          :data-diagnostic-severity="group.severity"
        >
          <span class="editor-diagnostic-text">{{ group.message }}</span>
          <EditorBadge
            v-if="group.count > 1"
            :tone="group.severity === 'info' ? 'neutral' : 'warning'"
            >{{ group.count }}×</EditorBadge
          >
        </li>
      </ul>
    </EditorContextPopover>
  </div>
</template>
