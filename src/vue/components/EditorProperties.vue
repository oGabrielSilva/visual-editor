<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DocumentStyleProperty } from '../../application/document-presentation';
import { documentProjectionKey } from '../projection-key';
import { useWorkbench } from '../workbench';
import { useSelectionProperties } from '../properties/selection-properties';
import { BlockPresentation } from '../services/block-presentation';
import type { BlockCommandName } from '../services/block-command-definitions';
import EditorTabs from './ui/EditorTabs.vue';
import EditorScrollArea from './ui/EditorScrollArea.vue';
import EditorIconButton from './ui/EditorIconButton.vue';
import EditorIcon from './ui/EditorIcon.vue';
import EditorEmpty from './ui/EditorEmpty.vue';
import EditorDocumentStyles from './EditorDocumentStyles.vue';
import EditorDocumentMetadata from './EditorDocumentMetadata.vue';
import EditorPropertyContent from './properties/EditorPropertyContent.vue';
import EditorPropertyStyle from './properties/EditorPropertyStyle.vue';
import EditorPropertyAdvanced from './properties/EditorPropertyAdvanced.vue';

/**
 * The panel of the selected block, in three tabs. With nothing selected it shows the defaults of
 * the whole document. It holds no document logic: every field applies through the controller.
 */
defineProps<{ formPicker?: boolean }>();
const emit = defineEmits<{ 'request-form': [nodeId: string | undefined] }>();
const workbench = useWorkbench();
const { state, locale } = workbench;
const t = workbench.t;
const model = useSelectionProperties(workbench);
const { selected, region, disabled } = model;
const tab = ref('content');
const presentation = new BlockPresentation();
const documentErrors = ref<Partial<Record<DocumentStyleProperty, string>>>({});
const documentStyles = computed(() => {
  void documentProjectionKey(state.value);
  return workbench.controller().documentStyles();
});
const tabs = computed(() => [
  { value: 'content', label: t('properties.content') },
  { value: 'style', label: t('properties.style') },
  { value: 'advanced', label: t('properties.advanced') },
]);
const actions = computed(() =>
  workbench.commands
    .items(region.value?.id)
    .filter((item) =>
      (
        ['selectParent', 'moveUp', 'moveDown', 'duplicate', 'remove'] as BlockCommandName[]
      ).includes(item.name),
    ),
);
const updateDocumentStyle = (property: DocumentStyleProperty, value: string): void => {
  if (disabled.value) return;
  const ok = workbench.live.apply(`document:${property}`, () =>
    workbench.properties.documentStyle(property, value),
  );
  if (ok) {
    delete documentErrors.value[property];
    workbench.feedback.value = t('feedback.applied');
    return;
  }
  documentErrors.value[property] = t('properties.invalidValue');
  workbench.report('feedback.invalid');
};
/** Leaving a field ends its run of changes: the next field is another history step. */
const focusMoved = (event: FocusEvent): void => {
  const field = (node: EventTarget | null): Element | null =>
    node instanceof Element ? node.closest('.editor-field') : null;
  if (field(event.target) !== field(event.relatedTarget)) workbench.live.close();
};
</script>

<template>
  <div class="editor-properties" @focusout="focusMoved">
    <template v-if="!selected">
      <EditorScrollArea>
        <EditorEmpty
          icon="i-lucide-mouse-pointer-click"
          :title="t('editor.select')"
          :description="t('properties.selectHelp')"
        />
        <EditorDocumentMetadata />
        <EditorDocumentStyles
          :context="documentStyles"
          :locale="locale"
          :disabled="disabled"
          :errors="documentErrors"
          @change="updateDocumentStyle"
        />
      </EditorScrollArea>
    </template>
    <template v-else>
      <header class="editor-selected">
        <EditorIcon v-if="region" :name="presentation.regionIcon(region)" />
        <div class="editor-selected-text">
          <strong class="editor-selected-kind">{{
            region ? t(presentation.regionLabelKey(region)) : selected.tag
          }}</strong>
          <span class="editor-selected-title">{{
            selected.labelKey ? t(selected.labelKey) : selected.label
          }}</span>
        </div>
        <div class="editor-block-actions" role="group" :aria-label="t('editor.selection')">
          <EditorIconButton
            v-for="item in actions"
            :key="item.name"
            :icon="item.icon"
            :label="t(item.labelKey)"
            :kbds="item.keys ?? []"
            :disabled="!item.enabled"
            :intent="item.danger ? 'destructive' : 'neutral'"
            @click="workbench.commands.run(item.name, region?.id)"
          />
        </div>
      </header>
      <EditorTabs v-model="tab" :items="tabs" :label="t('editor.properties')">
        <template #content>
          <EditorScrollArea>
            <EditorPropertyContent
              :model="model"
              :form-picker="!!formPicker"
              @request-form="emit('request-form', $event)"
            />
          </EditorScrollArea>
        </template>
        <template #style>
          <EditorScrollArea><EditorPropertyStyle :model="model" /></EditorScrollArea>
        </template>
        <template #advanced>
          <EditorScrollArea><EditorPropertyAdvanced :model="model" /></EditorScrollArea>
        </template>
      </EditorTabs>
    </template>
  </div>
</template>
