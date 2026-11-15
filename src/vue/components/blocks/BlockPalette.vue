<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { BlockNodeType, BlockProps } from '../../../core/block-document';
import { escapeHtml } from '../../../core/html-escape';
import { useBlockWorkbench } from '../../block-workbench';
import { BlockPresentation } from '../../services/block-presentation';
import EditorButton from '../ui/EditorButton.vue';
import EditorConfirmDialog from '../ui/EditorConfirmDialog.vue';
import EditorIconButton from '../ui/EditorIconButton.vue';
import type { EditorSavedBlock } from '../../services/saved-blocks';
import EditorPropertyGroup from '../ui/EditorPropertyGroup.vue';

/**
 * The blocks of the kind of the piece and the templates to start from. A block goes after the
 * selection (inside it, when it is a container that accepts it) or at the end of the piece.
 */
const workbench = useBlockWorkbench();
const { state } = workbench;
const t = workbench.t;
const presentation = new BlockPresentation();
const blocks = computed(() => {
  void state.value.document.kind;
  return workbench.controller().types();
});
const templates = computed(() => {
  void state.value.document.kind;
  return workbench.controller().templates();
});
const groups = computed(() => [
  { id: 'blocks', label: t('blockEditor.palette'), openByDefault: true },
  ...(workbench.hasSavedBlocks.value
    ? [{ id: 'saved', label: t('savedBlocks.title'), openByDefault: true }]
    : []),
  { id: 'templates', label: t('blockEditor.templates'), openByDefault: true },
]);
const saved = workbench.savedBlocks;
// The saved blocks of the kind of the piece: read when the palette mounts and for each piece.
onMounted(() => void workbench.loadSavedBlocks());
watch(
  () => [state.value.document.id, state.value.document.kind],
  () => void workbench.loadSavedBlocks(),
);
const insertSaved = (entry: EditorSavedBlock): void => {
  void workbench.insertSavedBlock(entry);
};
const removing = ref<EditorSavedBlock>();
const removeTrigger = ref<HTMLElement>();
const askRemove = (entry: EditorSavedBlock, event: Event): void => {
  removeTrigger.value =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
  removing.value = entry;
};
const confirmRemove = async (): Promise<void> => {
  const entry = removing.value;
  removing.value = undefined;
  if (entry) await workbench.removeSavedBlock(entry);
};
const canRemove = computed(() => workbench.canRemoveSavedBlocks.value);
const disabled = computed(() => state.value.readOnly || workbench.busy.value);
/** A new text block starts with a sentence to replace, so it can be seen and clicked. */
const starter = (type: BlockNodeType): BlockProps => {
  const line = (key: string): string => escapeHtml(t(key));
  if (type === 'text') return { text: `<p>${line('blockEditor.newText')}</p>` };
  if (type === 'footer') return { text: `<p>${line('blockEditor.newFooter')}</p>` };
  if (type === 'heading') return { text: line('blockEditor.newHeading') };
  if (type === 'button') return { text: line('blockEditor.newButton') };
  return {};
};
const add = (type: BlockNodeType): void => {
  void workbench.run((editor) => editor.insert(type, undefined, starter(type)));
};
const apply = (id: string): void => {
  void workbench.run((editor) => editor.applyTemplate(id));
};
const root = ref<HTMLElement>();
defineExpose({
  /** The "+" of a block in the piece puts the keyboard here, on the first block. */
  focus: () => root.value?.querySelector<HTMLElement>('[data-block-palette-type]')?.focus(),
});
</script>

<template>
  <div ref="root" class="editor-palette" data-block-palette>
    <EditorPropertyGroup :groups="groups" context-id="block-palette">
      <template #blocks>
        <p class="editor-help">{{ t('blockEditor.paletteHint') }}</p>
        <div class="editor-palette-grid" role="list" :aria-label="t('blockEditor.palette')">
          <div v-for="block in blocks" :key="block.type" role="listitem">
            <EditorButton
              intent="secondary"
              block
              :icon="presentation.icon(block.type)"
              :disabled="disabled"
              :data-block-palette-type="block.type"
              class="editor-palette-block"
              @click="add(block.type)"
              >{{ t(block.labelKey) }}</EditorButton
            >
          </div>
        </div>
      </template>
      <template #saved>
        <p class="editor-help">
          {{ saved.length ? t('savedBlocks.hint') : t('savedBlocks.empty') }}
        </p>
        <div
          v-if="saved.length"
          class="editor-template-list"
          role="list"
          :aria-label="t('savedBlocks.title')"
        >
          <div
            v-for="entry in saved"
            :key="entry.id"
            role="listitem"
            class="editor-saved-block"
            :data-saved-block="entry.id"
          >
            <EditorButton
              intent="secondary"
              block
              :disabled="disabled"
              :icon="presentation.icon(entry.block.type)"
              @click="insertSaved(entry)"
              >{{ entry.name }}</EditorButton
            >
            <EditorIconButton
              v-if="canRemove"
              icon="i-lucide-trash-2"
              intent="destructive"
              :label="`${t('savedBlocks.remove')}: ${entry.name}`"
              :disabled="disabled"
              @click="askRemove(entry, $event)"
            />
          </div>
        </div>
      </template>
      <template #templates>
        <p class="editor-help">{{ t('blockEditor.templatesHint') }}</p>
        <div class="editor-template-list" role="list" :aria-label="t('blockEditor.templates')">
          <div v-for="template in templates" :key="template.id" role="listitem">
            <EditorButton
              intent="secondary"
              block
              :disabled="disabled"
              :data-block-template="template.id"
              :title="t(template.descriptionKey)"
              @click="apply(template.id)"
              >{{ t(template.titleKey) }}</EditorButton
            >
          </div>
        </div>
      </template>
    </EditorPropertyGroup>
    <EditorConfirmDialog
      :open="removing !== undefined"
      :title="t('savedBlocks.removeTitle')"
      :description="
        removing ? t('savedBlocks.removeDescription').replace('{name}', removing.name) : ''
      "
      :confirm-label="t('savedBlocks.remove')"
      :cancel-label="t('savedBlocks.cancel')"
      :return-focus="removeTrigger"
      @update:open="!$event && (removing = undefined)"
      @confirm="confirmRemove()"
    />
  </div>
</template>
