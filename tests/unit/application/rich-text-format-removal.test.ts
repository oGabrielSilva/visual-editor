import { describe, expect, it } from 'vitest';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode } from '../../../src/core/document';
import {
  RichTextFormatPolicy,
  RICH_TEXT_ORIGIN_ATTRIBUTE,
  RICH_TEXT_REMOVED_ATTRIBUTE,
} from '../../../src/core/rich-text-format';

const factory = new EditorFactory(() => ({
  compile: async () => {
    throw new Error('NOT_USED');
  },
}));
function all(nodes: readonly DocumentNode[]): readonly DocumentNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}
function find(
  nodes: readonly DocumentNode[],
  predicate: (node: DocumentNode) => boolean,
): DocumentNode {
  const result = all(nodes).find(predicate);
  if (!result) throw new Error('MISSING_FIXTURE_NODE');
  return result;
}
function removed(id: string, kind: string, value = 'AB'): string {
  return `<span ${RICH_TEXT_ORIGIN_ATTRIBUTE}="${id}" ${RICH_TEXT_REMOVED_ATTRIBUTE}="${kind}">${value}</span>`;
}

const cases = [
  { kind: 'bold', tag: 'strong', style: 'color:red;font-weight:700', reset: 'font-weight:normal' },
  { kind: 'italic', tag: 'em', style: 'color:red;font-style:italic', reset: 'font-style:normal' },
  {
    kind: 'underline',
    tag: 'u',
    style: 'color:red;text-decoration:underline',
    reset: 'text-decoration-line:none',
  },
  {
    kind: 'strike',
    tag: 's',
    style: 'color:red;text-decoration:line-through',
    reset: 'text-decoration-line:none',
  },
  { kind: 'link', tag: 'a', style: 'color:red', reset: '' },
] as const;

describe('removing an original rich-text format preserves unrelated attributes', () => {
  for (const fixture of cases) {
    it(`removes ${fixture.kind} while preserving HTML/JSON identity, appearance attributes, history and readonly`, () => {
      const link =
        fixture.kind === 'link'
          ? ' href="https://example.com" target="_blank" rel="nofollow" download="file" hreflang="pt-BR" referrerpolicy="no-referrer" type="text/html" name="anchor"'
          : '';
      const html = `<p>Before <${fixture.tag} id="styled" class="brand" title="Note" data-native="keep" style="${fixture.style}"${link}>AB</${fixture.tag}> After</p><p>Untouched</p>`;
      const editor = factory.create({ source: { html, css: '.brand{letter-spacing:1px}' } });
      try {
        const before = editor.session.snapshot();
        const paragraph = find(before.nodes, (node) => node.tag === 'p');
        const original = find(before.nodes, (node) => node.attrs?.id === 'styled');
        const draft = `<p>Before ${removed(original.id, fixture.kind)} After</p>`;
        expect(editor.controller.beginRichText(paragraph.id)).toBe(true);
        expect(editor.controller.updateRichTextDraft(draft)).toBe(true);
        expect(editor.controller.commitRichText()).toBe(true);
        const changed = find(
          editor.session.snapshot().nodes,
          (node) => node.attrs?.id === 'styled',
        );
        expect(changed.tag).toBe('span');
        expect(changed.attrs).toMatchObject({
          id: 'styled',
          class: 'brand',
          title: 'Note',
          'data-native': 'keep',
        });
        expect(changed.attrs?.style).toContain('color:red');
        if (fixture.reset) expect(changed.attrs?.style).toContain(fixture.reset);
        if (fixture.kind === 'link') {
          for (const name of [
            'href',
            'target',
            'rel',
            'ping',
            'download',
            'hreflang',
            'referrerpolicy',
            'type',
            'name',
          ])
            expect(changed.attrs?.[name]).toBeUndefined();
        }
        const exported = editor.controller.exportSource();
        expect(exported.html).toContain('<span');
        expect(exported.html).not.toContain(`<${fixture.tag} `);
        expect(exported.html).toContain('<p>Untouched</p>');
        expect(exported.css).toBe('.brand{letter-spacing:1px}');
        expect(JSON.stringify(editor.session.snapshot())).not.toContain(
          RICH_TEXT_REMOVED_ATTRIBUTE,
        );
        expect(exported.html).not.toContain(RICH_TEXT_ORIGIN_ATTRIBUTE);
        expect(editor.controller.undo()).toBe(true);
        expect(editor.session.exportSource().html).toBe(html);
        editor.session.setReadOnly(true);
        expect(editor.controller.updateRichTextFor(paragraph.id, draft)).toBe(false);
        expect(editor.session.exportSource().html).toBe(html);
      } finally {
        editor.dispose();
      }
    });
  }

  it('preserves link color when the link semantic mark is removed', () => {
    const editor = factory.create({
      source: {
        html: '<p><a class="brand" style="color:#123456" href="https://example.com">Link</a></p>',
        css: '',
      },
    });
    try {
      const data = editor.session.snapshot();
      const paragraph = find(data.nodes, (node) => node.tag === 'p');
      const anchor = find(data.nodes, (node) => node.tag === 'a');
      expect(
        editor.controller.updateRichTextFor(
          paragraph.id,
          `<p>${removed(anchor.id, 'link', 'Link')}</p>`,
        ),
      ).toBe(true);
      const span = find(editor.session.snapshot().nodes, (node) => node.tag === 'span');
      expect(span.attrs).toMatchObject({ class: 'brand', style: 'color:#123456' });
      expect(span.attrs?.href).toBeUndefined();
    } finally {
      editor.dispose();
    }
  });

  it('converts an unambiguous legacy anchor name to one HTML id across removal splits', () => {
    const editor = factory.create({
      source: {
        html: '<p><a name="jump" class="brand" href="https://example.com">AB</a></p>',
        css: '',
      },
    });
    try {
      const data = editor.session.snapshot();
      const paragraph = find(data.nodes, (node) => node.tag === 'p');
      const anchor = find(data.nodes, (node) => node.tag === 'a');
      expect(
        editor.controller.updateRichTextFor(
          paragraph.id,
          `<p>${removed(anchor.id, 'link', 'A')}${removed(anchor.id, 'link', 'B')}</p>`,
        ),
      ).toBe(true);
      const spans = all(editor.session.snapshot().nodes).filter((node) => node.tag === 'span');
      expect(spans).toHaveLength(2);
      expect(spans.filter((node) => node.attrs?.id === 'jump')).toHaveLength(1);
      expect(
        spans.every(
          (node) => node.attrs?.class === 'brand' && !node.attrs?.name && !node.attrs?.href,
        ),
      ).toBe(true);
    } finally {
      editor.dispose();
    }
  });

  it('does not introduce a duplicated HTML id when an anchor name already belongs to another node', () => {
    const editor = factory.create({
      source: {
        html: '<p><a name="jump" href="https://example.com">Link</a></p><section id="jump">Target</section>',
        css: '',
      },
    });
    try {
      const data = editor.session.snapshot();
      const paragraph = find(data.nodes, (node) => node.tag === 'p');
      const anchor = find(data.nodes, (node) => node.tag === 'a');
      expect(
        editor.controller.updateRichTextFor(
          paragraph.id,
          `<p>${removed(anchor.id, 'link', 'Link')}</p>`,
        ),
      ).toBe(true);
      expect(
        all(editor.session.snapshot().nodes).filter((node) => node.attrs?.id === 'jump'),
      ).toHaveLength(1);
      expect(
        find(editor.session.snapshot().nodes, (node) => node.tag === 'span').attrs?.id,
      ).toBeUndefined();
    } finally {
      editor.dispose();
    }
  });

  it('refuses foreign origins, kind mismatches, missing origin and non-span transitions without changing the document', () => {
    const editor = factory.create({
      source: {
        html: '<p id="first"><strong class="brand">First</strong></p><p><em>Other</em><span>Plain</span></p>',
        css: '',
      },
    });
    try {
      const before = editor.session.snapshot();
      const paragraph = find(before.nodes, (node) => node.attrs?.id === 'first');
      const strong = find(before.nodes, (node) => node.tag === 'strong');
      const other = find(before.nodes, (node) => node.tag === 'em');
      expect(editor.controller.beginRichText(paragraph.id)).toBe(true);
      const invalid = [
        removed(other.id, 'italic'),
        removed(strong.id, 'italic'),
        removed(strong.id, 'bold italic'),
        removed(strong.id, ''),
        `<span ${RICH_TEXT_REMOVED_ATTRIBUTE}="bold">Missing origin</span>`,
        `<strong ${RICH_TEXT_ORIGIN_ATTRIBUTE}="${strong.id}" ${RICH_TEXT_REMOVED_ATTRIBUTE}="bold">Wrong target</strong>`,
      ];
      for (const input of invalid) {
        expect(editor.controller.updateRichTextDraft(`<p>${input}</p>`)).toBe(false);
        expect(editor.session.snapshot()).toEqual(before);
      }
      expect(editor.controller.commitRichText()).toBe(false);
    } finally {
      editor.dispose();
    }
  });

  it('does not expose mutable reset policy or recognize unrelated tags as formatting', () => {
    const policy = new RichTextFormatPolicy();
    const first = policy.resets('bold');
    Object.assign(first, { 'font-weight': '900' });
    expect(policy.resets('bold')).toEqual({ 'font-weight': 'normal' });
    expect(policy.formatForTag('toString')).toBeUndefined();
    expect(policy.canRemove('strong', 'span', 'bold')).toBe(true);
    expect(policy.canRemove('span', 'span', 'bold')).toBe(false);
    expect(policy.canRemove('strong', 'span', 'link')).toBe(false);
  });
});

describe('ambiguous stylesheet decoration refuses the gesture without losing work', () => {
  const fixtures = [
    {
      html: '<p><s class="combo">AB</s></p>',
      css: '.combo{text-decoration:underline line-through}',
      tag: 's',
      kind: 'strike',
    },
    {
      html: '<style>.combo{text-decoration-line:underline line-through!important}</style><p><s class="combo">AB</s></p>',
      css: '',
      tag: 's',
      kind: 'strike',
    },
    {
      html: '<p><u style="text-decoration:underline">AB</u></p>',
      css: 'u{text-decoration-line:underline!important}',
      tag: 'u',
      kind: 'underline',
    },
  ];
  for (const fixture of fixtures) {
    it(`keeps draft/revision/history when ${fixture.css ? 'document CSS' : 'a style node'} makes ${fixture.kind} ambiguous`, () => {
      const editor = factory.create({ source: { html: fixture.html, css: fixture.css } });
      try {
        const original = editor.session.snapshot();
        const paragraph = find(original.nodes, (node) => node.tag === 'p');
        expect(editor.session.updateAttribute(paragraph.id, 'title', 'Saved change')).toBe(true);
        const before = editor.session.snapshot();
        const mark = find(before.nodes, (node) => node.tag === fixture.tag);
        const draft = `<p>${removed(mark.id, fixture.kind)}</p>`;
        expect(editor.controller.beginRichText(paragraph.id)).toBe(true);
        expect(editor.controller.updateRichTextDraft(draft)).toBe(false);
        expect(editor.session.getState().pendingRichText).toMatchObject({
          html: draft,
          changed: true,
          valid: false,
        });
        expect(editor.controller.commitRichText()).toBe(false);
        expect(editor.session.snapshot()).toEqual(before);
        expect(editor.session.getState().canUndo).toBe(true);
        editor.controller.cancelRichText();
        expect(editor.controller.undo()).toBe(true);
        expect(editor.session.exportSource().html).toBe(fixture.html);
        expect(editor.session.exportSource().css).toBe(fixture.css);
      } finally {
        editor.dispose();
      }
    });
  }

  it('does not block unrelated bold removal merely because a stylesheet contains decoration', () => {
    const editor = factory.create({
      source: {
        html: '<p><strong class="combo">AB</strong></p>',
        css: '.combo{text-decoration:underline}',
      },
    });
    try {
      const data = editor.session.snapshot();
      const paragraph = find(data.nodes, (node) => node.tag === 'p');
      const original = find(data.nodes, (node) => node.tag === 'strong');
      expect(
        editor.controller.updateRichTextFor(paragraph.id, `<p>${removed(original.id, 'bold')}</p>`),
      ).toBe(true);
      expect(
        find(editor.session.snapshot().nodes, (node) => node.tag === 'span').attrs?.class,
      ).toBe('combo');
      expect(editor.session.exportSource().css).toBe('.combo{text-decoration:underline}');
    } finally {
      editor.dispose();
    }
  });
});
