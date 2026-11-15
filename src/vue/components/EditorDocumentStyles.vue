<script setup lang="ts">
import { computed, useId } from 'vue';
import type {
  DocumentStyleContext,
  DocumentStyleProperty,
} from '../../application/document-presentation';
import { TEXT_STYLE_LIMITS } from '../../security/text-presentation';
import type { EditorLocale } from '../locale';
import { EditorFontOptions } from '../font-options';
import EditorPropertyGroup from './ui/EditorPropertyGroup.vue';
import EditorField from './ui/EditorField.vue';
import EditorSelect from './ui/EditorSelect.vue';
import EditorMeasurement from './ui/EditorMeasurement.vue';
import EditorColorInput from './ui/EditorColorInput.vue';

const props = defineProps<{
  context: DocumentStyleContext | undefined;
  locale: EditorLocale;
  disabled: boolean;
  errors: Readonly<Partial<Record<DocumentStyleProperty, string>>>;
}>();
const emit = defineEmits<{ change: [property: DocumentStyleProperty, value: string] }>();
const instanceId = useId();
const groups = computed(() => [
  { id: 'document', label: props.locale.text('properties.documentBase') },
]);
const fonts = new EditorFontOptions();
const original = (property: DocumentStyleProperty): boolean =>
  props.context?.originalProperties.includes(property) ?? false;
const inherited = (property: DocumentStyleProperty): boolean =>
  !props.context?.values[property] && !original(property);
const preservedHelp = (property: DocumentStyleProperty): string | undefined =>
  original(property)
    ? `${props.locale.text('properties.originalContent')}. ${props.locale.text('properties.valuePreserved')}`
    : undefined;
const fontItems = computed(() => {
  const value = props.context?.values['font-family'];
  const items = fonts.items(props.locale);
  return [
    { value: 'unset', label: props.locale.text('properties.inherited') },
    ...(original('font-family')
      ? [
          {
            value: 'original',
            label: props.locale.text('properties.originalContent'),
            disabled: true,
          },
        ]
      : []),
    ...(value && !items.some((item) => item.value === value)
      ? [{ value, label: `${props.locale.text('properties.currentValue')} ${value}` }]
      : []),
    ...items,
  ];
});
const change = (property: DocumentStyleProperty, value: string): void => {
  if (value !== 'original' && !props.disabled && props.context?.properties.includes(property))
    emit('change', property, ['inherit', 'unset'].includes(value) ? '' : value);
};
</script>

<template>
  <EditorPropertyGroup :groups="groups" :context-id="context?.id ?? 'document'">
    <template #document>
      <p class="editor-help">
        {{
          locale.text(
            context ? 'properties.documentBaseHelp' : 'properties.documentBaseUnavailable',
          )
        }}
      </p>
      <template v-if="context">
        <EditorField
          :id="`${instanceId}-font`"
          :label="locale.text('properties.fontFamily')"
          :error="errors['font-family']"
          :help="preservedHelp('font-family')"
        >
          <EditorSelect
            :id="`${instanceId}-font`"
            :model-value="
              context.values['font-family'] || (original('font-family') ? 'original' : 'unset')
            "
            :items="fontItems"
            :disabled="disabled"
            @change="change('font-family', $event)"
          />
        </EditorField>
        <EditorField
          :id="`${instanceId}-font-size`"
          :label="locale.text('properties.fontSize')"
          :error="errors['font-size']"
          :help="preservedHelp('font-size')"
          group
        >
          <EditorMeasurement
            :id="`${instanceId}-font-size`"
            :label="locale.text('properties.fontSize')"
            :model-value="context.values['font-size'] ?? ''"
            :inherited="inherited('font-size')"
            :inherited-label="
              original('font-size') ? locale.text('properties.originalContent') : ''
            "
            :units="['px']"
            :minimum="1"
            :maximum="TEXT_STYLE_LIMITS.fontSizePx"
            :disabled="disabled"
            :locale="locale"
            @change="change('font-size', $event)"
          />
        </EditorField>
        <EditorField
          :id="`${instanceId}-line-height`"
          :label="locale.text('properties.lineHeight')"
          :error="errors['line-height']"
          :help="preservedHelp('line-height')"
          group
        >
          <EditorMeasurement
            :id="`${instanceId}-line-height`"
            :label="locale.text('properties.lineHeight')"
            :model-value="context.values['line-height'] ?? ''"
            :inherited="inherited('line-height')"
            :inherited-label="
              original('line-height') ? locale.text('properties.originalContent') : ''
            "
            :units="['', 'px']"
            :minimum="1"
            :maximum="TEXT_STYLE_LIMITS.lineHeightPx"
            :maximum-by-unit="{ '': TEXT_STYLE_LIMITS.lineHeightRatio }"
            :disabled="disabled"
            :locale="locale"
            @change="change('line-height', $event)"
          />
        </EditorField>
        <EditorField
          v-for="property in context.properties.filter(
            (value) => value === 'color' || value === 'background-color',
          )"
          :id="`${instanceId}-${property}`"
          :key="property"
          :label="locale.text(property === 'color' ? 'properties.color' : 'properties.background')"
          :error="errors[property]"
          :help="preservedHelp(property)"
          group
        >
          <EditorColorInput
            :id="`${instanceId}-${property}`"
            :model-value="context.values[property] ?? ''"
            :inherited="inherited(property)"
            :inherited-label="original(property) ? locale.text('properties.originalContent') : ''"
            :disabled="disabled"
            :locale="locale"
            @change="change(property, $event)"
          />
        </EditorField>
      </template>
    </template>
  </EditorPropertyGroup>
</template>
