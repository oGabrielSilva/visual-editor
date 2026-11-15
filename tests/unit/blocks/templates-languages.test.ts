import { describe, expect, it } from 'vitest';
import { BlockTemplateCatalog } from '../../../src/templates/blocks/catalog';
import type { Block } from '../../../src/core/block-document';
import { registry, sequence } from './support';

const texts = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block) => [
    ...(typeof block.props.text === 'string' ? [block.props.text] : []),
    ...texts(block.children ?? []),
  ]);

describe('templates in three languages', () => {
  const catalog = new BlockTemplateCatalog(registry);

  it('writes every template in pt-BR, English and Spanish, with the language declared', () => {
    for (const kind of ['email', 'page'] as const)
      for (const template of catalog.list(kind)) {
        const portuguese = catalog.create(template.id, 'doc', sequence(), kind);
        const english = catalog.create(template.id, 'doc', sequence(), kind, 'en');
        const spanish = catalog.create(template.id, 'doc', sequence(), kind, 'es-419');
        expect(portuguese.meta.lang).toBe('pt-BR');
        expect(english.meta.lang).toBe('en');
        expect(spanish.meta.lang).toBe('es-419');
        const [pt, en, es] = [portuguese, english, spanish].map((piece) => texts(piece.blocks));
        expect(en).toHaveLength(pt?.length ?? 0);
        // Every text is translated: none of the English or Spanish texts is the pt-BR one,
        // except the name of the fictitious contact, which is the same in every language.
        en?.forEach((text, index) => {
          if (!text.includes('Nico Robin') && !/MATERIAL GRATUITO/.test(text))
            expect(text).not.toBe(pt?.[index]);
        });
        es?.forEach((text, index) => {
          if (!text.includes('Nico Robin') && !/MATERIAL GRATUITO/.test(text))
            expect(text).not.toBe(pt?.[index]);
        });
      }
  });

  it('keeps pt-BR for a language it has no texts in', () => {
    const french = catalog.blank('page', 'doc', sequence(), 'fr');
    expect(french.meta.lang).toBe('pt-BR');
    expect(texts(french.blocks)).toEqual(['<p>Escreva seu conteúdo.</p>']);
    expect(texts(catalog.blank('email', 'doc', sequence(), 'en-GB').blocks)).toEqual([
      '<p>Write your content.</p>',
    ]);
  });
});
