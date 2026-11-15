<script setup lang="ts">
import { ref, useId, watch } from 'vue';
import { IMAGE_SIZE_LIMITS } from '../../application/document-presentation';
import type { ImageSizeContext, ImageSizeSettings } from '../../application/document-presentation';
import type { EditorLocale } from '../locale';
import { NumericStyleValue } from './ui/numeric-style-value';
import EditorInput from './ui/EditorInput.vue';
import EditorField from './ui/EditorField.vue';
import EditorCheckbox from './ui/EditorCheckbox.vue';

const props = defineProps<{
  context: ImageSizeContext;
  locale: EditorLocale;
  disabled: boolean;
  error: string;
}>();
const emit = defineEmits<{ change: [settings: ImageSizeSettings] }>();
const instanceId = useId();
const width = ref('');
const height = ref('');
const preserveRatio = ref(!!props.context.ratio);
const invalid = ref('');
const dimensions = new NumericStyleValue(['px'], IMAGE_SIZE_LIMITS.min, IMAGE_SIZE_LIMITS.max);
watch(
  () => [props.context.id, props.context.width, props.context.height],
  () => {
    width.value = props.context.width === undefined ? '' : String(props.context.width);
    height.value = props.context.height === undefined ? '' : String(props.context.height);
    invalid.value = '';
  },
  { immediate: true },
);
watch(
  () => props.context.id,
  () => {
    preserveRatio.value = !!props.context.ratio;
  },
);
watch(
  () => props.context.ratio,
  (ratio) => {
    if (!ratio) preserveRatio.value = false;
  },
);
const change = (): void => {
  if (props.disabled) return;
  const parsedWidth = dimensions.parse(`${width.value}px`);
  const parsedHeight = height.value ? dimensions.parse(`${height.value}px`) : undefined;
  if (!parsedWidth || (!preserveRatio.value && height.value && !parsedHeight)) {
    invalid.value = props.locale.text('properties.invalidValue');
    return;
  }
  invalid.value = '';
  emit('change', {
    width: parsedWidth.amount,
    ...(preserveRatio.value && props.context.ratio
      ? { preserveRatio: true }
      : parsedHeight
        ? { height: parsedHeight.amount }
        : {}),
  });
};
</script>

<template>
  <fieldset
    class="editor-authoring-controls"
    :disabled="disabled"
    :aria-describedby="`${instanceId}-help`"
  >
    <legend class="editor-field-label">{{ locale.text('properties.imageDimensions') }}</legend>
    <p :id="`${instanceId}-help`" class="editor-help">
      {{ locale.text('properties.imageSizeHelp') }}
    </p>
    <EditorCheckbox
      v-if="context.ratio"
      :id="`${instanceId}-ratio`"
      :model-value="preserveRatio"
      :label="locale.text('properties.preserveRatio')"
      :disabled="disabled"
      @change="preserveRatio = $event"
    />
    <p v-else class="editor-help">{{ locale.text('properties.unknownRatio') }}</p>
    <EditorField
      :id="`${instanceId}-width`"
      :label="locale.text('properties.width')"
      :error="invalid || error"
    >
      <EditorInput
        :id="`${instanceId}-width`"
        :model-value="width"
        type="number"
        live
        :min="IMAGE_SIZE_LIMITS.min"
        :max="IMAGE_SIZE_LIMITS.max"
        :step="0.001"
        :disabled="disabled"
        :invalid="!!invalid || !!error"
        @update:model-value="width = $event"
        @change="change"
      />
    </EditorField>
    <EditorField :id="`${instanceId}-height`" :label="locale.text('properties.height')">
      <EditorInput
        :id="`${instanceId}-height`"
        :model-value="height"
        type="number"
        live
        :min="IMAGE_SIZE_LIMITS.min"
        :max="IMAGE_SIZE_LIMITS.max"
        :step="0.001"
        :placeholder="locale.text('properties.autoDimension')"
        :disabled="disabled || preserveRatio"
        @update:model-value="height = $event"
        @change="change"
      />
    </EditorField>
  </fieldset>
</template>
