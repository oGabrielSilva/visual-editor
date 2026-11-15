<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  RichTextCommandName,
  RichTextCommands,
  RichTextStyleName,
} from '../../rich-text/commands';
import { TEXT_STYLE_LIMITS } from '../../security/text-presentation';
import { EditorFontOptions } from '../font-options';
import type { EditorLocale } from '../locale';
import EditorButton from './ui/EditorButton.vue';
import EditorColorInput from './ui/EditorColorInput.vue';
import EditorContextPopover from './ui/EditorContextPopover.vue';
import EditorField from './ui/EditorField.vue';
import EditorInput from './ui/EditorInput.vue';
import EditorMeasurement from './ui/EditorMeasurement.vue';
import EditorSelect from './ui/EditorSelect.vue';
import EditorTextToolbar from './ui/EditorTextToolbar.vue';
import EditorVariablePicker from './ui/EditorVariablePicker.vue';
import type { EditorVariable } from '../variables';

const props = withDefaults(
  defineProps<{
    /** The local panel editor or the editor inside the preview frame. */
    commands: RichTextCommands;
    id: string;
    locale: EditorLocale;
    readonly?: boolean;
    allowBlocks?: boolean;
    allowLinks?: boolean;
    minimal?: boolean;
    variables?: readonly EditorVariable[];
  }>(),
  {
    readonly: false,
    allowBlocks: false,
    allowLinks: true,
    minimal: false,
    variables: () => [],
  },
);
const linkOpen = ref(false);
const colorOpen = ref(false);
const linkValue = ref('');
const linkError = ref('');
const state = computed(() => props.commands.state);
const idle = computed(() => props.readonly || !state.value.ready);
const run = (command: RichTextCommandName, value?: string | null): boolean =>
  !idle.value && props.commands.run(command, value);
const fontItems = computed(() => [
  { value: 'inherit', label: props.locale.text('actions.resetTextStyle') },
  ...(state.value.styles.fontFamily.mixed
    ? [{ value: 'mixed', label: props.locale.text('properties.mixedValue') }]
    : []),
  ...new EditorFontOptions().items(props.locale),
]);
const fontValue = computed(() => {
  const font = state.value.styles.fontFamily;
  if (font.mixed) return 'mixed';
  return fontItems.value.some((item) => item.value === font.value) ? font.value : 'inherit';
});
const applyStyle = (style: RichTextStyleName, input: string): void => {
  if (input !== 'mixed') run(style, input);
};
const variableToken = (key: string, purpose: 'text' | 'url'): string | undefined => {
  if (
    !/^[a-zA-Z0-9._]{1,200}$/.test(key) ||
    !props.variables.some((variable) => variable.key === key && variable.purpose === purpose)
  )
    return undefined;
  return `{{${key}}}`;
};
const insertVariable = (key: string): void => {
  const token = variableToken(key, 'text');
  if (token) run('insertText', token);
};
const insertLinkVariable = (key: string): void => {
  const token = variableToken(key, 'url');
  if (!idle.value && token) linkValue.value = token;
};
const setLinkOpen = (open: boolean): void => {
  if (idle.value && open) return;
  if (open) {
    linkValue.value = state.value.href;
    linkError.value = '';
  }
  linkOpen.value = open;
};
const applyLink = (): void => {
  if (idle.value) return;
  if (!run('setLink', linkValue.value.trim())) {
    linkError.value = props.locale.text('properties.invalidLink');
    return;
  }
  linkOpen.value = false;
  linkError.value = '';
};
const applyLinkOnEnter = (event: KeyboardEvent): void => {
  if (event.isComposing) return;
  event.preventDefault();
  applyLink();
};
const removeLink = (): void => {
  run('unsetLink');
  linkOpen.value = false;
};
/** Escape closes the innermost layer first; returns whether one was open. */
const dismiss = (): boolean => {
  if (!linkOpen.value && !colorOpen.value) return false;
  linkOpen.value = false;
  colorOpen.value = false;
  return true;
};
defineExpose({ dismiss });
</script>

<template>
  <div class="editor-richtext-toolbar">
    <EditorTextToolbar
      :locale="locale"
      :readonly="idle"
      :allow-blocks="allowBlocks"
      :minimal="minimal"
      :active="state.marks"
      @command="commands.run($event)"
    />
    <EditorContextPopover
      :open="colorOpen"
      :label="locale.text('properties.textFormat')"
      icon="i-lucide-type"
      :disabled="idle"
      @update:open="colorOpen = $event"
    >
      <div class="editor-richtext-colors">
        <EditorField :id="`${id}-color`" :label="locale.text('properties.color')" group>
          <EditorColorInput
            :id="`${id}-color`"
            :model-value="state.styles.color.value"
            :mixed="state.styles.color.mixed"
            :inherited="!state.styles.color.own && !state.styles.color.mixed"
            :reset-label="locale.text('actions.resetTextColor')"
            :inherited-label="locale.text('properties.originalContent')"
            :disabled="readonly"
            :locale="locale"
            @change="applyStyle('color', $event)"
          />
        </EditorField>
        <EditorField :id="`${id}-highlight`" :label="locale.text('properties.background')" group>
          <EditorColorInput
            :id="`${id}-highlight`"
            :model-value="state.styles.backgroundColor.value"
            :mixed="state.styles.backgroundColor.mixed"
            :inherited="!state.styles.backgroundColor.own && !state.styles.backgroundColor.mixed"
            :reset-label="locale.text('actions.resetTextStyle')"
            :inherited-label="locale.text('properties.originalContent')"
            :disabled="readonly"
            :locale="locale"
            @change="applyStyle('backgroundColor', $event)"
          />
        </EditorField>
        <EditorField :id="`${id}-font`" :label="locale.text('properties.fontFamily')">
          <EditorSelect
            :id="`${id}-font`"
            :model-value="fontValue"
            :items="fontItems"
            :disabled="readonly"
            @change="applyStyle('fontFamily', $event)"
          />
        </EditorField>
        <EditorField :id="`${id}-font-size`" :label="locale.text('properties.fontSize')" group>
          <EditorMeasurement
            :id="`${id}-font-size`"
            :model-value="state.styles.fontSize.value"
            :label="locale.text('properties.fontSize')"
            :units="['px']"
            :minimum="1"
            :maximum="TEXT_STYLE_LIMITS.fontSizePx"
            :mixed="state.styles.fontSize.mixed"
            :inherited="!state.styles.fontSize.own && !state.styles.fontSize.mixed"
            :reset-label="locale.text('actions.resetTextStyle')"
            :inherited-label="locale.text('properties.originalContent')"
            :disabled="readonly"
            :locale="locale"
            @change="applyStyle('fontSize', $event)"
          />
        </EditorField>
        <EditorField :id="`${id}-line-height`" :label="locale.text('properties.lineHeight')" group>
          <EditorMeasurement
            :id="`${id}-line-height`"
            :model-value="state.styles.lineHeight.value"
            :label="locale.text('properties.lineHeight')"
            :units="['', 'px']"
            :minimum="1"
            :maximum="TEXT_STYLE_LIMITS.lineHeightPx"
            :maximum-by-unit="{ '': TEXT_STYLE_LIMITS.lineHeightRatio }"
            :mixed="state.styles.lineHeight.mixed"
            :inherited="!state.styles.lineHeight.own && !state.styles.lineHeight.mixed"
            :reset-label="locale.text('actions.resetTextStyle')"
            :inherited-label="locale.text('properties.originalContent')"
            :disabled="readonly"
            :locale="locale"
            @change="applyStyle('lineHeight', $event)"
          />
        </EditorField>
      </div>
    </EditorContextPopover>
    <EditorContextPopover
      v-if="allowLinks"
      :open="linkOpen"
      :label="locale.text('actions.link')"
      icon="i-lucide-link"
      :disabled="idle"
      @update:open="setLinkOpen"
    >
      <div class="editor-richtext-link">
        <EditorField :id="`${id}-link`" :label="locale.text('properties.link')" :error="linkError">
          <EditorInput
            :id="`${id}-link`"
            :model-value="linkValue"
            type="url"
            :disabled="readonly"
            :invalid="!!linkError"
            @update:model-value="linkValue = $event"
            @keydown.enter="applyLinkOnEnter"
          />
        </EditorField>
        <EditorVariablePicker
          :variables="variables"
          purpose="url"
          :locale="locale"
          :disabled="readonly"
          @insert="insertLinkVariable"
        />
        <EditorButton :disabled="readonly" @mousedown.prevent @click="applyLink">{{
          locale.text('actions.apply')
        }}</EditorButton>
        <EditorButton
          v-if="state.link"
          :disabled="readonly"
          @mousedown.prevent
          @click="removeLink"
          >{{ locale.text('actions.removeLink') }}</EditorButton
        >
      </div>
    </EditorContextPopover>
    <EditorVariablePicker
      :variables="variables"
      purpose="text"
      :locale="locale"
      :disabled="idle"
      :hint="readonly && state.ready ? '' : locale.text('variables.idleHint')"
      @insert="insertVariable"
    />
  </div>
</template>
