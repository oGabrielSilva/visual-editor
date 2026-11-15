import { afterEach, describe, expect, it } from 'vitest';
import { BlockEditorFactory } from '../../../src/composition/block-factory';
import type { BlockEditorInstance } from '../../../src/composition/block-factory';
import type { Block } from '../../../src/core/block-document';
import { acceptedSavedBlocks } from '../../../src/vue/services/saved-blocks';
import { nodeCompiler } from '../blocks/support';

const instances: BlockEditorInstance[] = [];
afterEach(() => {
  for (const instance of instances.splice(0)) instance.dispose();
});

function editor(kind: 'email' | 'page' = 'email', language?: string): BlockEditorInstance {
  const instance = new BlockEditorFactory(() => nodeCompiler()).create({
    kind,
    ...(language ? { language } : {}),
  });
  instances.push(instance);
  return instance;
}

const count = (blocks: readonly Block[], type: string): number =>
  blocks.reduce(
    (total, block) => total + (block.type === type ? 1 : 0) + count(block.children ?? [], type),
    0,
  );

describe('saved blocks', () => {
  it('inserts a saved block as a copy with new ids, and a saved section as a band', () => {
    const { controller, session } = editor();
    const button: Block = { id: 'x1', type: 'button', props: { text: 'Ir', href: 'https://x.y' } };
    expect(controller.insertSaved(button)).toBe(true);
    expect(controller.insertSaved(button)).toBe(true);
    const blocks = session.document().blocks;
    expect(count(blocks, 'button')).toBe(2);
    expect(session.document().find('x1')).toBeUndefined();
    const section: Block = {
      id: 'x2',
      type: 'section',
      props: {},
      children: [{ id: 'x3', type: 'column', props: {}, children: [button] }],
    };
    expect(controller.insertSaved(section)).toBe(true);
    expect(count(session.document().blocks, 'button')).toBe(3);
    expect(controller.savable(session.document().blocks[0]?.id ?? '')).toMatchObject({
      type: 'section',
    });
  });

  it('refuses what the piece does not accept and changes nothing', () => {
    const { controller, session } = editor();
    const revision = session.document().revision;
    const refused: unknown[] = [
      // A form exists only in a page.
      { id: 'f', type: 'form', props: {} },
      // Values the field does not accept.
      { id: 'b', type: 'button', props: { text: 'Ir', href: 'javascript:alert(1)' } },
      // A key outside the schema.
      { id: 't', type: 'text', props: { text: '<p>x</p>' }, extra: true },
      // A column only exists inside its section.
      { id: 'c', type: 'column', props: {}, children: [] },
      null,
    ];
    for (const block of refused) expect(controller.insertSaved(block as Block)).toBe(false);
    expect(session.document().revision).toBe(revision);
    expect(
      controller.savable(session.document().blocks[0]?.children?.[0]?.id ?? ''),
    ).toBeUndefined();
  });

  it('keeps only well-formed entries of the kind from the host', () => {
    const block = { id: 'x', type: 'text', props: {} };
    expect(
      acceptedSavedBlocks(
        [
          { id: 'ok-1', name: 'Texto', kind: 'email', block },
          { id: 'bad id', name: 'Texto', kind: 'email', block },
          { id: 'ok-2', name: '', kind: 'email', block },
          { id: 'ok-3', name: 'Página', kind: 'page', block },
          { id: 'ok-4', name: 'Sem bloco', kind: 'email' },
          'texto',
        ],
        'email',
      ).map((entry) => entry.id),
    ).toEqual(['ok-1']);
    expect(acceptedSavedBlocks({ length: 1 }, 'email')).toEqual([]);
  });

  it('starts a new piece in the language of the host', () => {
    const { session } = editor('page', 'es');
    expect(session.document().meta.lang).toBe('es');
    expect(JSON.stringify(session.document().blocks)).toContain('Escribe tu contenido.');
  });
});
