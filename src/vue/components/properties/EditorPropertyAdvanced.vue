<script setup lang="ts">
import { useId } from 'vue';
import { useWorkbench } from '../../workbench';
import type { SelectionProperties } from '../../properties/selection-properties';
import EditorButton from '../ui/EditorButton.vue';
import EditorField from '../ui/EditorField.vue';
import EditorInput from '../ui/EditorInput.vue';

/** What few people need: descriptions for assistive technology and the HTML of the block. */
const props = defineProps<{ model: SelectionProperties }>();
const workbench = useWorkbench();
const t = workbench.t;
const instanceId = useId();
const fieldId = (name: string): string => `${instanceId}-${name}`;
const { selected, capabilities, errors, disabled } = props.model;
const { attribute, hasAttribute, updateAttribute } = props.model;
</script>

<template>
  <div v-if="selected" class="editor-property-advanced">
    <EditorField
      v-if="hasAttribute('title')"
      :id="fieldId('link-title')"
      :label="t('properties.titleAttribute')"
      :error="errors.title"
    >
      <EditorInput
        :id="fieldId('link-title')"
        :model-value="attribute('title')"
        live
        :disabled="disabled"
        :invalid="!!errors.title"
        @change="updateAttribute('title', $event)"
      />
    </EditorField>
    <EditorField
      v-if="hasAttribute('aria-label')"
      :id="fieldId('accessible-name')"
      :label="t('properties.accessibleName')"
      :error="errors['aria-label']"
    >
      <EditorInput
        :id="fieldId('accessible-name')"
        :model-value="attribute('aria-label')"
        live
        :disabled="disabled"
        :invalid="!!errors['aria-label']"
        @change="updateAttribute('aria-label', $event)"
      />
    </EditorField>
    <p v-if="!capabilities || capabilities.kind === 'native'" class="editor-help">
      {{ t('properties.native') }}
    </p>
    <EditorField
      :id="fieldId('html')"
      :label="t('canvas.editHtml')"
      :help="t('properties.htmlHelp')"
    >
      <EditorButton
        :id="fieldId('html')"
        intent="secondary"
        icon="i-lucide-code-xml"
        :disabled="disabled"
        @click="workbench.commands.run('editHtml', selected.id)"
        >{{ t('canvas.editHtml') }}</EditorButton
      >
    </EditorField>
  </div>
</template>
