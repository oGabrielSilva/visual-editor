<script setup lang="ts">
import { ref } from 'vue';
import { useWorkbench } from '../workbench';
import EditorContextPopover from './ui/EditorContextPopover.vue';
import EditorKeys from './ui/EditorKeys.vue';

/** How to use the piece without a manual: the gestures and every shortcut of the shell. */
const workbench = useWorkbench();
const t = workbench.t;
const open = ref(false);
</script>

<template>
  <EditorContextPopover
    :open="open"
    :label="t('help.title')"
    icon="i-lucide-keyboard"
    :disabled="false"
    icon-only
    @update:open="open = $event"
  >
    <div class="editor-shortcuts">
      <p class="editor-help">{{ t('help.gestures') }}</p>
      <dl>
        <div v-for="shortcut in workbench.shortcuts.list()" :key="shortcut.command">
          <dt>{{ t(shortcut.labelKey) }}</dt>
          <dd>
            <EditorKeys v-for="keys in shortcut.keys" :key="keys.join('+')" :keys="keys" />
          </dd>
        </div>
      </dl>
      <p class="editor-help">{{ t('help.fields') }}</p>
    </div>
  </EditorContextPopover>
</template>
