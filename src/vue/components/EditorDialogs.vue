<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useWorkbench } from '../workbench';
import CodeEditor from './CodeEditor.vue';
import EditorButton from './ui/EditorButton.vue';
import EditorConfirmDialog from './ui/EditorConfirmDialog.vue';
import EditorRecoveryDialog from './ui/EditorRecoveryDialog.vue';
import EditorTemplatePreview from './ui/EditorTemplatePreview.vue';
import EditorField from './ui/EditorField.vue';
import EditorInput from './ui/EditorInput.vue';

/**
 * Every question the shell asks before changing the document: remove a block, apply a model,
 * review a refused text, edit the HTML of one element, choose an image by its address.
 */
const props = defineProps<{ recoveryOpen: boolean }>();
const emit = defineEmits<{ 'update:recoveryOpen': [open: boolean] }>();
const workbench = useWorkbench();
const { state, locale, busy, commands, images, templates } = workbench;
const t = workbench.t;
// Several editors may share a page: no field of one may answer for a label of another.
const instanceId = useId();
const discardOpen = ref(false);
const source = ref('');
const imageUrl = ref('');
const imageAlt = ref('');
const imageError = ref('');
const sourceEdit = computed(() => commands.sourceEdit.value);
watch(sourceEdit, (edit) => {
  if (edit) source.value = edit.html;
});
watch(
  () => images.dialog.value,
  (dialog) => {
    imageUrl.value = dialog?.url ?? '';
    imageAlt.value = dialog?.alt ?? '';
    imageError.value = '';
  },
);
const downloadRecovery = (): void => {
  const url = URL.createObjectURL(
    new Blob([workbench.controller().exportRecovery()], {
      type: 'application/json;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'editor-recovery.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const discardRecovery = (): void => {
  workbench.canvas.value?.cancel();
  workbench.properties.cancelText();
  discardOpen.value = false;
  emit('update:recoveryOpen', false);
};
const applyRecovery = (): void => {
  if (workbench.properties.commitText()) {
    workbench.canvas.value?.cancel();
    emit('update:recoveryOpen', false);
    workbench.feedback.value = t('feedback.applied');
  } else workbench.feedback.value = t('feedback.invalid');
};
const applyTemplate = async (): Promise<void> => {
  const origin = document.activeElement;
  const trigger = await templates.apply();
  await nextTick();
  const active = document.activeElement;
  if (trigger?.isConnected && (active === document.body || active === origin || active === trigger))
    trigger.focus({ preventScroll: true });
};
const applyImage = (): void => {
  const dialog = images.dialog.value;
  const url = imageUrl.value.trim();
  if (!dialog?.nodeId || !url || !workbench.controller().linkPolicy().isSafe(url, 'image')) {
    imageError.value = t('properties.invalidImage');
    return;
  }
  if (!images.apply({ url, alt: imageAlt.value }, dialog.nodeId))
    imageError.value = t('properties.invalidImage');
};
defineExpose({ downloadRecovery });
</script>

<template>
  <EditorConfirmDialog
    :open="!!commands.removal.value"
    :title="t('canvas.confirmRemove')"
    :description="t('canvas.confirmRemoveDescription')"
    :confirm-label="t('actions.remove')"
    :cancel-label="t('canvas.cancel')"
    :disabled="state.readOnly"
    @update:open="
      (open) => {
        if (!open) commands.cancelRemoval();
      }
    "
    @confirm="commands.confirmRemoval()"
  />
  <EditorConfirmDialog
    :open="!!templates.pending.value"
    :title="t('templates.confirmReplace')"
    :description="t('templates.confirmReplaceDescription')"
    :confirm-label="t('actions.apply')"
    :cancel-label="t('canvas.cancel')"
    :disabled="state.readOnly || busy"
    :return-focus="templates.pending.value?.trigger"
    confirm-intent="primary"
    @update:open="
      (open) => {
        if (!open) templates.close();
      }
    "
    @confirm="applyTemplate"
  >
    <EditorTemplatePreview
      :html="templates.pending.value?.html ?? ''"
      :kind="state.document.kind"
      :title="t('templates.confirmReplace')"
      class="editor-template-confirm-preview"
    />
    <template #actions
      ><EditorButton :disabled="busy" @click="downloadRecovery">{{
        t('recovery.download')
      }}</EditorButton></template
    >
  </EditorConfirmDialog>
  <EditorConfirmDialog
    :open="!!sourceEdit"
    :title="t('canvas.editHtml')"
    :description="t('source.elementHelp')"
    :confirm-label="t('actions.apply')"
    :cancel-label="t('canvas.cancel')"
    :disabled="state.readOnly"
    confirm-intent="primary"
    initial-focus=".cm-content"
    wide
    @update:open="
      (open) => {
        if (!open) commands.cancelSource();
      }
    "
    @confirm="commands.applySource(source)"
  >
    <CodeEditor
      v-if="sourceEdit"
      :key="sourceEdit.id"
      :model-value="source"
      language="html"
      :label="t('source.elementLabel')"
      :description="t('editor.codeKeyboardHelp')"
      :readonly="state.readOnly"
      :error="commands.sourceProblems.value.map((key) => t(key)).join(' ')"
      @update:model-value="source = $event"
    />
  </EditorConfirmDialog>
  <EditorConfirmDialog
    :open="!!images.dialog.value"
    :title="t('actions.replaceImage')"
    :description="t('image.dialogHelp')"
    :confirm-label="t('actions.apply')"
    :cancel-label="t('canvas.cancel')"
    :disabled="state.readOnly"
    confirm-intent="primary"
    initial-focus="input"
    @update:open="
      (open) => {
        if (!open) images.cancel();
      }
    "
    @confirm="applyImage"
  >
    <EditorField :id="`${instanceId}-image-url`" :label="t('properties.image')" :error="imageError">
      <EditorInput
        :id="`${instanceId}-image-url`"
        v-model="imageUrl"
        type="url"
        placeholder="https://"
        :invalid="!!imageError"
      />
    </EditorField>
    <EditorField
      :id="`${instanceId}-image-alt`"
      :label="t('properties.alt')"
      :help="t('properties.altHelp')"
    >
      <EditorInput :id="`${instanceId}-image-alt`" v-model="imageAlt" />
    </EditorField>
  </EditorConfirmDialog>
  <EditorRecoveryDialog
    :open="props.recoveryOpen && !!state.pendingRichText"
    :html="state.pendingRichText?.html ?? ''"
    :read-only="state.readOnly"
    :invalid="!state.pendingRichText?.valid"
    :locale="locale"
    @update:open="emit('update:recoveryOpen', $event)"
    @update:html="workbench.properties.draftText($event)"
    @apply="applyRecovery"
    @discard="discardOpen = true"
    @download="downloadRecovery"
  />
  <EditorConfirmDialog
    :open="discardOpen"
    :title="t('recovery.confirmDiscard')"
    :description="t('recovery.confirmDiscardDescription')"
    :confirm-label="t('recovery.discard')"
    :cancel-label="t('canvas.cancel')"
    @update:open="discardOpen = $event"
    @confirm="discardRecovery"
  />
</template>
