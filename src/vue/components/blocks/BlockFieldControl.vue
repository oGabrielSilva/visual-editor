<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BlockPropValue } from '../../../core/block-document';
import type { FieldControl, FieldOption } from '../../../blocks/block-type';
import type { EditorLocale } from '../../locale';
import CodeEditor from '../CodeEditor.vue';
import EditorBadge from '../ui/EditorBadge.vue';
import EditorButton from '../ui/EditorButton.vue';
import EditorColorInput from '../ui/EditorColorInput.vue';
import EditorField from '../ui/EditorField.vue';
import EditorInput from '../ui/EditorInput.vue';
import EditorSelect from '../ui/EditorSelect.vue';
import EditorSwitch from '../ui/EditorSwitch.vue';

/**
 * One control of a generated panel: a property of a block or a global style. The control comes
 * from the definition (`text`, `code`, `color`, `length`, `select`...); the value shown is the
 * one the output uses, marked as inherited while the block (or the piece) does not set its own.
 */
const props = defineProps<{
  id: string;
  control: FieldControl;
  labelKey: string;
  options: readonly FieldOption[];
  own: BlockPropValue | undefined;
  effective: BlockPropValue | undefined;
  locale: EditorLocale;
  disabled: boolean;
  /** The host has an image library. */
  imagePicker?: boolean;
  /** The last value typed here was refused: said next to the control. */
  error?: string | undefined;
  /** A short mark under the control, e.g. that the field has its own value on small screens. */
  marker?: string | undefined;
  /** What an inherited value is called; by default the default of the piece. */
  inheritedKey?: string | undefined;
  /** What the button that drops the value says; by default "restore default". */
  restoreKey?: string | undefined;
}>();
const emit = defineEmits<{
  change: [value: BlockPropValue];
  restore: [];
  'choose-image': [];
}>();
const t = (key: string): string => props.locale.text(key);
const label = computed(() => t(props.labelKey));
const inherited = computed(() => props.own === undefined);
const shown = computed(() => (props.effective === undefined ? '' : String(props.effective)));
const inheritedLabel = computed(
  () => `${t(props.inheritedKey ?? 'blockEditor.inherited')}: ${shown.value}`,
);
const restoreText = computed(() => t(props.restoreKey ?? 'blockEditor.restore'));
/** "Restaurar padrão" names the field it restores, for a reader that lists the buttons. */
const restoreLabel = computed(() => `${restoreText.value}: ${label.value}`);
const items = computed(() =>
  props.options.map((option) => ({ value: option.value, label: t(option.labelKey) })),
);
const text = (value: string): void => {
  if (value === '' && !inherited.value) emit('restore');
  else if (value !== '') emit('change', value);
};

/**
 * Markup on several lines: the code editor keeps what is typed, line breaks included, and hands
 * it over when the person leaves the field, as one step of history.
 */
const code = ref(shown.value);
let codeFocused = false;
const codeEntered = (): void => {
  codeFocused = true;
};
watch(shown, (value) => {
  if (!codeFocused) code.value = value;
});
const codeLeft = (event: FocusEvent): void => {
  const field = event.currentTarget;
  if (field instanceof Element && event.relatedTarget instanceof Node)
    if (field.contains(event.relatedTarget)) return;
  codeFocused = false;
  if (code.value !== shown.value) text(code.value);
};
</script>

<template>
  <EditorField
    :id="id"
    :label="control === 'toggle' ? '' : label"
    :error="control === 'code' ? undefined : error"
  >
    <p v-if="control === 'richtext'" class="editor-help">{{ t('blockEditor.textInPiece') }}</p>
    <EditorColorInput
      v-else-if="control === 'color'"
      :id="id"
      :model-value="inherited ? '' : shown"
      :locale="locale"
      :disabled="disabled"
      :inherited="inherited"
      :inherited-label="inheritedLabel"
      :reset-label="restoreText"
      :reset-accessible-label="restoreLabel"
      @change="$event === 'inherit' ? emit('restore') : emit('change', $event)"
    />
    <EditorSelect
      v-else-if="control === 'select'"
      :id="id"
      :model-value="shown"
      :items="items"
      :label="label"
      :disabled="disabled"
      @change="emit('change', $event)"
    />
    <!-- The switch carries the only visible label of the field. -->
    <EditorSwitch
      v-else-if="control === 'toggle'"
      :model-value="effective === true"
      :label="label"
      :disabled="disabled"
      @update:model-value="emit('change', $event)"
    />
    <div
      v-else-if="control === 'code'"
      class="editor-block-code"
      :data-block-code="id"
      @focusin="codeEntered"
      @focusout="codeLeft"
    >
      <CodeEditor
        v-model="code"
        language="html"
        :label="label"
        :readonly="disabled"
        v-bind="error ? { error } : {}"
      />
    </div>
    <template v-else>
      <EditorButton
        v-if="control === 'image' && imagePicker"
        icon="i-lucide-image"
        :disabled="disabled"
        @click="emit('choose-image')"
        >{{ t('blockEditor.chooseImage') }}</EditorButton
      >
      <EditorInput
        :id="id"
        :type="control === 'link' || control === 'image' ? 'url' : 'text'"
        :model-value="inherited ? '' : shown"
        :placeholder="inherited && shown ? inheritedLabel : ''"
        :disabled="disabled"
        :invalid="!!error"
        @change="text"
      />
    </template>
    <EditorButton
      v-if="!inherited && control !== 'color' && control !== 'richtext'"
      size="xs"
      :disabled="disabled"
      :aria-label="restoreLabel"
      @click="emit('restore')"
      >{{ restoreText }}</EditorButton
    >
    <span v-if="marker" class="editor-device-marker" data-device-marker
      ><EditorBadge tone="primary">{{ marker }}</EditorBadge></span
    >
  </EditorField>
</template>
