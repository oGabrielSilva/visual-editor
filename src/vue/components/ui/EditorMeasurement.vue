<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EditorLocale } from '../../locale';
import { NumericStyleValue } from './numeric-style-value';
import EditorInput from './EditorInput.vue';
import EditorButton from './EditorButton.vue';
import EditorSelect from './EditorSelect.vue';
import EditorField from './EditorField.vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    id: string;
    locale: EditorLocale;
    units?: readonly string[];
    minimum?: number;
    maximum?: number;
    maximumByUnit?: Readonly<Record<string, number>>;
    disabled?: boolean;
    label?: string;
    mixed?: boolean;
    inherited?: boolean;
    inheritedLabel?: string;
    resetLabel?: string;
  }>(),
  {
    units: () => ['px', 'rem', 'em', '%'],
    minimum: 0,
    maximum: 10000,
    maximumByUnit: () => ({}),
    disabled: false,
    label: '',
    inherited: false,
    inheritedLabel: '',
    mixed: false,
    resetLabel: '',
  },
);
const emit = defineEmits<{ change: [value: string] }>();
const measure = computed(
  () => new NumericStyleValue(props.units, props.minimum, props.maximum, props.maximumByUnit),
);
const amount = ref('');
const unit = ref(props.units[0] ?? 'px');
const error = ref('');
const unsupported = computed(
  () =>
    !!props.modelValue && props.modelValue !== 'inherit' && !measure.value.parse(props.modelValue),
);
const choices = computed(() =>
  props.units.map((value) => ({
    value: value || 'number',
    label: value || props.locale.text('properties.unitNumber'),
  })),
);
const synchronize = (): void => {
  const value = measure.value.parse(props.modelValue);
  amount.value = value ? String(value.amount) : '';
  unit.value = value?.unit ?? props.units[0] ?? 'px';
  error.value = '';
};
watch(
  () => [
    props.modelValue,
    props.mixed,
    props.units,
    props.minimum,
    props.maximum,
    props.maximumByUnit,
  ],
  synchronize,
  {
    immediate: true,
  },
);
const commit = (): void => {
  if (props.disabled) return;
  const value = measure.value.create(amount.value, unit.value);
  if (value === undefined) {
    error.value = props.locale.text('properties.invalidNumber');
    return;
  }
  error.value = '';
  if (value !== props.modelValue) emit('change', value);
};
const changeUnit = (value: string): void => {
  unit.value = value === 'number' ? '' : value;
  if (amount.value.trim()) commit();
};
</script>

<template>
  <div class="editor-measurement">
    <div class="editor-measurement-controls">
      <EditorField
        :id="id"
        :label="label || locale.text('properties.currentValue')"
        :error="error"
        label-hidden
      >
        <EditorInput
          :id="id"
          :model-value="amount"
          type="number"
          live
          :min="minimum"
          :max="maximumByUnit[unit] ?? maximum"
          step="any"
          :disabled="disabled"
          :invalid="!!error"
          :placeholder="mixed ? locale.text('properties.mixedValue') : inheritedLabel"
          @update:model-value="amount = $event"
          @change="commit"
        />
      </EditorField>
      <EditorField :id="`${id}-unit`" :label="locale.text('properties.unit')" label-hidden>
        <EditorSelect
          :id="`${id}-unit`"
          :model-value="unit || 'number'"
          :items="choices"
          :disabled="disabled"
          :label="locale.text('properties.unit')"
          @change="changeUnit"
        />
      </EditorField>
    </div>
    <p v-if="mixed" class="editor-help">{{ locale.text('properties.mixedValue') }}</p>
    <p v-else-if="inherited" class="editor-help">
      {{ inheritedLabel || locale.text('properties.inherited') }}
    </p>
    <EditorButton
      v-if="mixed || (!inherited && modelValue && modelValue !== 'inherit')"
      :disabled="disabled"
      @click="emit('change', 'inherit')"
      >{{ resetLabel || locale.text('actions.resetStyle') }}</EditorButton
    >
    <p v-if="unsupported" class="editor-help">
      {{ locale.text('properties.currentValue') }} {{ modelValue }}.
      {{ locale.text('properties.valuePreserved') }}
    </p>
  </div>
</template>
