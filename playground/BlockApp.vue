<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef } from 'vue';
import UApp from '@nuxt/ui/components/App.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import { createBlockEditor } from '../src/composition/browser';
import type { DocumentKind } from '../src/core/document';
import type { BlockDocumentData } from '../src/core/block-document';
import BlockVisualEditor from '../src/vue/components/BlockVisualEditor.vue';
import EditorButton from '../src/vue/components/ui/EditorButton.vue';
import { MemoryBlockStore } from './memory-block-store';
import { MemorySavedBlocks } from './memory-saved-blocks';
import messages from './locale.json';
import {
  SAMPLE_IMAGES,
  SAMPLE_URL_PLACEHOLDERS,
  SAMPLE_VARIABLES,
  SampleImageLibrary,
  sampleImageUrl,
} from './sample-host';

/** The block pieces (schema 2) of the playground, opened with `?schema=2`. */
const store = new MemoryBlockStore();
const savedBlocks = new MemorySavedBlocks();
// `?kind=email` opens an e-mail first (the project site links to it).
const kind = ref<DocumentKind>(
  new URLSearchParams(window.location.search).get('kind') === 'email' ? 'email' : 'page',
);
const notice = ref('');
const libraryOpen = ref(false);
const library = new SampleImageLibrary((visible) => {
  libraryOpen.value = visible;
});
const create = (
  nextKind: DocumentKind,
  reopen: boolean,
  given?: BlockDocumentData,
  template?: string,
) => {
  const document = given ?? (reopen ? store.load(nextKind) : undefined);
  const options = {
    kind: nextKind,
    store,
    exactUrlPlaceholders: SAMPLE_URL_PLACEHOLDERS,
    previewImageOrigins: [window.location.origin],
    ...(document ? { document } : {}),
  };
  if (!template || document) return createBlockEditor(options);
  try {
    return createBlockEditor({ ...options, template });
  } catch {
    // An unknown template in the address opens the blank piece instead.
    return createBlockEditor(options);
  }
};
// `?template=<id>` starts the first piece from a template (the project site links to it).
const instance = shallowRef(
  create(
    kind.value,
    false,
    undefined,
    new URLSearchParams(window.location.search).get('template') ?? undefined,
  ),
);
const replace = async (nextKind: DocumentKind, reopen = false): Promise<void> => {
  if (reopen && !store.load(nextKind)) {
    notice.value = messages.missing;
    return;
  }
  const previous = instance.value;
  instance.value = create(nextKind, reopen);
  kind.value = nextKind;
  await nextTick();
  previous.dispose();
  notice.value = reopen ? messages.reopened : '';
};
// Test hook: the end-to-end tests read what the host would store, the way a host would.
Object.defineProperty(window, 'visualEditorBlocks', {
  configurable: true,
  value: {
    snapshot: () => instance.value.session.snapshot(),
    saved: (value: DocumentKind) => store.load(value),
    output: (value: DocumentKind) => store.output(value),
    /** Opens a given piece, e.g. a large one for the performance test. */
    open: async (document: BlockDocumentData): Promise<void> => {
      const previous = instance.value;
      instance.value = create(document.kind, false, document);
      kind.value = document.kind;
      await nextTick();
      previous.dispose();
    },
  },
});
onBeforeUnmount(() => instance.value.dispose());
</script>

<template>
  <UApp>
    <main class="playground">
      <header class="playground-header">
        <h1>{{ messages.blocks }}</h1>
        <p>{{ messages.note }}</p>
      </header>
      <div class="playground-controls" role="group" :aria-label="messages.controls">
        <EditorButton intent="secondary" :active="kind === 'page'" @click="replace('page')">{{
          messages.page
        }}</EditorButton
        ><EditorButton intent="secondary" :active="kind === 'email'" @click="replace('email')">{{
          messages.email
        }}</EditorButton
        ><EditorButton @click="replace(kind, true)">{{ messages.reopen }}</EditorButton>
      </div>
      <p v-if="notice" class="playground-notice" role="status">{{ notice }}</p>
      <BlockVisualEditor
        :key="instance.session.snapshot().id"
        :controller="instance.controller"
        :selection-renderer="instance.selectionRenderer"
        :image-picker="library"
        :variables="SAMPLE_VARIABLES"
        :saved-blocks="savedBlocks"
        diagnostics
      >
        <template #brand
          ><strong class="playground-brand">{{ messages.brand }}</strong></template
        >
      </BlockVisualEditor>
      <UModal
        :open="libraryOpen"
        :title="messages.libraryTitle"
        :description="messages.libraryDescription"
        @update:open="
          (open) => {
            if (!open) library.choose(undefined);
          }
        "
      >
        <template #body>
          <ul class="playground-images">
            <li v-for="image in SAMPLE_IMAGES" :key="image.id">
              <button type="button" class="playground-image" @click="library.choose(image)">
                <img :src="sampleImageUrl(image)" :alt="image.alt" width="800" height="400" />
                {{ image.alt }}
              </button>
            </li>
          </ul>
        </template>
      </UModal>
    </main>
  </UApp>
</template>
