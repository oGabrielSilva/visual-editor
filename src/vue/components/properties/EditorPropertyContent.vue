<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useWorkbench } from '../../workbench';
import type { SelectionProperties } from '../../properties/selection-properties';
import RichTextEditor from '../RichTextEditor.vue';
import EditorButton from '../ui/EditorButton.vue';
import EditorField from '../ui/EditorField.vue';
import EditorInput from '../ui/EditorInput.vue';
import EditorSelect from '../ui/EditorSelect.vue';
import EditorVariablePicker from '../ui/EditorVariablePicker.vue';
import EditorEmpty from '../ui/EditorEmpty.vue';

/** What the block says and where it leads: its text, its link, its image, its form. */
const props = defineProps<{ model: SelectionProperties; formPicker: boolean }>();
const emit = defineEmits<{ 'request-form': [nodeId: string] }>();
const workbench = useWorkbench();
const { state, locale } = workbench;
const t = workbench.t;
const instanceId = useId();
const fieldId = (name: string): string => `${instanceId}-${name}`;
const ownerGeneration = ref(0);
const richTextEditor = ref<InstanceType<typeof RichTextEditor>>();
const { selected, capabilities, errors, disabled, imageLink } = props.model;
const { attribute, hasAttribute, updateAttribute, choices, withCurrent } = props.model;
const { apply, applyLive } = props.model;
watch(
  () => workbench.controller(),
  () => ownerGeneration.value++,
);
const richText = computed(() => {
  void state.value;
  return selected.value ? workbench.controller().richTextFor(selected.value.id) : undefined;
});
const targets = computed(() =>
  choices([
    ['_self', 'properties.targetSame'],
    ['_blank', 'properties.targetNew'],
  ]),
);
const assetBound = computed(
  () =>
    !!(
      selected.value?.node.attrs?.['data-host-asset-id'] ||
      selected.value?.node.attrs?.['data-lyads-asset-id']
    ),
);
const beginText = (): void => {
  const id = selected.value?.id;
  if (!disabled.value && id) workbench.properties.beginText(id);
};
const changeText = (value: string): void => {
  const id = selected.value?.id;
  if (disabled.value || !id) return;
  if (!state.value.pendingRichText && !workbench.properties.beginText(id)) return;
  if (!workbench.properties.draftText(value)) errors.value.text = t('properties.invalidValue');
};
const finishText = (): boolean =>
  !state.value.pendingRichText || apply('text', () => workbench.properties.commitText());
const history = (direction: 'undo' | 'redo'): void => {
  if (finishText()) workbench.documentHistory(direction, 'feedback.applied');
};
const updateImageLink = (href: string, target?: string): void => {
  applyLive('imageLink', () =>
    workbench.properties.imageLink(
      href,
      target === '_blank' || target === '_self' ? { target } : undefined,
    ),
  );
};
/** A link variable replaces the destination: a link is one address, not a text with pieces. */
const linkVariable = (key: string): void => {
  updateAttribute('href', `{{${key}}}`);
};
const empty = computed(
  () =>
    !(capabilities.value?.richText && richText.value !== undefined) &&
    !hasAttribute('href') &&
    selected.value?.node.tag !== 'img' &&
    selected.value?.node.attrs?.['data-host-slot'] !== 'form',
);
workbench.panelText.value = {
  insertText: (value) => !disabled.value && !!richTextEditor.value?.insertText(value),
  history: (direction) => !disabled.value && !!richTextEditor.value?.history(direction),
  canHistory: (direction) => !disabled.value && !!richTextEditor.value?.canHistory(direction),
};
onBeforeUnmount(() => {
  workbench.panelText.value = undefined;
});
</script>

<template>
  <div v-if="selected" class="editor-property-content">
    <EditorEmpty
      v-if="empty"
      icon="i-lucide-square-dashed"
      :title="t('properties.noContent')"
      :description="t('properties.noContentHelp')"
    />
    <template v-if="capabilities?.richText && richText !== undefined">
      <EditorButton
        intent="secondary"
        icon="i-lucide-square-pen"
        :disabled="disabled"
        @click="workbench.commands.run('editText', selected.id)"
        >{{ t('canvas.edit') }}</EditorButton
      >
      <p v-if="selected.id === workbench.inlineEditingId.value" class="editor-help">
        {{ t('properties.editingInPlace') }}
      </p>
      <RichTextEditor
        v-else
        :id="fieldId(`text-${selected.id}`)"
        ref="richTextEditor"
        :key="`${ownerGeneration}:${state.document.id}:${selected.id}:${state.document.revision}`"
        :html="richText"
        :readonly="disabled"
        :allow-blocks="capabilities.blocks"
        :allow-links="selected.node.tag !== 'a'"
        :locale="locale"
        :variables="workbench.variables()"
        :link-policy="workbench.controller().linkPolicy()"
        @focus="beginText"
        @change="changeText"
        @blur="finishText"
        @finish="finishText"
        @cancel="workbench.properties.cancelText()"
        @history="history"
        @error="workbench.report($event)"
      />
      <p v-if="errors.text" class="editor-control-error" role="alert">{{ errors.text }}</p>
    </template>
    <template v-if="hasAttribute('href')">
      <EditorField :id="fieldId('link')" :label="t('properties.link')" :error="errors.href">
        <EditorInput
          :id="fieldId('link')"
          :model-value="attribute('href')"
          type="url"
          live
          :disabled="disabled"
          :invalid="!!errors.href"
          @change="updateAttribute('href', $event)"
        />
      </EditorField>
      <EditorVariablePicker
        :variables="workbench.variables()"
        purpose="url"
        :locale="locale"
        :disabled="disabled"
        @insert="linkVariable"
      />
    </template>
    <EditorField
      v-if="hasAttribute('target')"
      :id="fieldId('target')"
      :label="t('properties.target')"
      :error="errors.target"
    >
      <EditorSelect
        :id="fieldId('target')"
        :model-value="attribute('target') || '_self'"
        :disabled="disabled"
        :items="withCurrent(attribute('target'), targets)"
        @change="updateAttribute('target', $event)"
      />
    </EditorField>
    <template v-if="selected.node.tag === 'img'">
      <EditorButton
        intent="secondary"
        icon="i-lucide-image"
        :disabled="disabled"
        :loading="workbench.images.busy.value"
        @click="workbench.commands.run('replaceImage', selected.id)"
        >{{ t('actions.replaceImage') }}</EditorButton
      >
      <EditorField
        v-if="hasAttribute('src')"
        :id="fieldId('src')"
        :label="t('properties.image')"
        :error="errors.src"
        v-bind="assetBound ? { help: t('properties.imageBound') } : {}"
      >
        <EditorInput
          :id="fieldId('src')"
          :model-value="attribute('src')"
          type="url"
          live
          :disabled="disabled || assetBound"
          :invalid="!!errors.src"
          @change="updateAttribute('src', $event)"
        />
      </EditorField>
      <EditorField
        v-if="hasAttribute('alt')"
        :id="fieldId('alt')"
        :label="t('properties.alt')"
        :help="t('properties.altHelp')"
        :error="errors.alt"
      >
        <EditorInput
          :id="fieldId('alt')"
          :model-value="attribute('alt')"
          live
          :disabled="disabled"
          :invalid="!!errors.alt"
          @change="updateAttribute('alt', $event)"
        />
      </EditorField>
      <EditorField
        v-if="imageLink"
        :id="fieldId('image-link')"
        :label="t('properties.link')"
        :error="errors.imageLink"
        v-bind="!imageLink.editable ? { help: t('properties.imageLinkLimited') } : {}"
      >
        <EditorInput
          :id="fieldId('image-link')"
          :model-value="imageLink.href"
          type="url"
          live
          :disabled="disabled || !imageLink.editable"
          :invalid="!!errors.imageLink"
          @change="updateImageLink($event)"
        />
      </EditorField>
      <EditorField
        v-if="imageLink?.href"
        :id="fieldId('image-link-target')"
        :label="t('properties.target')"
      >
        <EditorSelect
          :id="fieldId('image-link-target')"
          :model-value="imageLink.target"
          :items="targets"
          :disabled="disabled || !imageLink.editable"
          @change="updateImageLink(imageLink?.href ?? '', $event)"
        />
      </EditorField>
      <EditorButton
        v-if="imageLink?.href"
        icon="i-lucide-unlink"
        :disabled="disabled || !imageLink.editable"
        @click="updateImageLink('')"
        >{{ t('actions.removeLink') }}</EditorButton
      >
    </template>
    <EditorField
      v-if="selected.node.attrs?.['data-host-slot'] === 'form'"
      :id="fieldId('form')"
      :label="t('blocks.form')"
      :help="t('editor.formHelp')"
    >
      <EditorButton
        v-if="formPicker"
        intent="secondary"
        :disabled="disabled"
        @click="emit('request-form', selected.id)"
        >{{ t('actions.form') }}</EditorButton
      >
    </EditorField>
  </div>
</template>
