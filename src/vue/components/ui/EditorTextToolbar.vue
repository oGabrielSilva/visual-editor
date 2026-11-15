<script setup lang="ts">
import { computed, ref } from 'vue';
import UTooltip from '@nuxt/ui/components/Tooltip.vue';
import type { RichTextCommandName, RichTextToggleName } from '../../../rich-text/commands';
import type { EditorLocale } from '../../locale';
import EditorButton from './EditorButton.vue';

interface TextToolbarItem {
  readonly command: RichTextCommandName;
  readonly icon: string;
  readonly label: string;
  readonly active: boolean;
}

const props = defineProps<{
  locale: EditorLocale;
  readonly: boolean;
  allowBlocks: boolean;
  minimal: boolean;
  active: readonly RichTextToggleName[];
}>();
const emit = defineEmits<{ command: [command: RichTextCommandName] }>();
const root = ref<HTMLElement>();
const groups = computed<TextToolbarItem[][]>(() => {
  const toggle = (command: RichTextToggleName, key: string, icon: string): TextToolbarItem => ({
    command,
    icon,
    label: props.locale.text(key),
    active: !props.readonly && props.active.includes(command),
  });
  const result: TextToolbarItem[][] = [
    [
      toggle('bold', 'actions.bold', 'i-lucide-bold'),
      toggle('italic', 'actions.italic', 'i-lucide-italic'),
      toggle('underline', 'actions.underline', 'i-lucide-underline'),
      toggle('strike', 'actions.strike', 'i-lucide-strikethrough'),
    ],
  ];
  if (props.allowBlocks)
    result.push([
      toggle('bulletList', 'actions.list', 'i-lucide-list'),
      toggle('orderedList', 'actions.numberedList', 'i-lucide-list-ordered'),
    ]);
  result.push([
    {
      command: 'clearFormatting',
      icon: 'i-lucide-remove-formatting',
      label: props.locale.text('actions.clearFormatting'),
      active: false,
    },
  ]);
  if (props.minimal)
    result.push([
      {
        command: 'finish',
        icon: 'i-lucide-check',
        label: props.locale.text('actions.finish'),
        active: false,
      },
    ]);
  return result;
});
const navigate = (event: KeyboardEvent): void => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = [
    ...(root.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
  ];
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0 || !buttons.length) return;
  event.preventDefault();
  const target =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[target]?.focus({ preventScroll: true });
};
</script>

<template>
  <div
    ref="root"
    class="editor-text-toolbar"
    role="toolbar"
    :aria-label="locale.text('properties.textFormat')"
    @keydown="navigate"
    @mousedown.prevent
  >
    <div v-for="(group, index) in groups" :key="index" class="editor-text-toolbar-group">
      <UTooltip
        v-for="item in group"
        :key="item.command"
        :text="item.label"
        :portal="false"
        :disabled="readonly"
      >
        <EditorButton
          :icon="item.icon"
          v-bind="
            item.command === 'finish' || item.command === 'clearFormatting'
              ? {}
              : { active: item.active }
          "
          :disabled="readonly"
          :aria-label="item.label"
          @click="emit('command', item.command)"
        />
      </UTooltip>
    </div>
    <EditorButton
      v-if="minimal"
      icon="i-lucide-x"
      :disabled="readonly"
      :aria-label="locale.text('canvas.cancel')"
      :title="locale.text('canvas.cancel')"
      @click="emit('command', 'cancel')"
    />
  </div>
</template>
