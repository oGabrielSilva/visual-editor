<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { documentProjectionKey } from '../projection-key';
import { useWorkbench } from '../workbench';
import EditorField from './ui/EditorField.vue';
import EditorInput from './ui/EditorInput.vue';

/**
 * What the recipient or the visitor reads before the piece itself: its title and, in an e-mail,
 * the preview text shown next to the subject.
 */
const workbench = useWorkbench();
const { state } = workbench;
const t = workbench.t;
const instanceId = useId();
const errors = ref<{ title?: string; preheader?: string }>({});
const metadata = computed(() => {
  void documentProjectionKey(state.value);
  return workbench.controller().documentMetadata();
});
const email = computed(() => state.value.document.kind === 'email');
const update = (field: 'title' | 'preheader', value: string): void => {
  if (state.value.readOnly) return;
  const ok = workbench.live.apply(`document:${field}`, () =>
    field === 'title' ? workbench.properties.title(value) : workbench.properties.preheader(value),
  );
  if (ok) {
    delete errors.value[field];
    workbench.feedback.value = t('feedback.applied');
  } else {
    errors.value[field] = t('properties.invalidValue');
    workbench.report('feedback.invalid');
  }
};
</script>

<template>
  <div v-if="metadata" class="editor-document-metadata">
    <EditorField
      :id="`${instanceId}-title`"
      :label="t(email ? 'properties.documentTitleEmail' : 'properties.documentTitlePage')"
      :error="errors.title"
    >
      <EditorInput
        :id="`${instanceId}-title`"
        :model-value="metadata.title"
        live
        :disabled="state.readOnly"
        :invalid="!!errors.title"
        @change="update('title', $event)"
      />
    </EditorField>
    <EditorField
      v-if="metadata.preheader !== undefined"
      :id="`${instanceId}-preheader`"
      :label="t('properties.preheader')"
      :help="t('properties.preheaderHelp')"
      :error="errors.preheader"
    >
      <EditorInput
        :id="`${instanceId}-preheader`"
        :model-value="metadata.preheader"
        live
        :disabled="state.readOnly"
        :invalid="!!errors.preheader"
        @change="update('preheader', $event)"
      />
    </EditorField>
  </div>
</template>
