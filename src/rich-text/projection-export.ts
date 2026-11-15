import type {
  DOMOutputSpec,
  Fragment,
  Mark as ProseMirrorMark,
  Node as ProseMirrorNode,
  Schema,
} from '@tiptap/pm/model';
import { escapeHtml } from '../core/html-escape';
import { RICH_TEXT_EDGE_ATTRIBUTE, RICH_TEXT_IMPLICIT_ATTRIBUTE, isRichTextEdge } from './schema';

interface CompiledSpec {
  readonly open: string;
  readonly close: string;
  readonly hole: boolean;
}

/**
 * Serializes an editor document to the rich-text projection without a DOM: allowlisted tags,
 * the origin marker and the styles the person applied. Source attributes never leave with it.
 */
export class RichTextProjectionExporter {
  readonly #nodes = new Map<string, (node: ProseMirrorNode) => DOMOutputSpec>();
  readonly #marks = new Map<string, (mark: ProseMirrorMark, inline: boolean) => DOMOutputSpec>();

  /** Captures the projection specs; construct it before the schema gains a faithful view. */
  constructor(schema: Schema) {
    for (const type of Object.values(schema.nodes))
      if (type.spec.toDOM) this.#nodes.set(type.name, type.spec.toDOM);
    for (const type of Object.values(schema.marks))
      if (type.spec.toDOM) this.#marks.set(type.name, type.spec.toDOM);
  }

  export(document: ProseMirrorNode): string {
    return document.type.inlineContent
      ? `<p>${this.text(document)}</p>`
      : this.blocks(document.content);
  }

  /** The text of a block, with the source spacing and terminal break the editor set aside. */
  private text(node: ProseMirrorNode): string {
    const edge: unknown = node.attrs[RICH_TEXT_EDGE_ATTRIBUTE];
    const content = this.inline(node.content);
    return isRichTextEdge(edge)
      ? `${edge.lead}${content}${edge.br ? '<br>' : ''}${edge.tail}`
      : content;
  }

  private blocks(fragment: Fragment): string {
    let output = '';
    fragment.forEach((node) => {
      output += this.node(node);
    });
    return output;
  }

  private node(node: ProseMirrorNode): string {
    const content = (): string =>
      node.type.inlineContent ? this.text(node) : this.blocks(node.content);
    // Loose text returns to the document as loose text, not as a new paragraph.
    if (node.type.name === 'paragraph' && node.attrs[RICH_TEXT_IMPLICIT_ATTRIBUTE] === true)
      return content();
    const render = this.#nodes.get(node.type.name);
    if (!render) throw new Error('RICH_TEXT_EXPORT_UNSUPPORTED');
    const spec = this.compile(render(node));
    return spec.open + (spec.hole ? content() : '') + spec.close;
  }

  private inline(fragment: Fragment): string {
    let output = '';
    const active: { mark: ProseMirrorMark; close: string }[] = [];
    fragment.forEach((node) => {
      let keep = 0;
      while (
        keep < active.length &&
        keep < node.marks.length &&
        node.marks[keep]!.eq(active[keep]!.mark)
      )
        keep += 1;
      while (active.length > keep) output += active.pop()!.close;
      for (const mark of node.marks.slice(keep)) {
        const render = this.#marks.get(mark.type.name);
        if (!render) throw new Error('RICH_TEXT_EXPORT_UNSUPPORTED');
        const spec = this.compile(render(mark, true));
        output += spec.open;
        active.push({ mark, close: spec.close });
      }
      output += node.isText ? escapeHtml(node.text ?? '') : this.node(node);
    });
    while (active.length) output += active.pop()!.close;
    return output;
  }

  private compile(spec: DOMOutputSpec): CompiledSpec {
    if (typeof spec === 'string') return { open: escapeHtml(spec), close: '', hole: false };
    if (!Array.isArray(spec)) throw new Error('RICH_TEXT_EXPORT_UNSUPPORTED');
    const parts = spec as readonly unknown[];
    const tag = parts[0];
    if (typeof tag !== 'string' || !/^[a-z][a-z0-9]*$/.test(tag))
      throw new Error('RICH_TEXT_EXPORT_UNSUPPORTED');
    const second = parts[1];
    const described = !!second && typeof second === 'object' && !Array.isArray(second);
    let attributes = '';
    if (described)
      for (const [name, value] of Object.entries(second as Record<string, unknown>)) {
        if (value === null || value === undefined || value === false) continue;
        if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) throw new Error('RICH_TEXT_EXPORT_UNSUPPORTED');
        attributes += ` ${name}="${escapeHtml(String(value))}"`;
      }
    let open = `<${tag}${attributes}>`;
    let close = '';
    let hole = false;
    for (const child of parts.slice(described ? 2 : 1)) {
      if (child === 0) {
        hole = true;
        continue;
      }
      const inner = this.compile(child as DOMOutputSpec);
      if (hole) close += inner.open + inner.close;
      else if (inner.hole) {
        open += inner.open;
        close = inner.close + close;
        hole = true;
      } else open += inner.open + inner.close;
    }
    return { open, close: tag === 'br' || tag === 'hr' ? close : `${close}</${tag}>`, hole };
  }
}
