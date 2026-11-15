import { computed, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import { createEditor } from '../../../src/composition/browser';
import { documentProjectionKey, selectionProjectionKey } from '../../../src/vue/projection-key';

describe('committed view invalidation', () => {
  it('keeps canonical projections stable while pending text changes and refreshes after commit, selection, permission and mode changes', () => {
    const editor = createEditor({ source: { html: '<main><p>One</p><p>Two</p></main>', css: '' } });
    const ids = editor.controller
      .canvasRegions()
      .filter((region) => region.kind === 'text')
      .map((region) => region.id);
    expect(ids).toHaveLength(2);
    const state = shallowRef(editor.controller.state());
    const stop = editor.controller.subscribe((value) => {
      state.value = value;
    });
    const documentKey = computed(() => documentProjectionKey(state.value));
    const selectionKey = computed(() => selectionProjectionKey(state.value));
    let documentReads = 0;
    let selectionReads = 0;
    const outline = computed(() => {
      void documentKey.value;
      documentReads++;
      return editor.controller.entries();
    });
    const selected = computed(() => {
      void selectionKey.value;
      selectionReads++;
      return editor.controller.selected();
    });
    const read = (): void => {
      void outline.value;
      void selected.value;
    };
    read();
    expect(editor.controller.beginRichText(ids[0]!)).toBe(true);
    read();
    expect([documentReads, selectionReads]).toEqual([1, 2]);
    expect(editor.controller.updateRichTextDraft('Changed ')).toBe(true);
    read();
    expect(editor.controller.richTextFor(ids[0]!)).toBe('Changed ');
    expect([documentReads, selectionReads]).toEqual([1, 2]);
    expect(editor.controller.commitRichText()).toBe(true);
    read();
    expect([documentReads, selectionReads]).toEqual([2, 3]);
    editor.controller.select(ids[1]!);
    read();
    expect([documentReads, selectionReads]).toEqual([2, 4]);
    editor.session.setReadOnly(true);
    read();
    expect([documentReads, selectionReads]).toEqual([2, 5]);
    editor.controller.setMode('html');
    read();
    expect([documentReads, selectionReads]).toEqual([2, 6]);
    stop();
    editor.session.dispose();
  });
});
