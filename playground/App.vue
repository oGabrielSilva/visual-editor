<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import UApp from '@nuxt/ui/components/App.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import { createEditor } from '../src/composition/browser';
import type { DocumentKind } from '../src/core/document';
import VisualEditor from '../src/vue/components/VisualEditor.vue';
import EditorButton from '../src/vue/components/ui/EditorButton.vue';
import { MemoryDocumentStore } from './memory-store';
import messages from './locale.json';
import { TEXT_PIECE_HTML } from './text-piece';
import {
  SAMPLE_IMAGES,
  SAMPLE_URL_PLACEHOLDERS,
  SAMPLE_VARIABLES,
  SampleImageLibrary,
  sampleImageUrl,
} from './sample-host';

const parameters = new URLSearchParams(window.location.search);
// `?images=url` shows the editor as a host without an image library: its own dialog asks a URL.
const hostImages = parameters.get('images') !== 'url';
const store = new MemoryDocumentStore();
const kind = ref<DocumentKind>('page');
const readOnly = ref(false);
const dark = ref(false);
const notice = ref('');
const libraryOpen = ref(false);
const library = new SampleImageLibrary((visible) => {
  libraryOpen.value = visible;
});
const options = { exactUrlPlaceholders: SAMPLE_URL_PLACEHOLDERS, host: { store } } as const;
const previewImageOrigins = [window.location.origin];
const instance = shallowRef(createEditor({ kind: kind.value, ...options, previewImageOrigins }));
// The color scheme of a Nuxt UI host is a class on the root element.
watch(dark, (value) => document.documentElement.classList.toggle('dark', value));

const replace = async (nextKind: DocumentKind, reopen = false): Promise<void> => {
  const previous = instance.value;
  const document = reopen
    ? store.load(nextKind)
    : nextKind === kind.value
      ? previous.session.snapshot()
      : store.load(nextKind);
  if (reopen && !document) {
    notice.value = messages.missing;
    return;
  }
  instance.value = createEditor({
    kind: nextKind,
    ...options,
    previewImageOrigins,
    ...(document ? { document } : {}),
    readOnly: readOnly.value,
  });
  kind.value = nextKind;
  await nextTick();
  previous.dispose();
  if (reopen) notice.value = messages.reopened;
};
const toggleReadOnly = async (): Promise<void> => {
  readOnly.value = !readOnly.value;
  await replace(kind.value);
};
const loadTextPiece = (): void => {
  notice.value = instance.value.session.importSource({ html: TEXT_PIECE_HTML, css: '' })
    ? messages.textPieceLoaded
    : messages.initialError;
};
const initialize = async (): Promise<void> => {
  try {
    await instance.value.controller.applyTemplate('page-material');
  } catch {
    notice.value = messages.initialError;
  }
};
// Test hook: the end-to-end tests reach the session the way a host would, without remounting.
Object.defineProperty(window, 'visualEditorPlayground', {
  configurable: true,
  value: { setReadOnly: (value: boolean) => instance.value.session.setReadOnly(value) },
});
void initialize();
onBeforeUnmount(() => {
  document.documentElement.classList.remove('dark');
  instance.value.dispose();
});
</script>

<template>
  <UApp>
    <main class="playground">
      <header class="playground-header">
        <h1>{{ messages.title }}</h1>
        <p>{{ messages.note }}</p>
      </header>
      <div class="playground-controls" role="group" :aria-label="messages.controls">
        <EditorButton intent="secondary" :active="kind === 'page'" @click="replace('page')">{{
          messages.page
        }}</EditorButton
        ><EditorButton intent="secondary" :active="kind === 'email'" @click="replace('email')">{{
          messages.email
        }}</EditorButton
        ><EditorButton :icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'" @click="dark = !dark">{{
          dark ? messages.light : messages.dark
        }}</EditorButton
        ><EditorButton :active="readOnly" @click="toggleReadOnly">{{
          messages.readonly
        }}</EditorButton
        ><EditorButton @click="replace(kind, true)">{{ messages.reopen }}</EditorButton
        ><EditorButton :disabled="readOnly" @click="loadTextPiece">{{
          messages.textPiece
        }}</EditorButton>
      </div>
      <p v-if="notice" class="playground-notice" role="status">{{ notice }}</p>
      <VisualEditor
        :key="instance.session.snapshot().id + String(readOnly)"
        :controller="instance.controller"
        :variables="SAMPLE_VARIABLES"
        :selection-renderer="instance.selectionRenderer"
        v-bind="hostImages ? { imagePicker: library } : {}"
        diagnostics
      >
        <template #brand
          ><strong class="playground-brand">{{ messages.brand }}</strong></template
        >
      </VisualEditor>
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
