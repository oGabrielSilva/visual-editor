import { describe, expect, it } from 'vitest';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode } from '../../../src/core/document';

const factory = new EditorFactory(() => ({
  compile: async () => {
    throw new Error('NOT_USED');
  },
}));

function all(nodes: readonly DocumentNode[]): readonly DocumentNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}
function find(nodes: readonly DocumentNode[], tag: string): DocumentNode {
  const node = all(nodes).find((candidate) => candidate.tag === tag);
  if (!node) throw new Error('MISSING_FIXTURE_NODE');
  return node;
}
function text(node: DocumentNode): string {
  return node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(text).join('');
}
const imageSource =
  '<div><p>Before</p><img src="https://example.com/image.png" alt="Image" data-host-asset-id="asset-1"><p>After</p></div>';
const sharedSource =
  '<div><a class="campaign-link" style="color:teal" href="https://example.com/old" target="_blank" rel="nofollow">Before <span class="image-frame"><img src="https://example.com/image.png" alt="Image"></span><strong>After</strong></a><p>Untouched</p></div>';

describe('contextual image links', () => {
  it('creates a safe link around the exact image, retains siblings and supports undo/redo', () => {
    const editor = factory.create({ source: { html: imageSource, css: '' } });
    try {
      const before = editor.session.snapshot();
      const image = find(before.nodes, 'img');
      const siblings = all(before.nodes).filter((node) => node.tag === 'p');
      editor.controller.select(image.id);
      expect(editor.controller.imageLink()).toMatchObject({
        imageId: image.id,
        href: '',
        target: '_self',
        shared: false,
        editable: true,
      });
      expect(
        editor.controller.updateImageLink('https://example.com/new', { target: '_blank' }),
      ).toBe(true);
      const after = editor.session.snapshot();
      const anchor = find(after.nodes, 'a');
      expect(anchor.attrs).toMatchObject({
        href: 'https://example.com/new',
        target: '_blank',
        rel: 'noopener noreferrer',
      });
      expect(anchor.children).toEqual([image]);
      expect(all(after.nodes).filter((node) => node.tag === 'p')).toEqual(siblings);
      expect(editor.controller.undo()).toBe(true);
      expect(editor.controller.imageLink()?.anchorId).toBeUndefined();
      expect(editor.controller.redo()).toBe(true);
      expect(editor.controller.imageLink()?.href).toBe('https://example.com/new');
      expect(find(editor.session.snapshot().nodes, 'img').attrs?.['data-host-asset-id']).toBe(
        'asset-1',
      );
    } finally {
      editor.dispose();
    }
  });

  it('edits and removes an exclusive ancestor link without changing its image or wrapper', () => {
    const editor = factory.create({
      source: {
        html: '<div><a id="hero" class="brand" href="https://example.com/old" target="_blank" rel="nofollow"><span class="frame"><img src="https://example.com/image.png" alt="Image"></span></a><p>Tail</p></div>',
        css: '',
      },
    });
    try {
      const before = editor.session.snapshot();
      const image = find(before.nodes, 'img');
      const anchor = find(before.nodes, 'a');
      const wrapper = find(before.nodes, 'span');
      editor.controller.select(image.id);
      expect(editor.controller.updateImageLink('https://example.com/next')).toBe(true);
      expect(editor.controller.imageLink()).toMatchObject({
        imageId: image.id,
        anchorId: anchor.id,
        href: 'https://example.com/next',
        target: '_blank',
        shared: false,
        editable: true,
      });
      expect(find(editor.session.snapshot().nodes, 'a').attrs).toMatchObject({
        id: 'hero',
        class: 'brand',
        rel: 'nofollow noopener noreferrer',
      });
      expect(editor.controller.updateImageLink('')).toBe(true);
      const after = editor.session.snapshot();
      expect(all(after.nodes).some((node) => node.tag === 'a')).toBe(false);
      expect(find(after.nodes, 'span')).toEqual(wrapper);
      expect(find(after.nodes, 'img')).toEqual(image);
      expect(text(find(after.nodes, 'p'))).toBe('Tail');
    } finally {
      editor.dispose();
    }
  });

  it('splits a shared anchor and changes only the image destination and target', () => {
    const editor = factory.create({ source: { html: sharedSource, css: '' } });
    try {
      const before = editor.session.snapshot();
      const image = find(before.nodes, 'img');
      const wrapper = find(before.nodes, 'span');
      const strong = find(before.nodes, 'strong');
      editor.controller.select(image.id);
      expect(editor.controller.imageLink()).toMatchObject({ shared: true, editable: true });
      expect(
        editor.controller.updateImageLink('https://example.com/image', { target: '_self' }),
      ).toBe(true);
      const after = editor.session.snapshot();
      const anchors = all(after.nodes).filter((node) => node.tag === 'a');
      expect(anchors).toHaveLength(3);
      const imageLink = anchors.find((node) =>
        all(node.children ?? []).some((child) => child.id === image.id),
      );
      expect(imageLink?.attrs).toMatchObject({
        href: 'https://example.com/image',
        target: '_self',
        class: 'campaign-link',
        style: 'color:teal',
      });
      expect(
        anchors.filter((node) => node.id !== imageLink?.id).map((node) => node.attrs?.href),
      ).toEqual(['https://example.com/old', 'https://example.com/old']);
      expect(
        anchors
          .filter((node) => node.id !== imageLink?.id)
          .every((node) => node.attrs?.target === '_blank'),
      ).toBe(true);
      expect(find(after.nodes, 'span')).toEqual(wrapper);
      expect(find(after.nodes, 'strong')).toEqual(strong);
      expect(find(after.nodes, 'img')).toEqual(image);
      expect(new Set(all(after.nodes).map((node) => node.id)).size).toBe(all(after.nodes).length);
      expect(editor.controller.imageLink()).toMatchObject({
        shared: false,
        editable: true,
        href: 'https://example.com/image',
      });
    } finally {
      editor.dispose();
    }
  });

  it('removes the image link from shared content while retaining the links of text siblings', () => {
    const editor = factory.create({ source: { html: sharedSource, css: '' } });
    try {
      const image = find(editor.session.snapshot().nodes, 'img');
      editor.controller.select(image.id);
      expect(editor.controller.updateImageLink('')).toBe(true);
      const after = editor.session.snapshot();
      const anchors = all(after.nodes).filter((node) => node.tag === 'a');
      expect(anchors.map(text)).toEqual(['Before ', 'After']);
      expect(anchors.every((node) => node.attrs?.href === 'https://example.com/old')).toBe(true);
      expect(
        anchors.some((node) => all(node.children ?? []).some((child) => child.id === image.id)),
      ).toBe(false);
      expect(editor.controller.imageLink()).toMatchObject({
        href: '',
        shared: false,
        editable: true,
      });
      expect(editor.controller.undo()).toBe(true);
      expect(editor.session.exportSource().html).toBe(sharedSource);
    } finally {
      editor.dispose();
    }
  });

  it('reports unsupported shared structures and refuses to alter their siblings', () => {
    const cases = [
      {
        html: '<a href="https://example.com"><span>Shared<img src="https://example.com/image.png" alt="Image"></span></a>',
        reason: 'shared-structure',
      },
      {
        html: '<a id="unique" href="https://example.com">Shared<img src="https://example.com/image.png" alt="Image"></a>',
        reason: 'shared-identity',
      },
      {
        html: '<a name="destination" href="https://example.com"><img src="https://example.com/image.png" alt="Image">Shared</a>',
        reason: 'shared-identity',
      },
    ];
    for (const fixture of cases) {
      const editor = factory.create({ source: { html: fixture.html, css: '' } });
      try {
        const before = editor.session.snapshot();
        editor.controller.select(find(before.nodes, 'img').id);
        expect(editor.controller.imageLink()).toMatchObject({
          shared: true,
          editable: false,
          reason: fixture.reason,
        });
        expect(editor.controller.updateImageLink('https://example.com/new')).toBe(false);
        expect(editor.controller.updateImageLink('')).toBe(false);
        expect(editor.session.snapshot()).toEqual(before);
        expect(editor.session.exportSource().html).toBe(fixture.html);
      } finally {
        editor.dispose();
      }
    }
  });

  it('uses the configured URL policy and refuses unsafe destinations without a revision change', () => {
    const editor = factory.create({
      source: { html: imageSource, css: '' },
      exactUrlPlaceholders: ['{{profileUrl}}'],
    });
    try {
      const before = editor.session.snapshot();
      const image = find(before.nodes, 'img');
      editor.controller.select(image.id);
      for (const url of [
        'javascript:alert(1)',
        'data:text/html,unsafe',
        'java\nscript:unsafe',
        '//outside.example',
        '{{unconfigured}}',
      ]) {
        expect(editor.controller.updateImageLink(url)).toBe(false);
        expect(editor.session.snapshot()).toEqual(before);
      }
      expect(editor.controller.updateImageLink('{{profileUrl}}')).toBe(true);
      expect(editor.controller.imageLink()?.href).toBe('{{profileUrl}}');
      expect(editor.controller.imageLink()?.target).toBe('_self');
    } finally {
      editor.dispose();
    }
  });

  it('rejects missing images, other selected elements, readonly and unsupported targets', () => {
    const editor = factory.create({ source: { html: imageSource, css: '' } });
    try {
      const before = editor.session.snapshot();
      const image = find(before.nodes, 'img');
      editor.controller.select(find(before.nodes, 'p').id);
      expect(editor.controller.imageLink()).toBeUndefined();
      expect(editor.controller.updateImageLink('https://example.com')).toBe(false);
      expect(editor.session.updateImageLink('missing', 'https://example.com')).toBe(false);
      editor.controller.select(image.id);
      expect(
        Reflect.apply(editor.session.updateImageLink, editor.session, [
          image.id,
          'https://example.com',
          { target: '_top' },
        ]),
      ).toBe(false);
      editor.session.setReadOnly(true);
      expect(editor.controller.updateImageLink('https://example.com')).toBe(false);
      expect(editor.session.snapshot()).toEqual(before);
    } finally {
      editor.dispose();
    }
  });

  it('retains the image destination after HTML export and reimport without nested anchors', () => {
    const editor = factory.create({ source: { html: sharedSource, css: '' } });
    try {
      const image = find(editor.session.snapshot().nodes, 'img');
      editor.controller.select(image.id);
      expect(editor.controller.updateImageLink('https://example.com/image')).toBe(true);
      const reopened = factory.create({ source: editor.controller.exportSource() });
      try {
        reopened.controller.select(find(reopened.session.snapshot().nodes, 'img').id);
        expect(reopened.controller.imageLink()?.href).toBe('https://example.com/image');
        const anchors = all(reopened.session.snapshot().nodes).filter((node) => node.tag === 'a');
        expect(anchors).toHaveLength(3);
        expect(
          anchors.every((node) => !all(node.children ?? []).some((child) => child.tag === 'a')),
        ).toBe(true);
      } finally {
        reopened.dispose();
      }
    } finally {
      editor.dispose();
    }
  });
});
