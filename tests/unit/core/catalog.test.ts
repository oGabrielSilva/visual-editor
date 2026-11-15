import { describe, expect, it } from 'vitest';
import { BlockCatalog } from '../../../src/core/catalog';
import type { DocumentNode } from '../../../src/core/document';

const main: DocumentNode = { id: 'main', type: 'element', tag: 'main', children: [] };
const heading: DocumentNode = {
  id: 'title',
  type: 'element',
  tag: 'h2',
  children: [{ id: 'title-text', type: 'text', value: 'Title' }],
};
const image: DocumentNode = {
  id: 'image',
  type: 'element',
  tag: 'img',
  attrs: { src: 'https://example.com/image.png', alt: 'Image' },
};

describe('immutable canonical block capabilities', () => {
  it('safely shares deeply frozen descriptors across recognition and catalog instances', () => {
    const catalog = new BlockCatalog();
    const other = new BlockCatalog();
    for (const entry of catalog.descriptors()) {
      const canonical = catalog.descriptor(entry.type);
      expect(canonical).toBe(other.descriptor(entry.type));
      expect(Object.isFrozen(canonical)).toBe(true);
      expect(Object.isFrozen(canonical.kinds)).toBe(true);
      expect(Object.isFrozen(canonical.properties)).toBe(true);
      expect(canonical.properties.every((property) => Object.isFrozen(property))).toBe(true);
      expect(Reflect.set(canonical, 'canContainChildren', !canonical.canContainChildren)).toBe(
        false,
      );
      expect(Reflect.set(canonical.kinds, '0', 'foreign')).toBe(false);
      expect(Reflect.set(canonical.properties, 'length', 0)).toBe(false);
      const property = canonical.properties[0];
      if (property) expect(Reflect.set(property, 'name', 'forged-capability')).toBe(false);
      expect(catalog.descriptor(entry.type)).toEqual(entry);
    }
    expect(catalog.recognize(main)).toBe(catalog.descriptor('section'));
    expect(catalog.recognize(heading)).toBe(catalog.descriptor('heading'));
    expect(catalog.acceptsChildren(main, [heading, image])).toBe(true);
    expect(catalog.acceptsProperty(heading, 'font-size', 'style')).toBe(true);
    expect(catalog.acceptsProperty(heading, 'src', 'attribute')).toBe(false);
    expect(catalog.acceptsProperty(image, 'src', 'attribute')).toBe(true);
  });

  it('keeps descriptor listings as independent public copies without exposing canonical mutation', () => {
    const catalog = new BlockCatalog();
    const publicEntries = catalog.descriptors('page');
    const imageEntry = publicEntries.find((entry) => entry.type === 'image');
    if (!imageEntry) throw new Error('MISSING_IMAGE_DESCRIPTOR');
    expect(Reflect.set(imageEntry, 'tag', 'script')).toBe(true);
    expect(Reflect.set(imageEntry.kinds, '0', 'foreign')).toBe(true);
    const property = imageEntry.properties[0];
    if (!property) throw new Error('MISSING_IMAGE_PROPERTY');
    expect(Reflect.set(property, 'name', 'onerror')).toBe(true);
    expect(catalog.descriptor('image').tag).toBe('img');
    expect(catalog.descriptor('image').kinds).toEqual(['email', 'page']);
    expect(catalog.properties(image).some((candidate) => candidate.name === 'onerror')).toBe(false);
    expect(catalog.acceptsProperty(image, 'src', 'attribute')).toBe(true);
    expect(catalog.descriptors('email').every((entry) => entry.kinds.includes('email'))).toBe(true);
  });

  it('returns frozen structural fallback properties with the same supported editing rules', () => {
    const catalog = new BlockCatalog();
    const table: DocumentNode = { id: 'table', type: 'element', tag: 'table', children: [] };
    const properties = catalog.properties(table);
    expect(Object.isFrozen(properties)).toBe(true);
    expect(properties.every((property) => Object.isFrozen(property))).toBe(true);
    const padding = properties.find((property) => property.name === 'padding');
    if (!padding) throw new Error('MISSING_PADDING_PROPERTY');
    expect(Reflect.set(padding, 'name', 'href')).toBe(false);
    expect(catalog.acceptsProperty(table, 'padding', 'style')).toBe(true);
    expect(catalog.acceptsProperty(table, 'href', 'attribute')).toBe(false);
    expect(catalog.acceptsChildren(table, [heading])).toBe(false);
  });
});
