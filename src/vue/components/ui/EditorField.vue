<script setup lang="ts">
import UFormField from '@nuxt/ui/components/FormField.vue';

defineProps<{
  label: string;
  id: string;
  help?: string | undefined;
  error?: string | undefined;
  description?: string;
  group?: boolean;
  labelHidden?: boolean;
}>();
</script>

<template>
  <fieldset
    v-if="group"
    class="editor-field editor-field-group"
    :aria-describedby="
      [
        description && `${id}-group-description`,
        help && `${id}-group-help`,
        error && `${id}-group-error`,
      ]
        .filter(Boolean)
        .join(' ') || undefined
    "
  >
    <legend class="editor-field-label">{{ label }}</legend>
    <p v-if="description" :id="`${id}-group-description`" class="editor-help">{{ description }}</p>
    <slot />
    <p v-if="error" :id="`${id}-group-error`" class="editor-control-error" role="alert">
      {{ error }}
    </p>
    <p v-if="help" :id="`${id}-group-help`" class="editor-help">{{ help }}</p>
  </fieldset>
  <UFormField
    v-else
    :name="id"
    :label="label"
    v-bind="{
      ...(help ? { help } : {}),
      ...(error ? { error } : {}),
      ...(description ? { description } : {}),
    }"
    class="editor-field"
    :class="{ 'editor-field-hidden-label': labelHidden }"
    ><slot
  /></UFormField>
</template>
