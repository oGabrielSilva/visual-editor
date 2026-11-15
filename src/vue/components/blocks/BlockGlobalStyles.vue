<script setup lang="ts">
import { computed, useId } from 'vue';
import type { BlockPropValue } from '../../../core/block-document';
import { useBlockWorkbench } from '../../block-workbench';
import BlockFieldControl from './BlockFieldControl.vue';
import EditorField from '../ui/EditorField.vue';
import EditorInput from '../ui/EditorInput.vue';
import EditorPropertyGroup from '../ui/EditorPropertyGroup.vue';

/**
 * The global styles of the piece, generated from the catalog of its kind. In an e-mail they
 * become the `<mj-attributes>` of the MJML; in a page, the variables of `:root`. A block keeps
 * its own value where it sets one.
 */
const workbench = useBlockWorkbench();
const { state, locale } = workbench;
const t = workbench.t;
const baseId = useId();
const groups = computed(() => {
  void state.value.document.revision;
  return workbench.controller().globalStyles();
});
const sections = computed(() =>
  groups.value.map((group) => ({
    id: group.group,
    label: t(group.labelKey),
    openByDefault: group.group === 'body',
  })),
);
const disabled = computed(() => state.value.readOnly || workbench.busy.value);
const change = (group: string, key: string, value: BlockPropValue): void => {
  void workbench.run((editor) => editor.setStyle(group, key, String(value)));
};
const restore = (group: string, key: string): void => {
  void workbench.run((editor) => editor.restoreStyle(group, key));
};
const language = (value: string): void => {
  void workbench.run((editor) => editor.setLanguage(value.trim()));
};
</script>

<template>
  <section class="editor-property-style" :aria-label="t('blockEditor.globalStyles')">
    <p class="editor-help">{{ t('blockEditor.globalStylesHint') }}</p>
    <EditorField :id="`${baseId}-lang`" :label="t('blockEditor.language')">
      <EditorInput
        :id="`${baseId}-lang`"
        :model-value="state.document.meta.lang"
        :disabled="disabled"
        @change="language"
      />
    </EditorField>
    <EditorPropertyGroup :groups="sections" context-id="block-global-styles">
      <template v-for="group in groups" :key="group.group" #[group.group]>
        <div class="editor-property-content" :data-block-style-group="group.group">
          <BlockFieldControl
            v-for="entry in group.keys"
            :id="`${baseId}-${group.group}-${entry.key}`"
            :key="`${group.group}-${entry.key}`"
            :control="entry.control"
            :label-key="entry.labelKey"
            :options="entry.options"
            :own="entry.overridden ? entry.value : undefined"
            :effective="entry.value"
            :locale="locale"
            :disabled="disabled"
            :data-block-style="`${group.group}.${entry.key}`"
            @change="change(group.group, entry.key, $event)"
            @restore="restore(group.group, entry.key)"
          />
        </div>
      </template>
    </EditorPropertyGroup>
  </section>
</template>
