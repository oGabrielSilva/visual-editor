import { describe, expect, it } from 'vitest';
import { CssDocumentCodec } from '../../../src/codecs/css';
import { RichTextProjection } from '../../../src/security/rich-text-projection';
import { EditorFactory } from '../../../src/composition/factory';
import type { DocumentNode } from '../../../src/core/document';

const styles = new CssDocumentCodec();
describe('semantic styles in the editing boundary', () => {
  it('allows bounded text style values without accepting host layout, URLs or variables', () => {
    expect(
      styles.richTextStyles(
        'color:#abc;font-size:24px;line-height:32px;font-family:"Times New Roman",serif',
      ),
    ).toMatchObject({
      color: '#abc',
      'font-size': '24px',
      'line-height': '32px',
    });
    for (const css of [
      'position:fixed',
      'color:var(--host-secret)',
      'background-color:url(https://probe.test/x)',
      'font-size:999999px',
      'font-size:0px',
      'line-height:999999',
      'line-height:501px',
      'font-family:untrusted',
      'color:red!important',
      'color:attr(title)',
      'font-size:calc(1px + 2px)',
    ])
      expect(styles.richTextStyles(css), css).toBeUndefined();
  });

  it('drops an entire unsafe style and keeps safe formatting when projecting a paste', () => {
    const projection = new RichTextProjection();
    expect(
      projection.project('<p><span style="color:rgba(12,34,56,.5);font-size:18px">Safe</span></p>')
        .adjusted,
    ).toBe(false);
    const rejected = projection.project(
      '<p style="font-size:999999px">Text</p><span style="color:red;position:fixed">Other</span>',
    );
    expect(rejected).toEqual({ html: '<p>Text</p><span>Other</span>', adjusted: true });
  });

  it('merges selected style changes with the original attributes and preserves untouched siblings', () => {
    const factory = new EditorFactory(() => ({
      compile: async () => {
        throw new Error('NOT_USED');
      },
    }));
    const editor = factory.create({
      source: {
        html: '<p><span class="original" style="color:red;margin-left:3px">First</span> <span style="color:green">Second</span></p>',
        css: '',
      },
    });
    const all = (nodes: readonly DocumentNode[]): readonly DocumentNode[] =>
      nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
    try {
      const nodes = all(editor.session.snapshot().nodes);
      const parent = nodes.find((node) => node.tag === 'p')!;
      const span = nodes.find((node) => node.tag === 'span')!;
      const other = nodes.filter((node) => node.tag === 'span')[1]!;
      expect(editor.controller.beginRichText(parent.id)).toBe(true);
      expect(
        editor.controller.updateRichTextDraft(
          `<p><span data-editor-rich-origin="${span.id}" style="color:#123456">First</span> <span data-editor-rich-origin="${other.id}">Second</span></p>`,
        ),
      ).toBe(true);
      expect(editor.controller.commitRichText()).toBe(true);
      const html = editor.session.exportSource().html;
      expect(html).toContain('margin-left:3px');
      expect(html).toContain('color:#123456');
      expect(html).toContain('class="original"');
      expect(html).toContain('style="color:green"');
      expect(editor.controller.undo()).toBe(true);
      expect(editor.session.exportSource().html).toContain('color:red;margin-left:3px');
      expect(editor.controller.redo()).toBe(true);
      expect(editor.session.exportSource().html).toContain('color:#123456');
    } finally {
      editor.dispose();
    }
  });
});

it('normalizes safe presentation on paragraphs and marks into text spans understood by the editor', () => {
  const projection = new RichTextProjection();
  expect(
    projection.project(
      '<p style="color:red;font-size:24px">A <strong style="color:blue">B</strong> <a href="https://safe.test" style="font-size:18px">C</a></p>',
    ),
  ).toEqual({
    html: '<p><span style="color:red;font-size:24px">A <strong><span style="color:blue">B</span></strong> <a href="https://safe.test"><span style="font-size:18px">C</span></a></span></p>',
    adjusted: false,
  });
  expect(
    projection.project(
      '<blockquote style="color:red"><p>Unsupported block style</p></blockquote>',
      true,
    ).adjusted,
  ).toBe(true);
});

it('does not reuse source HTML identities when duplicating a content block', () => {
  const factory = new EditorFactory(() => ({
    compile: async () => {
      throw new Error('NOT_USED');
    },
  }));
  const editor = factory.create({
    source: {
      html: '<h2 id="headline">Title <span id="word" name="word">part</span></h2><p>Other</p>',
      css: '',
    },
  });
  try {
    const entry = editor.controller.entries().find((node) => node.tag === 'h2')!;
    editor.controller.select(entry.id);
    expect(editor.controller.duplicate()).toBe(true);
    const html = editor.session.exportSource().html;
    expect(html.match(/id="headline"/g)).toHaveLength(1);
    expect(html.match(/id="word"/g)).toHaveLength(1);
    expect(html.match(/name="word"/g)).toHaveLength(1);
    expect(html.match(/<h2/g)).toHaveLength(2);
    expect(editor.controller.undo()).toBe(true);
    expect(editor.session.exportSource().html.match(/<h2/g)).toHaveLength(1);
  } finally {
    editor.dispose();
  }
});

it('keeps only bounded format-removal metadata in neutral origin spans', () => {
  const projection = new RichTextProjection();
  const safe =
    '<p><span data-editor-rich-origin="original" data-editor-rich-removed="bold">Text</span></p>';
  expect(projection.project(safe)).toEqual({ html: safe, adjusted: false });
  for (const input of [
    '<p><span data-editor-rich-removed="bold">Text</span></p>',
    '<p><span data-editor-rich-origin="original" data-editor-rich-removed="position">Text</span></p>',
    '<p><strong data-editor-rich-origin="original" data-editor-rich-removed="bold">Text</strong></p>',
  ]) {
    const result = projection.project(input);
    expect(result.adjusted).toBe(true);
    expect(result.html).not.toContain('data-editor-rich-removed');
  }
});

it('removes only the requested text decoration from combined inline CSS', () => {
  const styles = new CssDocumentCodec();
  for (const [line, expected] of [
    ['underline', 'line-through'],
    ['line-through', 'underline'],
  ] as const) {
    const output = styles.removeDecoration(
      'color:red;text-decoration:underline line-through wavy blue',
      line,
    );
    expect(styles.inspect(output, 'declarationList').declarations['text-decoration-line']).toBe(
      expected,
    );
    expect(output).toContain('color:red');
    expect(output).toContain('wavy blue');
  }
  const important = styles.removeDecoration(
    'text-decoration:underline line-through!important',
    'underline',
  );
  expect(important).toContain('text-decoration-line:line-through!important');
  expect(() => styles.removeDecoration('text-decoration:var(--native)', 'underline')).toThrow(
    'UNRESOLVED_TEXT_DECORATION',
  );
});

it('keeps unrelated inline decoration untouched when the requested line is absent', () => {
  const styles = new CssDocumentCodec();
  for (const css of [
    '',
    'color:red',
    'text-decoration-color:blue;text-decoration-style:wavy',
    'text-decoration:line-through wavy blue',
  ])
    expect(styles.removeDecoration(css, 'underline')).toBe(css);
});

it('detects stylesheet decoration rules through the CSS AST without interpreting applicability', () => {
  const styles = new CssDocumentCodec();
  expect(styles.hasDecorationRules('.combo{text-decoration:underline line-through}')).toBe(true);
  expect(
    styles.hasDecorationRules(
      '@media (min-width:1px){.combo{text-decoration-line:underline!important}}',
    ),
  ).toBe(true);
  expect(styles.hasDecorationRules('/*text-decoration:underline*/.combo{color:red}')).toBe(false);
  expect(
    styles.hasDecorationRules('.combo{text-decoration-color:blue;text-decoration-style:wavy}'),
  ).toBe(false);
});
