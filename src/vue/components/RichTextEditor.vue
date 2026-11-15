<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { Extension } from '@tiptap/core';
import type { ParseOptions } from '@tiptap/pm/model';
import { emptyRichTextState } from '../../rich-text/commands';
import type { RichTextCommandName, RichTextCommands } from '../../rich-text/commands';
import { RichTextCommandExecutor, RichTextStateReader } from '../../rich-text/command-executor';
import { RichTextSchema } from '../../rich-text/schema';
import { RichTextCommandValues } from '../rich-text-commands';
import type { EditorLocale } from '../locale';
import { UrlPolicy } from '../../security/url-policy';
import { RichTextProjection } from '../../security/rich-text-projection';
import EditorRichTextControls from './EditorRichTextControls.vue';
import { ColorStyleValue } from './ui/color-style-value';
import type { EditorVariable } from '../variables';

const props = withDefaults(
  defineProps<{
    html: string;
    readonly?: boolean;
    allowBlocks?: boolean;
    allowLinks?: boolean;
    locale: EditorLocale;
    minimal?: boolean;
    autofocus?: boolean;
    id?: string;
    linkPolicy?: UrlPolicy | undefined;
    variables?: readonly EditorVariable[];
  }>(),
  {
    readonly: false,
    allowBlocks: false,
    allowLinks: true,
    minimal: false,
    autofocus: false,
    id: '',
    variables: () => [],
    linkPolicy: undefined,
  },
);
const emit = defineEmits<{
  change: [value: string];
  focus: [];
  blur: [];
  finish: [];
  cancel: [];
  error: [code: string];
  history: [direction: 'undo' | 'redo'];
}>();
const urls = computed(() => props.linkPolicy ?? new UrlPolicy());
const projection = computed(() => new RichTextProjection(urls.value));
const projectionError = ref('');
const projectionInvalid = ref(false);
const safeProjection = (value: string, fallback = ''): string => {
  try {
    const result = projection.value.project(value, props.allowBlocks);
    projectionInvalid.value = false;
    projectionError.value = result.adjusted ? props.locale.text('feedback.pasteAdjusted') : '';
    return result.html;
  } catch {
    projectionInvalid.value = true;
    projectionError.value = props.locale.text('feedback.invalid');
    emit('error', 'feedback.invalid');
    return fallback;
  }
};
const root = ref<HTMLElement>();
const controls = ref<InstanceType<typeof EditorRichTextControls>>();
const instanceId = useId();
const editorId = computed(() => props.id || `${instanceId}-richtext`);
const selection = ref({ from: 1, to: 1 });
const revision = ref(0);
const hasBookmark = ref(false);
const richTextAttributes = (): Record<string, string> => ({
  id: editorId.value,
  role: 'textbox',
  'aria-multiline': 'true',
  'aria-label': props.locale.text('properties.text'),
  'aria-readonly': String(props.readonly),
  'aria-describedby': [
    !props.minimal && !props.readonly && editorId.value + '-help',
    projectionError.value && editorId.value + '-error',
  ]
    .filter(Boolean)
    .join(' '),
  'aria-invalid': String(projectionInvalid.value),
  class: 'editor-richtext-content',
});

const schema = new RichTextSchema();
const executor = new RichTextCommandExecutor(schema.formatting);
const reader = new RichTextStateReader();
const values = new RichTextCommandValues(() => urls.value);
const colors = new ColorStyleValue();
const keys = Extension.create({
  name: 'documentHistoryKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    const history = (direction: 'undo' | 'redo'): boolean => {
      if (props.readonly) return true;
      if (consumeHistory(direction)) return true;
      emit('finish');
      emit('history', direction);
      return true;
    };
    const toggle = (format: 'bold' | 'italic' | 'underline' | 'strike') => (): boolean => {
      commands.run(format);
      return true;
    };
    return {
      'Mod-b': toggle('bold'),
      'Mod-i': toggle('italic'),
      'Mod-u': toggle('underline'),
      'Mod-Shift-x': toggle('strike'),
      'Mod-z': () => history('undo'),
      'Mod-Shift-z': () => history('redo'),
      'Mod-y': () => history('redo'),
      'Mod-Enter': () => {
        emit('finish');
        return true;
      },
      Escape: () => {
        if (!controls.value?.dismiss()) emit('cancel');
        return true;
      },
      ...(!props.allowBlocks ? { Enter: () => this.editor.commands.setHardBreak() } : {}),
    };
  },
});
const contentParseOptions: ParseOptions = { preserveWhitespace: 'full' };
// HTML is only the validated supported-markup projection, never imported raw source.
const editor = useEditor({
  extensions: [
    ...schema.extensions({
      content: props.allowBlocks ? 'block+' : 'paragraph',
      links: props.allowLinks,
      isAllowedUri: (value) => urls.value.isSafe(value, 'link'),
    }),
    keys,
  ],
  content: safeProjection(props.html),
  parseOptions: contentParseOptions,
  editable: !props.readonly,
  autofocus: false,
  onCreate: ({ editor: instance }) => {
    if (props.autofocus && !props.readonly)
      instance.commands.focus('end', { scrollIntoView: false });
  },
  onFocus: ({ editor: instance }) => {
    hasBookmark.value = true;
    selection.value = { from: instance.state.selection.from, to: instance.state.selection.to };
  },
  onSelectionUpdate: ({ editor: instance }) => {
    if (instance.isFocused) hasBookmark.value = true;
    selection.value = { from: instance.state.selection.from, to: instance.state.selection.to };
  },
  onTransaction: () => {
    revision.value += 1;
  },
  editorProps: {
    attributes: richTextAttributes(),
    handlePaste: (_view, event) => {
      const input =
        event.clipboardData?.getData('text/html') ||
        event.clipboardData?.getData('text/plain') ||
        '';
      try {
        projection.value.project(input, props.allowBlocks);
        return false;
      } catch {
        event.preventDefault();
        projectionInvalid.value = true;
        projectionError.value = props.locale.text('feedback.invalid');
        emit('error', 'feedback.invalid');
        return true;
      }
    },
    transformPastedHTML: (html: string) => safeProjection(html),
    handleClick: (_view, _position, event) => {
      if (event.target instanceof Element && event.target.closest('a')) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  },
  onUpdate: ({ editor: instance }) => emit('change', instance.getHTML()),
});
const state = computed(() => {
  void revision.value;
  void selection.value;
  const instance = editor.value;
  if (!instance || instance.isDestroyed) return emptyRichTextState();
  return reader.read(instance, hasBookmark.value && !props.readonly, (style, value) =>
    style === 'color' || style === 'backgroundColor' ? (colors.normalize(value) ?? value) : value,
  );
});
/** The panel editor answers the shared command surface with its own Tiptap instance. */
const commands: RichTextCommands = {
  get state() {
    return state.value;
  },
  run(command: RichTextCommandName, value?: string | null): boolean {
    if (command === 'finish') {
      emit('finish');
      return true;
    }
    if (command === 'cancel') {
      emit('cancel');
      return true;
    }
    const instance = editor.value;
    if (props.readonly || !hasBookmark.value || !instance || instance.isDestroyed) return false;
    const resolved = values.resolve(command, value);
    return !!resolved && executor.run(instance, command, resolved.value, selection.value);
  },
};
const insertText = (value: string): boolean => commands.run('insertText', value);
const canHistory = (direction: 'undo' | 'redo'): boolean => {
  const instance = editor.value;
  if (props.readonly || !hasBookmark.value || !instance || instance.isDestroyed) return false;
  return direction === 'undo' ? instance.can().undo() : instance.can().redo();
};
const consumeHistory = (direction: 'undo' | 'redo'): boolean => commands.run(direction);
defineExpose({ insertText, history: consumeHistory, canHistory });
const focusIn = (event: FocusEvent): void => {
  if (
    !(event.relatedTarget instanceof globalThis.Node) ||
    !root.value?.contains(event.relatedTarget)
  )
    emit('focus');
};
const focusOut = (event: FocusEvent): void => {
  if (
    !(event.relatedTarget instanceof globalThis.Node) ||
    !root.value?.contains(event.relatedTarget)
  )
    emit('blur');
};
watch(
  () => props.html,
  (html) => {
    if (html === editor.value?.getHTML()) return;
    const safe = safeProjection(html, editor.value?.getHTML() ?? '');
    if (editor.value?.getHTML() !== safe) {
      editor.value?.commands.setContent(safe, {
        emitUpdate: false,
        parseOptions: contentParseOptions,
      });
      hasBookmark.value = false;
    }
  },
);
watch(
  () => props.readonly,
  (value) => editor.value?.setEditable(!value, false),
);
watch(
  [() => props.locale, () => props.readonly, editorId, projectionError, projectionInvalid],
  () => {
    editor.value?.setOptions({ editorProps: { attributes: richTextAttributes() } });
  },
);
</script>

<template>
  <div
    ref="root"
    class="editor-richtext"
    :class="{ 'is-minimal': minimal }"
    @focusin="focusIn"
    @focusout="focusOut"
  >
    <EditorRichTextControls
      :id="editorId"
      ref="controls"
      :commands="commands"
      :locale="locale"
      :readonly="readonly"
      :allow-blocks="allowBlocks"
      :allow-links="allowLinks"
      :minimal="minimal"
      :variables="variables"
    />
    <p v-if="!minimal && !readonly" :id="editorId + '-help'" class="editor-help">
      {{ locale.text('properties.placeCursor') }}
    </p>
    <p v-if="projectionError" :id="editorId + '-error'" class="editor-control-error" role="status">
      {{ projectionError }}
    </p>
    <EditorContent v-if="editor" :editor="editor" />
  </div>
</template>
