import { Mark } from '@tiptap/core';
import type { Editor, Extensions } from '@tiptap/core';
import { TextStyle, TextStyleKit } from '@tiptap/extension-text-style';
import type { Mark as ProseMirrorMark, MarkType } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import {
  RICH_TEXT_FORMATS,
  RICH_TEXT_ORIGIN_ATTRIBUTE,
  RICH_TEXT_REMOVED_ATTRIBUTE,
} from '../core/rich-text-format';
import type { RichTextFormat } from '../core/rich-text-format';

/** Keeps preservation provenance independent from removable semantic marks. */
export class RichTextFormatting {
  styleExtensions(): Extensions {
    return [
      TextStyleKit.configure({ textStyle: false }),
      TextStyle.extend({
        // New style spans must be inside source origins when their attributes are restored.
        priority: 90,
        parseHTML() {
          // Keep the non-consuming style parser ahead of generic origin spans.
          return (this.parent?.() ?? []).map((rule) => ({ ...rule, priority: 60 }));
        },
      }).configure({ mergeNestedSpanStyles: false }),
    ];
  }

  markName(format: RichTextFormat): string {
    return `preserved${format.charAt(0).toUpperCase()}${format.slice(1)}Style`;
  }

  markNames(): readonly string[] {
    return RICH_TEXT_FORMATS.map((format) => this.markName(format));
  }

  extensions(): readonly Mark[] {
    return RICH_TEXT_FORMATS.map((format) =>
      Mark.create({
        name: this.markName(format),
        excludes: '',
        addAttributes: () => ({
          [RICH_TEXT_REMOVED_ATTRIBUTE]: {
            default: format,
            parseHTML: () => format,
            renderHTML: () => ({ [RICH_TEXT_REMOVED_ATTRIBUTE]: format }),
          },
        }),
        parseHTML: () => [
          {
            tag: `span[${RICH_TEXT_ORIGIN_ATTRIBUTE}][${RICH_TEXT_REMOVED_ATTRIBUTE}="${format}"]`,
          },
        ],
        renderHTML: ({ HTMLAttributes }) => [
          'span',
          { ...HTMLAttributes, [RICH_TEXT_REMOVED_ATTRIBUTE]: format },
          0,
        ],
      }),
    );
  }

  toggle(editor: Editor, format: Exclude<RichTextFormat, 'link'>, focus = true): boolean {
    if (!editor.isEditable || editor.isDestroyed) return false;
    const removing = editor.isActive(format);
    let chain = focus ? editor.chain().focus(undefined, { scrollIntoView: false }) : editor.chain();
    if (removing) chain = chain.command(({ tr }) => this.preserve(tr, format));
    chain = chain.toggleMark(format);
    if (!removing) chain = chain.command(({ tr }) => this.restore(tr, format));
    return chain.run();
  }

  removeLink(editor: Editor, focus = true): boolean {
    if (!editor.isEditable || editor.isDestroyed) return false;
    return (focus ? editor.chain().focus(undefined, { scrollIntoView: false }) : editor.chain())
      .extendMarkRange('link')
      .command(({ tr }) => this.preserve(tr, 'link'))
      .unsetLink()
      .run();
  }

  /** The source tag and attributes travel with the origin wherever the schema declares them. */
  private carried(source: ProseMirrorMark, target: MarkType): Record<string, unknown> {
    const raw: unknown = source.attrs.raw;
    const declared = target.spec.attrs;
    return raw && declared && 'raw' in declared ? { raw } : {};
  }

  preserve(tr: Transaction, format: RichTextFormat): boolean {
    const semantic = tr.doc.type.schema.marks[format];
    const preservation = tr.doc.type.schema.marks[this.markName(format)];
    if (!semantic || !preservation) return false;
    const preserved = (marks: readonly ProseMirrorMark[]): ProseMirrorMark | undefined => {
      const source = marks.find((mark) => mark.type === semantic);
      const value: unknown = source?.attrs[RICH_TEXT_ORIGIN_ATTRIBUTE];
      return source && typeof value === 'string' && value.length > 0 && value.length <= 200
        ? preservation.create({
            [RICH_TEXT_ORIGIN_ATTRIBUTE]: value,
            ...this.carried(source, preservation),
          })
        : undefined;
    };
    if (tr.selection.empty) {
      const mark = preserved(tr.storedMarks ?? tr.selection.$from.marks());
      if (mark) tr.addStoredMark(mark);
      return true;
    }
    const { from, to } = tr.selection;
    tr.doc.nodesBetween(from, to, (node, position) => {
      if (!node.isInline) return;
      const mark = preserved(node.marks);
      if (mark) tr.addMark(Math.max(from, position), Math.min(to, position + node.nodeSize), mark);
    });
    return true;
  }

  restore(tr: Transaction, format: RichTextFormat): boolean {
    const semantic = tr.doc.type.schema.marks[format];
    const preservation = tr.doc.type.schema.marks[this.markName(format)];
    if (!semantic || !preservation) return false;
    const transfer = (marks: readonly ProseMirrorMark[]): ProseMirrorMark | undefined => {
      const source = marks.find((mark) => mark.type === preservation);
      const id: unknown = source?.attrs[RICH_TEXT_ORIGIN_ATTRIBUTE];
      const current = marks.find((mark) => mark.type === semantic);
      return current && source && typeof id === 'string' && id.length > 0 && id.length <= 200
        ? semantic.create({
            ...current.attrs,
            [RICH_TEXT_ORIGIN_ATTRIBUTE]: id,
            ...this.carried(source, semantic),
          })
        : undefined;
    };
    if (tr.selection.empty) {
      const mark = transfer(tr.storedMarks ?? tr.selection.$from.marks());
      if (mark) {
        tr.addStoredMark(mark);
        tr.removeStoredMark(preservation);
      }
      return true;
    }
    const { from, to } = tr.selection;
    tr.doc.nodesBetween(from, to, (node, position) => {
      if (!node.isInline) return;
      const mark = transfer(node.marks);
      if (!mark) return;
      const start = Math.max(from, position);
      const end = Math.min(to, position + node.nodeSize);
      tr.addMark(start, end, mark);
      tr.removeMark(start, end, preservation);
    });
    return true;
  }
}
