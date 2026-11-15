import { afterEach, describe, expect, it } from 'vitest';
import { BlockEditorFactory } from '../../../src/composition/block-factory';
import type { BlockEditorInstance } from '../../../src/composition/block-factory';
import { COMPILE_SUPERSEDED, CompileLanes } from '../../../src/compilation/compile-lanes';
import { GeneratedMjml } from '../../../src/compilation/generated-mjml';
import type { BlockDocumentData } from '../../../src/core/block-document';
import { createBlockWorkbench } from '../../../src/vue/block-workbench';
import { nodeCompiler, registry } from '../blocks/support';

/** Concurrency of previews and saves, and the save event of the block shell. */
const instances: BlockEditorInstance[] = [];
afterEach(() => {
  for (const instance of instances.splice(0)) instance.dispose();
});

describe('previews and the save share one compiler without COMPILER_BUSY', () => {
  it('serves three quick revisions and then the save of an e-mail', async () => {
    const saved: BlockDocumentData[] = [];
    const editor = new BlockEditorFactory(() => nodeCompiler()).create({
      kind: 'email',
      store: {
        save: async (document) => {
          saved.push(document);
          return { revision: document.revision };
        },
      },
    });
    instances.push(editor);
    // One preview per revision, as the canvas asks for them, without waiting.
    const previews: Promise<unknown>[] = [];
    for (let index = 0; index < 3; index++) {
      expect(editor.controller.insert('divider')).toBe(true);
      previews.push(editor.controller.preview().catch((error: unknown) => error));
    }
    expect(await editor.session.save()).toBe(true);
    expect(saved).toHaveLength(1);
    const results = await Promise.all(previews);
    for (const result of results)
      if (result instanceof Error) expect(result.message).toBe(COMPILE_SUPERSEDED);
    const last = results.at(-1);
    expect(last).not.toBeInstanceOf(Error);
    expect((last as { revision: number }).revision).toBe(editor.session.document().revision);
  }, 60_000);

  it('keeps one preview in flight and only the newest one waiting', async () => {
    let running = 0;
    let peak = 0;
    const started: string[] = [];
    const compiler = {
      compileGenerated: async (mjml: GeneratedMjml): Promise<string> => {
        if (running >= 2) throw new Error('COMPILER_BUSY');
        running++;
        peak = Math.max(peak, running);
        started.push(mjml.source);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running--;
        return mjml.source;
      },
    };
    const lanes = new CompileLanes(compiler);
    const one = lanes.preview.compileGenerated(new GeneratedMjml('1'));
    const two = lanes.preview.compileGenerated(new GeneratedMjml('2')).catch((e: Error) => e);
    const three = lanes.preview.compileGenerated(new GeneratedMjml('3'));
    const save = lanes.final.compileGenerated(new GeneratedMjml('final'));
    expect(await one).toBe('1');
    expect(((await two) as Error).message).toBe(COMPILE_SUPERSEDED);
    expect(await three).toBe('3');
    expect(await save).toBe('final');
    expect(started).toEqual(['1', 'final', '3']);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('the save event of the block shell', () => {
  it('emits the piece the store received, not one changed while it was saved', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stored: BlockDocumentData[] = [];
    const editor = new BlockEditorFactory(() => nodeCompiler()).create({
      kind: 'page',
      store: {
        save: async (document) => {
          stored.push(document);
          await gate;
          return { revision: document.revision };
        },
      },
    });
    instances.push(editor);
    const emitted: BlockDocumentData[] = [];
    const workbench = createBlockWorkbench({
      controller: () => editor.controller,
      messages: () => undefined,
      imagePicker: () => undefined,
      saved: (document) => emitted.push(document),
      failed: () => undefined,
    });
    expect(editor.controller.insert('divider')).toBe(true);
    const saving = workbench.save();
    await expect.poll(() => stored.length).toBe(1);
    // The text edited in place is confirmed straight into the session, beside the save.
    expect(editor.controller.insert('spacer')).toBe(true);
    release();
    await saving;
    workbench.dispose();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(stored[0]);
    expect(emitted[0]?.revision).toBeLessThan(editor.session.document().revision);
  });
});

describe('the free HTML block', () => {
  it('is edited in the multiline code control, never in a one-line input', () => {
    const field = registry.definition('html').fields.find((entry) => entry.key === 'html');
    expect(field?.control).toBe('code');
  });
});
