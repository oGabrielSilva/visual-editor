<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkbench } from '../workbench';
import { DiagnosticGroups } from '../services/diagnostic-groups';
import EditorNotice from './ui/EditorNotice.vue';
import EditorBadge from './ui/EditorBadge.vue';

/**
 * What needs attention after an import or a change. An error is an alert until it is solved; a
 * warning is shown once and can be dismissed. Information about content which was simply kept is
 * not an alert at all: it lives in the discreet indicator of the status line.
 */
const workbench = useWorkbench();
const t = workbench.t;
const service = computed(() => new DiagnosticGroups(t));
const groups = computed(() => service.value.group(workbench.state.value.diagnostics));
const errors = computed(() => groups.value.filter((group) => group.severity === 'error'));
const warnings = computed(() => groups.value.filter((group) => group.severity === 'warning'));
const dismissed = ref('');
const warningsVisible = computed(
  () => warnings.value.length > 0 && service.value.signature(warnings.value) !== dismissed.value,
);
const dismiss = (): void => {
  dismissed.value = service.value.signature(warnings.value);
};
</script>

<template>
  <div v-if="errors.length || warningsVisible" class="editor-diagnostics">
    <div v-if="errors.length" role="alert">
      <EditorNotice :title="t('notices.blocked')" tone="error">
        <ul class="editor-diagnostic-list">
          <li v-for="group in errors" :key="group.key" :data-diagnostic-code="group.code">
            <span class="editor-diagnostic-text">{{ group.message }}</span>
            <EditorBadge v-if="group.count > 1" tone="error">{{ group.count }}×</EditorBadge>
          </li>
        </ul>
      </EditorNotice>
    </div>
    <div v-if="warningsVisible" aria-live="polite" class="editor-warnings">
      <EditorNotice
        :title="t('notices.title')"
        tone="warning"
        :dismiss-label="t('notices.dismiss')"
        @dismiss="dismiss"
      >
        <ul class="editor-diagnostic-list">
          <li v-for="group in warnings" :key="group.key" :data-diagnostic-code="group.code">
            <span class="editor-diagnostic-text">{{ group.message }}</span>
            <EditorBadge v-if="group.count > 1" tone="warning">{{ group.count }}×</EditorBadge>
          </li>
        </ul>
      </EditorNotice>
    </div>
  </div>
</template>
