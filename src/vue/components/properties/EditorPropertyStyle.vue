<script setup lang="ts">
import { ref, useId, watch } from 'vue';
import type { ImageSizeSettings } from '../../../application/document-presentation';
import type { SectionLayoutPatch } from '../../../core/section-layout';
import { useWorkbench } from '../../workbench';
import type { SelectionProperties } from '../../properties/selection-properties';
import EditorField from '../ui/EditorField.vue';
import EditorSelect from '../ui/EditorSelect.vue';
import EditorColorInput from '../ui/EditorColorInput.vue';
import EditorMeasurement from '../ui/EditorMeasurement.vue';
import EditorPropertyGroup from '../ui/EditorPropertyGroup.vue';
import EditorEmpty from '../ui/EditorEmpty.vue';
import EditorLayoutControls from '../EditorLayoutControls.vue';
import EditorImageSizeControls from '../EditorImageSizeControls.vue';

/** How the block looks: columns, size, typography, colors, spacing and borders. */
const props = defineProps<{ model: SelectionProperties }>();
const workbench = useWorkbench();
const { locale } = workbench;
const t = workbench.t;
const instanceId = useId();
const fieldId = (name: string): string => `${instanceId}-${name}`;
const { selected, errors, disabled, imageSize, layout, groups } = props.model;
const { style, inherited, updateStyle, withCurrent, applyLive } = props.model;
const layoutBusy = ref(false);
const layoutError = ref('');
watch(
  () => selected.value?.id,
  () => {
    layoutError.value = '';
  },
);
const updateImageSize = (settings: ImageSizeSettings): void => {
  applyLive('imageSize', () => workbench.properties.imageSize(settings));
};
const updateLayout = async (patch: SectionLayoutPatch): Promise<void> => {
  const owner = workbench.controller();
  const target = layout.value?.id;
  if (disabled.value || layoutBusy.value || !target) return;
  layoutBusy.value = true;
  layoutError.value = '';
  try {
    const changed = await workbench.properties.layout(patch);
    if (owner !== workbench.controller() || target !== layout.value?.id) return;
    if (changed) {
      workbench.feedback.value = t('feedback.applied');
      return;
    }
    const code = owner.state().diagnostics.at(-1)?.code;
    layoutError.value = t(
      code === 'LAYOUT_COLUMN_NOT_EMPTY'
        ? 'layout.reduceHelp'
        : code === 'LAYOUT_IDENTITY_BEARING_COLUMN'
          ? 'layout.linkedColumn'
          : 'layout.changeFailed',
    );
    workbench.report('feedback.invalid');
  } catch {
    if (owner === workbench.controller()) layoutError.value = t('layout.changeFailed');
  } finally {
    layoutBusy.value = false;
  }
};
</script>

<template>
  <div v-if="selected" class="editor-property-style">
    <EditorEmpty
      v-if="!layout && !imageSize && !groups.length"
      icon="i-lucide-palette"
      :title="t('properties.noStyle')"
      :description="t('properties.native')"
    />
    <EditorLayoutControls
      v-if="layout"
      :key="layout.id"
      :context="layout"
      :locale="locale"
      :disabled="disabled"
      :busy="layoutBusy"
      :error="layoutError"
      @change="updateLayout"
    />
    <EditorImageSizeControls
      v-if="imageSize"
      :key="imageSize.id"
      :context="imageSize"
      :locale="locale"
      :disabled="disabled"
      :error="errors.imageSize ?? ''"
      @change="updateImageSize"
    />
    <EditorPropertyGroup v-if="groups.length" :groups="groups" :context-id="selected.id">
      <template v-for="group in groups" :key="group.id" #[group.id]>
        <EditorField
          v-for="control in group.colors"
          :id="fieldId(control.name)"
          :key="control.name"
          group
          :label="t(control.label)"
          :error="errors[control.name]"
        >
          <EditorColorInput
            :id="fieldId(control.name)"
            :model-value="style(control.name)"
            :inherited="inherited(control.name)"
            :disabled="disabled"
            :locale="locale"
            @change="updateStyle(control.name, $event)"
          />
        </EditorField>
        <EditorField
          v-for="control in group.selections"
          :id="fieldId(control.name)"
          :key="control.name"
          :label="control.label"
          :error="errors[control.name]"
        >
          <EditorSelect
            :id="fieldId(control.name)"
            :model-value="style(control.name) || 'inherit'"
            :items="withCurrent(style(control.name), control.items)"
            :disabled="disabled"
            @change="updateStyle(control.name, $event)"
          />
        </EditorField>
        <EditorField
          v-for="control in group.measures"
          :id="fieldId(control.name)"
          :key="control.name"
          group
          :label="t(control.label)"
          :error="errors[control.name]"
        >
          <EditorMeasurement
            :id="fieldId(control.name)"
            :model-value="style(control.name)"
            :label="t(control.label)"
            :inherited="inherited(control.name)"
            :units="control.units"
            :minimum="control.minimum"
            :disabled="disabled"
            :locale="locale"
            @change="updateStyle(control.name, $event)"
          />
        </EditorField>
      </template>
    </EditorPropertyGroup>
  </div>
</template>
