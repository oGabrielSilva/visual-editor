<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { basicSetup, EditorView } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language: 'html' | 'css';
    label: string;
    description?: string;
    error?: string;
    readonly?: boolean;
    /** Long lines continue on the next one instead of scrolling sideways. */
    wrap?: boolean;
  }>(),
  { readonly: false, description: '', error: '', wrap: true },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const container = ref<HTMLElement>();
const readonlyCompartment = new Compartment();
const accessibilityCompartment = new Compartment();
const wrapCompartment = new Compartment();
const descriptionId = `${useId()}-code-help`;
const errorId = descriptionId + '-error';
// Colors come from the variables of the host theme, so light and dark follow it on their own.
const appearance = EditorView.theme({
  '&': { color: 'var(--ui-text)', backgroundColor: 'var(--ui-bg)' },
  '.cm-content': { caretColor: 'var(--ui-text-highlighted)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ui-text-highlighted)' },
  '.cm-gutters': {
    color: 'var(--ui-text-dimmed)',
    backgroundColor: 'var(--ui-bg-muted)',
    borderRight: '1px solid var(--ui-border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--ui-primary) 8%, transparent)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'color-mix(in srgb, var(--ui-primary) 24%, transparent)' },
  '.cm-tooltip, .cm-panels': {
    color: 'var(--ui-text)',
    backgroundColor: 'var(--ui-bg)',
    border: '1px solid var(--ui-border)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    color: 'var(--ui-text-inverted)',
    backgroundColor: 'var(--ui-primary)',
  },
});
const accessibility = () =>
  EditorView.contentAttributes.of({
    'aria-label': props.label,
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-readonly': String(props.readonly),
    tabindex: '0',
    ...(props.description || props.error
      ? {
          'aria-describedby': [props.description && descriptionId, props.error && errorId]
            .filter(Boolean)
            .join(' '),
        }
      : {}),
    ...(props.error ? { 'aria-invalid': 'true' } : {}),
  });
let view: EditorView | undefined;
let syncing = false;
const replace = (value: string): void => {
  if (!view || view.state.doc.toString() === value) return;
  syncing = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  syncing = false;
};

onMounted(() => {
  if (!container.value) return;
  view = new EditorView({
    parent: container.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        props.language === 'html' ? html() : css(),
        appearance,
        readonlyCompartment.of([
          EditorState.readOnly.of(props.readonly),
          EditorView.editable.of(!props.readonly),
        ]),
        accessibilityCompartment.of(accessibility()),
        wrapCompartment.of(props.wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing) emit('update:modelValue', update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          // What the document made of the text is shown when the person leaves the field, never
          // under the caret while they type.
          blur: () => replace(props.modelValue),
        }),
      ],
    }),
  });
});
watch(
  () => props.modelValue,
  (value) => {
    if (!view?.hasFocus) replace(value);
  },
);
watch(
  () => props.readonly,
  (value) => {
    view?.dispatch({
      effects: [
        readonlyCompartment.reconfigure([
          EditorState.readOnly.of(value),
          EditorView.editable.of(!value),
        ]),
        accessibilityCompartment.reconfigure(accessibility()),
      ],
    });
  },
);
watch(
  () => props.wrap,
  (value) => {
    view?.dispatch({ effects: wrapCompartment.reconfigure(value ? EditorView.lineWrapping : []) });
  },
);
watch([() => props.label, () => props.description, () => props.error], () => {
  view?.dispatch({ effects: accessibilityCompartment.reconfigure(accessibility()) });
});
onBeforeUnmount(() => view?.destroy());
</script>

<template>
  <div class="editor-code-field">
    <p v-if="description" :id="descriptionId" class="editor-help">{{ description }}</p>
    <div ref="container" class="editor-code" />
    <p v-if="error" :id="errorId" class="editor-control-error" role="alert">{{ error }}</p>
  </div>
</template>
