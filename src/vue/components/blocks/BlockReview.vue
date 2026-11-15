<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { BlockCheck } from '../../../blocks/block-checks';
import { useBlockWorkbench } from '../../block-workbench';
import EditorButton from '../ui/EditorButton.vue';
import EditorIcon from '../ui/EditorIcon.vue';

/**
 * The review before sending or publishing: each finding with what to do about it and a button
 * that selects the block it is about. Shown in the panel of the piece once the author asks for
 * it; the findings follow the piece while it changes.
 */
const workbench = useBlockWorkbench();
const { review, reviewing } = workbench;
const t = workbench.t;
const root = ref<HTMLElement>();
const errors = computed(
  () => review.value?.filter((check) => check.severity === 'error').length ?? 0,
);
const message = (check: BlockCheck): string =>
  t(`review.${check.code}`).replace('{kb}', String(check.kilobytes ?? ''));
const label = (check: BlockCheck): string | undefined => {
  const id = check.blockId;
  const key = id ? workbench.controller().labelKey(id) : undefined;
  return key ? t(key) : undefined;
};
const show = (id: string): void => {
  void workbench.run((editor) => editor.select(id), '');
};
const focus = async (): Promise<void> => {
  await nextTick();
  root.value?.focus({ preventScroll: false });
};
defineExpose({ focus });
</script>

<template>
  <section
    v-if="review !== undefined || reviewing"
    ref="root"
    class="editor-review"
    data-block-review
    tabindex="-1"
    :aria-label="t('review.title')"
    :aria-busy="reviewing"
  >
    <h3 class="editor-review-title">{{ t('review.title') }}</h3>
    <p class="editor-help" role="status" aria-live="polite">
      {{
        reviewing && review === undefined
          ? t('review.running')
          : !review?.length
            ? t('review.clean')
            : errors
              ? t('review.hasErrors')
              : t('review.hasWarnings')
      }}
    </p>
    <ul v-if="review?.length" class="editor-review-list">
      <li
        v-for="(check, index) in review"
        :key="`${check.code}-${check.blockId ?? 'piece'}-${index}`"
        class="editor-review-item"
        :data-review-code="check.code"
        :data-review-severity="check.severity"
      >
        <EditorIcon
          :name="check.severity === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-triangle-alert'"
        />
        <span class="editor-review-text">
          <strong v-if="label(check)">{{ label(check) }}: </strong>{{ message(check) }}
        </span>
        <EditorButton
          v-if="check.blockId"
          size="xs"
          :aria-label="`${t('review.show')}: ${label(check) ?? ''}`"
          @click="show(check.blockId)"
          >{{ t('review.show') }}</EditorButton
        >
      </li>
    </ul>
  </section>
</template>
