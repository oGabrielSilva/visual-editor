<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import type { BlockDevice, BlockPropValue } from '../../../core/block-document';
import type { FieldTab } from '../../../blocks/block-type';
import type { BlockFieldModel } from '../../../blocks/block-inspector';
import { useBlockWorkbench } from '../../block-workbench';
import { BlockPresentation } from '../../services/block-presentation';
import BlockFieldControl from './BlockFieldControl.vue';
import BlockGlobalStyles from './BlockGlobalStyles.vue';
import BlockReview from './BlockReview.vue';
import EditorConfirmDialog from '../ui/EditorConfirmDialog.vue';
import EditorEmpty from '../ui/EditorEmpty.vue';
import EditorField from '../ui/EditorField.vue';
import EditorInput from '../ui/EditorInput.vue';
import { SAVED_BLOCK_LIMITS } from '../../services/saved-blocks';
import EditorIcon from '../ui/EditorIcon.vue';
import EditorIconButton from '../ui/EditorIconButton.vue';
import EditorScrollArea from '../ui/EditorScrollArea.vue';
import EditorTabs from '../ui/EditorTabs.vue';

const workbench = useBlockWorkbench();
const { state, locale } = workbench;
const t = workbench.t;
const presentation = new BlockPresentation();
const baseId = useId();
const tab = ref<FieldTab>('content');
const selectedId = computed(() => state.value.selectedBlockId);
/** The screen the frame shows: the tablet uses the values of large screens. */
const device = computed<BlockDevice>(() =>
  workbench.width.value === 'mobile' ? 'mobile' : 'desktop',
);
const block = computed(() => {
  void state.value.document.revision;
  const id = selectedId.value;
  if (!id) return undefined;
  const controller = workbench.controller();
  const labelKey = controller.labelKey(id);
  const type = controller.typeOf(id);
  return labelKey && type
    ? { id, type, labelKey, fields: controller.fields(id, device.value) }
    : undefined;
});
const tabs = computed(() =>
  (['content', 'style', 'advanced'] as const).map((value) => ({
    value,
    label: t(`properties.${value}`),
    disabled: !block.value?.fields.some((field) => field.tab === value),
  })),
);
// A block without fields in the current tab opens on its first tab that has some.
watch(
  tabs,
  (entries) => {
    if (!entries.find((entry) => entry.value === tab.value)?.disabled) return;
    const first = entries.find((entry) => !entry.disabled);
    if (first) tab.value = first.value;
  },
  { immediate: true },
);
/** The value typed in a field which the block refused, by field, until it changes or is valid. */
const errors = ref<Record<string, string>>({});
watch(selectedId, () => {
  errors.value = {};
});
const root = ref<HTMLElement>();
const heading = ref<HTMLElement>();
const reviewPanel = ref<InstanceType<typeof BlockReview>>();
/** The keyboard goes to the review, once the panel of the piece shows it. */
const focusReview = async (): Promise<void> => {
  await nextTick();
  await reviewPanel.value?.focus();
};
defineExpose({ focusReview });
/**
 * After a command that takes the panel away from the control the keyboard was on (remove, back
 * to the piece, parent), the keyboard goes to the heading of the panel now shown.
 */
const focusHeading = async (): Promise<void> => {
  await nextTick();
  (heading.value ?? root.value)?.focus({ preventScroll: true });
};
const disabled = computed(() => state.value.readOnly || workbench.busy.value);
const actions = computed(() => {
  const id = block.value?.id;
  return [
    { name: 'piece', icon: 'i-lucide-palette', labelKey: 'blockEditor.back' },
    { name: 'parent', icon: 'i-lucide-corner-left-up', labelKey: 'canvas.parent' },
    { name: 'up', icon: 'i-lucide-arrow-up', labelKey: 'canvas.up' },
    { name: 'down', icon: 'i-lucide-arrow-down', labelKey: 'canvas.down' },
    { name: 'duplicate', icon: 'i-lucide-copy', labelKey: 'canvas.duplicate' },
    ...(workbench.hasSavedBlocks.value && block.value?.type !== 'column'
      ? [{ name: 'save', icon: 'i-lucide-bookmark-plus', labelKey: 'savedBlocks.save' }]
      : []),
    { name: 'remove', icon: 'i-lucide-trash-2', labelKey: 'canvas.remove', danger: true },
  ].map((action) => ({
    ...action,
    enabled:
      !!id && (action.name === 'parent' ? !!workbench.controller().parentOf(id) : !disabled.value),
  }));
});
const act = async (name: string): Promise<void> => {
  const id = block.value?.id;
  if (!id) return;
  let moved = false;
  if (name === 'piece') moved = await workbench.run((editor) => editor.select(undefined), '');
  else if (name === 'parent') {
    const parent = workbench.controller().parentOf(id);
    if (parent) moved = await workbench.run((editor) => editor.select(parent), '');
  } else if (name === 'up' || name === 'down')
    void workbench.run((editor) => editor.step(id, name));
  else if (name === 'duplicate') void workbench.run((editor) => editor.duplicate(id));
  else if (name === 'save') {
    savingName.value = t(block.value?.labelKey ?? 'savedBlocks.title');
    saving.value = id;
  } else if (name === 'remove')
    moved = await workbench.run((editor) => editor.remove(id), 'feedback.removed');
  if (moved) await focusHeading();
};
/** The block being saved for later use, and the name typed for it. */
const saving = ref<string>();
const savingName = ref('');
const savingId = useId();
const nameValid = computed(() => {
  const name = savingName.value.trim();
  return name !== '' && name.length <= SAVED_BLOCK_LIMITS.name;
});
const confirmSave = async (): Promise<void> => {
  const id = saving.value;
  if (!id || !nameValid.value) return;
  saving.value = undefined;
  await workbench.saveBlock(id, savingName.value);
};
const settle = (key: string, applied: boolean): void => {
  const next = { ...errors.value };
  if (applied) delete next[key];
  else next[key] = t('properties.invalidValue');
  errors.value = next;
};
const change = async (key: string, value: BlockPropValue): Promise<void> => {
  const id = block.value?.id;
  const screen = device.value;
  if (id) settle(key, await workbench.run((editor) => editor.setField(id, key, value, screen)));
};
const restore = async (key: string): Promise<void> => {
  const id = block.value?.id;
  const screen = device.value;
  if (id) settle(key, await workbench.run((editor) => editor.restoreField(id, key, screen)));
};
/** On mobile a responsive field says it applies to small screens only, and what it inherits. */
const mobileField = (field: BlockFieldModel): boolean =>
  field.device === 'mobile' && field.responsive;
const marker = (field: BlockFieldModel): string | undefined => {
  if (mobileField(field))
    return t(field.own === undefined ? 'properties.mobileOnly' : 'properties.mobileOverride');
  return field.mobileOverride ? t('properties.hasMobileOverride') : undefined;
};
</script>

<template>
  <div
    ref="root"
    class="editor-properties"
    :data-block-properties="block?.id ?? 'piece'"
    role="region"
    :aria-label="t('editor.properties')"
    tabindex="-1"
  >
    <EditorScrollArea v-if="!block">
      <EditorEmpty
        icon="i-lucide-mouse-pointer-click"
        :title="t('editor.select')"
        :description="t('properties.selectHelp')"
      />
      <BlockReview ref="reviewPanel" />
      <BlockGlobalStyles />
    </EditorScrollArea>
    <template v-else>
      <p v-if="device === 'mobile'" class="editor-help editor-device-notice" data-device-notice>
        {{ t('properties.mobileEditing') }}
      </p>
      <header class="editor-selected">
        <EditorIcon
          :name="presentation.icon(block.type === 'column' ? 'canvas.column' : block.type)"
        />
        <div class="editor-selected-text">
          <h2 ref="heading" class="editor-selected-kind" tabindex="-1">{{ t(block.labelKey) }}</h2>
        </div>
        <div class="editor-block-actions" role="group" :aria-label="t('editor.selection')">
          <EditorIconButton
            v-for="item in actions"
            :key="item.name"
            :icon="item.icon"
            :label="t(item.labelKey)"
            :disabled="!item.enabled"
            :intent="item.danger ? 'destructive' : 'neutral'"
            @click="act(item.name)"
          />
        </div>
      </header>
      <EditorTabs v-model="tab" :items="tabs" :label="t('editor.properties')">
        <template v-for="entry in tabs" :key="entry.value" #[entry.value]>
          <EditorScrollArea>
            <div class="editor-property-content">
              <BlockFieldControl
                v-for="field in block.fields.filter((item) => item.tab === entry.value)"
                :id="`${baseId}-${block.id}-${field.key}`"
                :key="`${block.id}-${field.key}`"
                :control="field.control"
                :label-key="field.labelKey"
                :options="field.options"
                :own="field.own"
                :effective="field.effective"
                :locale="locale"
                :disabled="disabled"
                :image-picker="workbench.hasImagePicker.value"
                :error="errors[field.key]"
                :marker="marker(field)"
                :inherited-key="mobileField(field) ? 'properties.desktopValue' : undefined"
                :restore-key="mobileField(field) ? 'properties.useDesktopValue' : undefined"
                :data-block-field="field.key"
                :data-block-device="field.device"
                @change="change(field.key, $event)"
                @restore="restore(field.key)"
                @choose-image="workbench.chooseImage(block.id)"
              />
            </div>
          </EditorScrollArea>
        </template>
      </EditorTabs>
    </template>
    <EditorConfirmDialog
      :open="saving !== undefined"
      :title="t('savedBlocks.saveTitle')"
      :description="t('savedBlocks.saveDescription')"
      :confirm-label="t('savedBlocks.save')"
      :cancel-label="t('savedBlocks.cancel')"
      confirm-intent="primary"
      :disabled="!nameValid"
      :initial-focus="`#${savingId}`"
      @update:open="!$event && (saving = undefined)"
      @confirm="confirmSave()"
    >
      <EditorField :id="savingId" :label="t('savedBlocks.name')">
        <EditorInput
          :id="savingId"
          v-model="savingName"
          :maxlength="SAVED_BLOCK_LIMITS.name"
          data-saved-block-name
          @keydown.enter.prevent="confirmSave()"
        />
      </EditorField>
    </EditorConfirmDialog>
  </div>
</template>
