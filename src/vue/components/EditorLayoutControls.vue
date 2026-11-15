<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import * as v from 'valibot';
import {
  SECTION_LAYOUT_LIMITS,
  SECTION_LAYOUT_PRESETS,
  SECTION_STACKING,
  SECTION_BREAKPOINTS,
  SectionLayoutPatchSchema,
} from '../../core/section-layout';
import type { SectionLayoutContext, SectionLayoutPatch } from '../../core/section-layout';
import type { EditorLocale } from '../locale';
import EditorField from './ui/EditorField.vue';
import EditorSelect from './ui/EditorSelect.vue';
import EditorInput from './ui/EditorInput.vue';

const props = defineProps<{
  context: SectionLayoutContext;
  locale: EditorLocale;
  disabled: boolean;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ change: [patch: SectionLayoutPatch] }>();
const instanceId = useId();
const invalid = ref('');
const blocked = computed(() => props.disabled || props.busy || !props.context.editable);
const currentPreset = computed(
  () =>
    SECTION_LAYOUT_PRESETS.find(
      (preset) =>
        preset.ratios.length === props.context.ratios.length &&
        preset.ratios.every((weight, index) => weight === props.context.ratios[index]),
    )?.id ?? 'custom',
);
const presets = computed(() => [
  ...(currentPreset.value === 'custom'
    ? [{ value: 'custom', label: props.locale.text('properties.currentValue') }]
    : []),
  ...SECTION_LAYOUT_PRESETS.map((preset) => ({
    value: preset.id,
    label: props.locale.text(preset.titleKey),
    disabled: props.context.columnIds
      .slice(preset.ratios.length)
      .some((id) => !props.context.removableColumnIds.includes(id)),
  })),
]);
const stacking = computed(() =>
  SECTION_STACKING.map((value) => ({
    value,
    label: props.locale.text(`layout.stacking.${value}`),
  })),
);
const breakpoints = SECTION_BREAKPOINTS.map((value) => ({
  value: String(value),
  label: `${value} px`,
}));
const change = (patch: unknown): void => {
  if (blocked.value) return;
  const result = v.safeParse(SectionLayoutPatchSchema, patch);
  if (!result.success) {
    invalid.value = props.locale.text('properties.invalidValue');
    return;
  }
  invalid.value = '';
  emit('change', result.output);
};
const preset = (id: string): void => {
  const value = SECTION_LAYOUT_PRESETS.find((candidate) => candidate.id === id);
  if (value) change({ ratios: value.ratios });
};
const weight = (index: number, value: string): void => {
  const ratios = props.context.ratios.map((current, position) =>
    position === index ? Number(value) : current,
  );
  change({ ratios });
};
watch(
  () => props.context.id,
  () => {
    invalid.value = '';
  },
);
</script>

<template>
  <fieldset
    class="editor-authoring-controls"
    :aria-busy="busy"
    :aria-describedby="`${instanceId}-help${error ? ` ${instanceId}-error` : ''}`"
    :disabled="blocked"
  >
    <legend class="editor-field-label">{{ locale.text('layout.title') }}</legend>
    <p :id="`${instanceId}-help`" class="editor-help">{{ locale.text('layout.reduceHelp') }}</p>
    <p v-if="!context.editable" class="editor-help">
      {{ locale.text(context.reason === 'readonly' ? 'editor.readonly' : 'layout.unavailable') }}
    </p>
    <EditorField :id="`${instanceId}-preset`" :label="locale.text('properties.columns')">
      <EditorSelect
        :id="`${instanceId}-preset`"
        :model-value="currentPreset"
        :items="presets"
        :disabled="blocked"
        @change="preset"
      />
    </EditorField>
    <EditorField
      :id="`${instanceId}-weights`"
      :label="locale.text('layout.proportions')"
      :help="locale.text('layout.proportionsHelp')"
      :error="invalid"
      group
    >
      <div class="editor-column-weights">
        <EditorField
          v-for="(value, index) in context.ratios"
          :id="`${instanceId}-weight-${index}`"
          :key="context.columnIds[index] ?? index"
          :label="`${locale.text('canvas.column')} ${index + 1}`"
        >
          <EditorInput
            :id="`${instanceId}-weight-${index}`"
            type="number"
            live
            :model-value="String(value)"
            :min="1"
            :max="SECTION_LAYOUT_LIMITS.weight"
            :step="1"
            :disabled="blocked"
            :invalid="!!invalid"
            @change="weight(index, $event)"
          />
        </EditorField>
      </div>
    </EditorField>
    <EditorField :id="`${instanceId}-stacking`" :label="locale.text('layout.mobileOrder')">
      <EditorSelect
        :id="`${instanceId}-stacking`"
        :model-value="context.stacking"
        :items="stacking"
        :disabled="blocked"
        @change="change({ stacking: $event })"
      />
    </EditorField>
    <EditorField :id="`${instanceId}-breakpoint`" :label="locale.text('layout.breakpoint')">
      <EditorSelect
        :id="`${instanceId}-breakpoint`"
        :model-value="String(context.breakpoint)"
        :items="breakpoints"
        :disabled="blocked || context.stacking === 'none'"
        @change="change({ breakpoint: Number($event) })"
      />
    </EditorField>
    <p v-if="error" :id="`${instanceId}-error`" class="editor-control-error" role="alert">
      {{ error }}
    </p>
    <p v-if="busy" class="editor-help" role="status">{{ locale.text('feedback.busy') }}</p>
  </fieldset>
</template>
