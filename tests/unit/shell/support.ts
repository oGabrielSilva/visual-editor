import { EditorFactory } from '../../../src/composition/factory';
import type { EditorInstance, EditorOptions } from '../../../src/composition/factory';

const factory = new EditorFactory(() => ({
  compile: async () => {
    throw new Error('NOT_USED');
  },
}));

export const PAGE =
  '<section data-editor-block="section"><h2 data-editor-block="heading">Título</h2><p>Primeiro</p><p>Segundo</p><img src="https://example.test/a.png" alt="Foto"></section>';

export function editor(html = PAGE, options: EditorOptions = {}): EditorInstance {
  return factory.create({ kind: 'page', source: { html, css: '' }, ...options });
}

/** The id of the selectable region whose element has `tag`, in document order. */
export function regionId(instance: EditorInstance, tag: string, index = 0): string {
  const region = instance.controller
    .canvasRegions()
    .filter((candidate) => candidate.node.tag === tag)[index];
  if (!region) throw new Error(`MISSING_REGION:${tag}`);
  return region.id;
}
