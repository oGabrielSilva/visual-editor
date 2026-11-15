<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Debouncer } from '../../services/live-change';
import UColorPicker from '@nuxt/ui/components/ColorPicker.vue';
import EditorContextPopover from './EditorContextPopover.vue';
import type { EditorLocale } from '../../locale';
import { ColorStyleValue } from './color-style-value';
import EditorInput from './EditorInput.vue';
import EditorButton from './EditorButton.vue';
import EditorField from './EditorField.vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    id: string;
    locale: EditorLocale;
    disabled?: boolean;
    inherited?: boolean;
    inheritedLabel?: string;
    resetLabel?: string;
    /** Accessible name of the reset button, naming the field it resets. */
    resetAccessibleLabel?: string;
    mixed?: boolean;
  }>(),
  {
    disabled: false,
    inherited: false,
    mixed: false,
    resetLabel: '',
    resetAccessibleLabel: '',
    inheritedLabel: '',
  },
);
const emit = defineEmits<{ change: [value: string] }>();
const colors = new ColorStyleValue();
const draft = ref(props.modelValue === 'inherit' ? '' : props.modelValue);
const error = ref('');
const pickerOpen = ref(false);
const swatch = computed(() => (!props.mixed ? colors.normalize(props.modelValue) : undefined));
const unsupported = computed(
  () => !!props.modelValue && props.modelValue !== 'inherit' && !swatch.value,
);
const opacity = computed(() => colors.opacity(props.modelValue));
watch(
  () => [props.modelValue, props.mixed] as const,
  ([value, mixed]) => {
    draft.value = mixed || value === 'inherit' ? '' : value;
    error.value = '';
  },
);
const commit = (input: string): void => {
  if (props.disabled) return;
  const value = colors.normalize(input);
  if (!value) {
    error.value = props.locale.text('properties.invalidColor');
    return;
  }
  error.value = '';
  draft.value = value;
  if (value !== props.modelValue) emit('change', value);
};
// Dragging in the picker reports a color per frame; the document takes the one it rests on.
const picking = new Debouncer();
const pick = (value: string | undefined): void => {
  if (value === undefined) return;
  const normalized = colors.preserveAlpha(value, props.modelValue);
  if (normalized) picking.schedule(() => commit(normalized));
};
onBeforeUnmount(() => picking.flush());
const changeOpacity = (value: string): void => {
  const normalized = colors.withOpacity(props.modelValue, Number(value));
  if (normalized && value.trim()) commit(normalized);
  else error.value = props.locale.text('properties.invalidNumber');
};
</script>

<template>
  <div class="editor-color-control">
    <div class="editor-color-inputs">
      <EditorContextPopover
        :open="pickerOpen"
        :label="locale.text('properties.chooseColor')"
        :disabled="disabled"
        @update:open="pickerOpen = $event"
      >
        <template #trigger="{ triggerAttrs }">
          <EditorButton
            v-bind="{ ...triggerAttrs, ...(!swatch ? { icon: 'i-lucide-plus' } : {}) }"
            :disabled="disabled"
            :aria-label="locale.text('properties.chooseColor')"
            :title="locale.text('properties.chooseColor')"
            @mousedown.prevent
          >
            <span
              v-if="swatch"
              class="editor-color-swatch"
              :style="{ backgroundColor: swatch }"
              aria-hidden="true"
            />
          </EditorButton>
        </template>
        <template #default>
          <div
            class="editor-color-picker"
            role="group"
            :aria-label="locale.text('properties.chooseColor')"
          >
            <UColorPicker
              :model-value="colors.opaque(modelValue) ?? '#ffffff'"
              :disabled="disabled"
              format="hex"
              @update:model-value="pick"
            />
            <EditorField
              v-if="swatch"
              :id="`${id}-opacity`"
              :label="locale.text('properties.opacity')"
            >
              <EditorInput
                :id="`${id}-opacity`"
                type="number"
                live
                :model-value="String(opacity)"
                :min="0"
                :max="100"
                :disabled="disabled"
                @change="changeOpacity"
              />
            </EditorField>
          </div>
        </template>
      </EditorContextPopover>
      <EditorField
        :id="id"
        :label="locale.text('properties.colorValue')"
        :error="error"
        label-hidden
      >
        <EditorInput
          :id="id"
          :model-value="draft"
          :placeholder="
            mixed
              ? locale.text('properties.mixedValue')
              : inheritedLabel || locale.text('properties.inherited')
          "
          live
          :disabled="disabled"
          :invalid="!!error"
          @update:model-value="draft = $event"
          @change="commit"
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
      :aria-label="resetAccessibleLabel || undefined"
      @click="emit('change', 'inherit')"
      >{{ resetLabel || locale.text('actions.resetStyle') }}</EditorButton
    >
    <p v-if="unsupported" class="editor-help">
      {{ locale.text('properties.currentValue') }} {{ modelValue }}.
      {{ locale.text('properties.valuePreserved') }}
    </p>
  </div>
</template>
