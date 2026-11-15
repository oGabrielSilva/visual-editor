<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import UInput from '@nuxt/ui/components/Input.vue';
import { Debouncer } from '../../services/live-change';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    id?: string;
    disabled?: boolean;
    type?: 'text' | 'url' | 'number' | 'search';
    placeholder?: string;
    min?: number | undefined;
    max?: number | undefined;
    step?: number | 'any' | undefined;
    invalid?: boolean;
    label?: string;
    icon?: string;
    /** Emits `change` shortly after each keystroke instead of waiting for Enter or blur. */
    live?: boolean;
  }>(),
  {
    modelValue: '',
    id: '',
    disabled: false,
    type: 'text',
    min: undefined,
    max: undefined,
    step: undefined,
    placeholder: '',
    invalid: false,
    label: '',
    icon: '',
    live: false,
  },
);
const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [value: string];
  blur: [];
  focus: [];
}>();
// What the person typed stays on screen while the document validates it: a refused value is
// shown with its error and never replaced by the previous one under their hands.
const draft = ref(props.modelValue);
const debounce = new Debouncer();
let focused: boolean = false;
// The last value handed over: the pause and the Enter which follows it report it only once.
let emitted: string | undefined;
watch(
  () => props.modelValue,
  (value) => {
    // Only what is still being typed is protected from the echo of the previous pause.
    if (!focused || !debounce.pending) draft.value = value;
  },
);
const commit = (value: string): void => {
  if (value === emitted) return;
  emitted = value;
  emit('change', value);
};
const input = (value: unknown): void => {
  const text = String(value ?? '');
  if (text !== emitted) emitted = undefined;
  draft.value = text;
  emit('update:modelValue', text);
  if (props.live) debounce.schedule(() => commit(text));
};
const change = (event: Event): void => {
  debounce.cancel();
  commit((event.target as HTMLInputElement).value);
};
const focus = (): void => {
  focused = true;
  emit('focus');
};
const blur = (): void => {
  focused = false;
  debounce.flush();
  emit('blur');
};
onBeforeUnmount(() => debounce.flush());
</script>

<template>
  <UInput
    v-bind="{ ...(id ? { id } : {}), ...(icon ? { icon } : {}) }"
    :model-value="draft"
    :type="type"
    :disabled="disabled"
    :placeholder="placeholder"
    :min="min"
    :max="max"
    :step="step"
    :aria-invalid="invalid || undefined"
    :aria-label="label || undefined"
    :color="invalid ? 'error' : 'primary'"
    size="sm"
    class="editor-input"
    @update:model-value="input"
    @change="change"
    @blur="blur"
    @focus="focus"
  />
</template>
