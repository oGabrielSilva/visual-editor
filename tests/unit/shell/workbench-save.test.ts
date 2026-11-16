import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import { createServerEditor } from '../../../src/composition/server';
import { createWorkbench } from '../../../src/vue/workbench';

describe('saving from the shell', () => {
  it('keeps the shell usable while the host persists, and shows the save in progress', async () => {
    let finish: (revision: { revision: number }) => void = () => undefined;
    const editor = createServerEditor({
      kind: 'page',
      source: { html: '<p>Texto</p>', css: '' },
      host: {
        store: {
          save: () => new Promise<{ revision: number }>((resolve) => (finish = resolve)),
        },
      },
    });
    const saved: unknown[] = [];
    const scope = effectScope();
    const workbench = scope.run(() =>
      createWorkbench({
        controller: () => editor.controller,
        renderer: () => editor.selectionRenderer,
        messages: () => undefined,
        variables: () => [],
        imagePicker: () => undefined,
        requestImage: () => undefined,
        saved: (payload) => saved.push(payload),
        failed: () => undefined,
      }),
    )!;
    try {
      const pending = workbench.save();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(workbench.saving.value).toBe(true);
      // Only the save waits: the other controls of the shell do not depend on it.
      expect(workbench.busy.value).toBe(false);
      // A second click while the first save runs does nothing.
      await workbench.save();
      finish({ revision: 1 });
      await pending;
      expect(workbench.saving.value).toBe(false);
      expect(saved).toHaveLength(1);
    } finally {
      workbench.dispose();
      scope.stop();
      editor.dispose();
    }
  });
});
