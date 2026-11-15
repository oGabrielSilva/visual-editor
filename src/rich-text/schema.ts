import { Extension, Mark, Node } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type {
  DOMOutputSpec,
  Mark as ProseMirrorMark,
  Node as ProseMirrorNode,
  Schema,
} from '@tiptap/pm/model';
import {
  RichTextFormatPolicy,
  RICH_TEXT_ORIGIN_ATTRIBUTE,
  RICH_TEXT_REMOVED_ATTRIBUTE,
} from '../core/rich-text-format';
import { TEXT_ORIGIN_ATTRIBUTE } from '../core/canvas-contract';
import { RichTextFormatting } from './formatting';
import { RichTextWhitespaceParser } from './whitespace';

export const RICH_TEXT_RAW_ATTRIBUTE = 'raw';
export const RICH_TEXT_IMPLICIT_ATTRIBUTE = 'implicit';
/** Collapsible source spacing and a terminal line break around the text of a block. */
export const RICH_TEXT_EDGE_ATTRIBUTE = 'edge';
/** A source span which wraps other marks; the plain preserved span is always the innermost. */
export const RICH_TEXT_OUTER_SPAN = 'preservedOuterSpan';

export interface RichTextEdge {
  readonly lead: string;
  readonly tail: string;
  readonly br: boolean;
}

export function isRichTextEdge(value: unknown): value is RichTextEdge {
  if (!value || typeof value !== 'object') return false;
  const edge = value as Record<string, unknown>;
  return (
    typeof edge.lead === 'string' &&
    typeof edge.tail === 'string' &&
    typeof edge.br === 'boolean' &&
    /^[ \t\n\r\f]*$/.test(edge.lead + edge.tail)
  );
}
/** Marks the element which the frame runtime renders for a source node with an origin. */
export const RICH_TEXT_VIEW_ORIGIN_ATTRIBUTE = TEXT_ORIGIN_ATTRIBUTE;
/** A neutral block for loose text between blocks; it never matches author selectors by tag. */
export const RICH_TEXT_IMPLICIT_TAG = 'visual-editor-line';

export interface RichTextRaw {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
}

export interface RichTextSchemaOptions {
  /**
   * `paragraph` and `block+` are the projection documents of the panel editor. `inline*` puts the
   * text directly in the mounted element, so a heading or a link gains no inner paragraph.
   */
  readonly content: 'paragraph' | 'block+' | 'inline*';
  readonly links: boolean;
  readonly isAllowedUri: (value: string) => boolean;
  /** Keeps source tags and attributes in the rendered view. Only for the real element. */
  readonly fidelity?: boolean;
}

export function isRichTextRaw(value: unknown): value is RichTextRaw {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { tag?: unknown; attrs?: unknown };
  return (
    typeof candidate.tag === 'string' &&
    !!candidate.attrs &&
    typeof candidate.attrs === 'object' &&
    Object.values(candidate.attrs).every((entry) => typeof entry === 'string')
  );
}

const originTypes = (formatting: RichTextFormatting): string[] => [
  'preservedSpan',
  RICH_TEXT_OUTER_SPAN,
  ...formatting.markNames(),
  'link',
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'superscript',
  'subscript',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
];

/** The single rich-text schema definition of the panel editor and of the frame runtime. */
export class RichTextSchema {
  readonly formatting = new RichTextFormatting();
  private readonly formats = new RichTextFormatPolicy();

  extensions(options: RichTextSchemaOptions): Extensions {
    const blocks = options.content === 'block+';
    const formatting = this.formatting;
    const documentNode = Node.create({ name: 'doc', topNode: true, content: options.content });
    const span = Mark.create({
      name: 'preservedSpan',
      excludes: '',
      parseHTML: () => [
        { tag: `span[${RICH_TEXT_ORIGIN_ATTRIBUTE}]:not([${RICH_TEXT_REMOVED_ATTRIBUTE}])` },
      ],
      renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
    });
    const superscript = Mark.create({
      name: 'superscript',
      parseHTML: () => [{ tag: 'sup' }],
      renderHTML: ({ HTMLAttributes }) => ['sup', HTMLAttributes, 0],
    });
    const subscript = Mark.create({
      name: 'subscript',
      parseHTML: () => [{ tag: 'sub' }],
      renderHTML: ({ HTMLAttributes }) => ['sub', HTMLAttributes, 0],
    });
    const origins = Extension.create({
      name: 'preservedOrigins',
      addGlobalAttributes() {
        return [
          {
            types: originTypes(formatting),
            attributes: {
              [RICH_TEXT_ORIGIN_ATTRIBUTE]: {
                default: null,
                parseHTML: (element: HTMLElement): string | null => {
                  const value = element.getAttribute(RICH_TEXT_ORIGIN_ATTRIBUTE);
                  return value && value.length <= 200 ? value : null;
                },
                renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
                  const value = attributes[RICH_TEXT_ORIGIN_ATTRIBUTE];
                  return typeof value === 'string' && value.length <= 200
                    ? { [RICH_TEXT_ORIGIN_ATTRIBUTE]: value }
                    : {};
                },
              },
            },
          },
        ];
      },
    });
    const whitespace = Extension.create({
      name: 'preserveRichTextWhitespace',
      addProseMirrorPlugins() {
        return [
          new Plugin({
            props: { clipboardParser: new RichTextWhitespaceParser(this.editor.schema) },
          }),
        ];
      },
    });
    return [
      documentNode,
      StarterKit.configure({
        document: false,
        undoRedo: { depth: 100, newGroupDelay: 500 },
        trailingNode: false,
        heading: blocks ? { levels: [1, 2, 3, 4, 5, 6] } : false,
        link: options.links
          ? {
              autolink: false,
              linkOnPaste: false,
              openOnClick: false,
              defaultProtocol: 'https',
              isAllowedUri: (value: string) => options.isAllowedUri(value),
              HTMLAttributes: { target: null, rel: null, class: null },
            }
          : false,
        codeBlock: blocks ? { HTMLAttributes: {} } : false,
        horizontalRule: blocks ? {} : false,
        blockquote: blocks ? {} : false,
        ...(blocks
          ? {}
          : { bulletList: false, orderedList: false, listItem: false, listKeymap: false }),
      }),
      ...formatting.styleExtensions(),
      span,
      ...formatting.extensions(),
      superscript,
      subscript,
      origins,
      ...(options.fidelity ? [this.outerSpan(), this.fidelityExtension()] : []),
      whitespace,
    ];
  }

  /**
   * Makes the rendered view reuse the source tag and attributes of every node with an origin.
   * Capture the projection specs (RichTextProjectionExporter) before calling this.
   */
  applyFidelity(schema: Schema): void {
    for (const type of Object.values(schema.marks)) {
      const original = type.spec.toDOM;
      if (!original) continue;
      const removed = this.formatting.markNames().includes(type.name);
      type.spec.toDOM = (mark: ProseMirrorMark, inline: boolean): DOMOutputSpec =>
        this.faithful(original(mark, inline), mark.attrs, removed, true);
    }
    for (const type of Object.values(schema.nodes)) {
      const original = type.spec.toDOM;
      if (!original) continue;
      type.spec.toDOM = (node: ProseMirrorNode): DOMOutputSpec =>
        type.name === 'paragraph' && node.attrs[RICH_TEXT_IMPLICIT_ATTRIBUTE] === true
          ? [RICH_TEXT_IMPLICIT_TAG, { style: 'display:block' }, 0]
          : this.faithful(original(node), node.attrs, false, false);
    }
  }

  private faithful(
    spec: DOMOutputSpec,
    attributes: Readonly<Record<string, unknown>>,
    removed: boolean,
    renameable: boolean,
  ): DOMOutputSpec {
    const raw: unknown = attributes[RICH_TEXT_RAW_ATTRIBUTE];
    const origin: unknown = attributes[RICH_TEXT_ORIGIN_ATTRIBUTE];
    if (!isRichTextRaw(raw) || typeof origin !== 'string' || !Array.isArray(spec)) return spec;
    const parts = spec as readonly unknown[];
    const tag = parts[0];
    if (typeof tag !== 'string') return spec;
    const second = parts[1];
    const described = !!second && typeof second === 'object' && !Array.isArray(second);
    const semantic = described ? (second as Readonly<Record<string, unknown>>) : {};
    const merged: Record<string, string> = { ...raw.attrs };
    const format = attributes[RICH_TEXT_REMOVED_ATTRIBUTE];
    if (removed && this.formats.isFormat(format)) {
      for (const name of this.formats.removedAttributes(format)) delete merged[name];
      const resets = Object.entries(this.formats.resets(format))
        .map(([property, value]) => `${property}:${value}`)
        .join(';');
      if (resets) merged.style = merged.style ? `${merged.style};${resets}` : resets;
    }
    // Attributes owned by the schema (a link target, a list start) win over the source copy.
    for (const [name, value] of Object.entries(semantic)) {
      if (name === RICH_TEXT_ORIGIN_ATTRIBUTE || value === null || value === undefined) continue;
      if (typeof value === 'string' || typeof value === 'number') merged[name] = String(value);
    }
    merged[RICH_TEXT_VIEW_ORIGIN_ATTRIBUTE] = origin;
    const name = removed ? 'span' : renameable ? raw.tag : tag;
    return [name, merged, ...parts.slice(described ? 2 : 1)] as unknown as DOMOutputSpec;
  }

  /** Outermost mark of the schema, so a source span can keep wrapping a link or a bold. */
  private outerSpan(): Mark {
    return Mark.create({
      name: RICH_TEXT_OUTER_SPAN,
      priority: 1100,
      excludes: '',
      renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
    });
  }

  private fidelityExtension(): Extension {
    const formatting = this.formatting;
    const key = new PluginKey('implicitRichTextParagraphs');
    return Extension.create({
      name: 'richTextFidelity',
      addGlobalAttributes() {
        return [
          {
            types: originTypes(formatting),
            attributes: {
              [RICH_TEXT_RAW_ATTRIBUTE]: {
                default: null,
                rendered: false,
                parseHTML: (): null => null,
              },
            },
          },
          {
            types: ['doc', 'paragraph', 'heading'],
            attributes: {
              [RICH_TEXT_EDGE_ATTRIBUTE]: {
                default: null,
                rendered: false,
                parseHTML: (): null => null,
              },
            },
          },
          {
            types: ['paragraph'],
            attributes: {
              [RICH_TEXT_IMPLICIT_ATTRIBUTE]: {
                default: false,
                rendered: false,
                parseHTML: (): boolean => false,
              },
            },
          },
        ];
      },
      addProseMirrorPlugins() {
        return [
          new Plugin({
            key,
            appendTransaction: (transactions, _previous, state): Transaction | null => {
              if (!transactions.some((transaction) => transaction.docChanged)) return null;
              const changes: { position: number; node: ProseMirrorNode; implicit: boolean }[] = [];
              const implicit = (node: ProseMirrorNode | null | undefined): boolean =>
                node?.type.name === 'paragraph' &&
                node.attrs[RICH_TEXT_IMPLICIT_ATTRIBUTE] === true;
              state.doc.descendants((node, position, parent, index) => {
                if (!parent) return true;
                if (node.type.name === 'paragraph') {
                  // Two loose runs cannot be neighbours: the second would merge into the first.
                  if (implicit(node) && index > 0 && implicit(parent.child(index - 1)))
                    changes.push({ position, node, implicit: false });
                  return false;
                }
                if (node.type.name === 'listItem' && index > 0) {
                  // A new item follows the shape of the item it was split from.
                  const first = node.firstChild;
                  if (
                    first?.type.name === 'paragraph' &&
                    !implicit(first) &&
                    first.attrs[RICH_TEXT_ORIGIN_ATTRIBUTE] === null &&
                    implicit(parent.child(index - 1).firstChild)
                  )
                    changes.push({ position: position + 1, node: first, implicit: true });
                }
                return true;
              });
              if (!changes.length) return null;
              const transaction = state.tr;
              for (const change of changes)
                transaction.setNodeMarkup(change.position, undefined, {
                  ...change.node.attrs,
                  [RICH_TEXT_IMPLICIT_ATTRIBUTE]: change.implicit,
                });
              return transaction;
            },
          }),
        ];
      },
    });
  }
}
