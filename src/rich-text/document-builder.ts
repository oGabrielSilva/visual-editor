import { RICH_TEXT_ORIGIN_ATTRIBUTE } from '../core/rich-text-format';
import { RichTextProjectionRules } from './projection-rules';
import {
  RICH_TEXT_EDGE_ATTRIBUTE,
  RICH_TEXT_IMPLICIT_ATTRIBUTE,
  RICH_TEXT_OUTER_SPAN,
  RICH_TEXT_RAW_ATTRIBUTE,
} from './schema';
import type { RichTextEdge, RichTextRaw } from './schema';

/** Source markup seen without a DOM: a document node or an element of the preview frame. */
export interface RichTextSourceNode {
  readonly type: 'text' | 'element' | 'other';
  readonly text?: string;
  readonly tag?: string;
  /** Present only when the element must be restored from its source node. */
  readonly origin?: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly children?: readonly RichTextSourceNode[];
}

export interface RichTextJsonMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichTextJsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextJsonNode[];
  marks?: RichTextJsonMark[];
  text?: string;
}

export interface RichTextBuildOptions {
  /** Mark names of the schema, outermost first: the only nesting the editor can render. */
  readonly markOrder: readonly string[];
  /** The block collapses white space, so source spacing at its edges is not content. */
  readonly collapse: boolean;
}

const marks: Readonly<Record<string, string>> = {
  strong: 'bold',
  em: 'italic',
  u: 'underline',
  s: 'strike',
  a: 'link',
  code: 'code',
  sup: 'superscript',
  sub: 'subscript',
  span: 'preservedSpan',
};
const limits = Object.freeze({ nodes: 20_000, depth: 64 });
const SOURCE_BREAK = /[ \t\r\f]*\n[ \t\n\r\f]*/g;
const LEADING = /^[ \t\n\r\f]+/;
const TRAILING = /[ \t\n\r\f]+$/;

/**
 * Builds the editor document straight from source markup, so mounting over the real element
 * keeps loose text loose and every source tag and attribute available to the rendered view.
 * Markup whose nesting the schema cannot reproduce is refused instead of being rearranged.
 */
export class RichTextDocumentBuilder {
  #count = 0;
  #options: RichTextBuildOptions = { markOrder: [], collapse: false };

  constructor(private readonly rules = new RichTextProjectionRules()) {}

  /** Returns undefined for markup the editor cannot represent faithfully. */
  build(
    children: readonly RichTextSourceNode[],
    allowBlocks: boolean,
    options: RichTextBuildOptions,
  ): RichTextJsonNode | undefined {
    this.#count = 0;
    this.#options = options;
    try {
      if (allowBlocks) return { type: 'doc', content: this.blocks(children, 0, true) };
      const text = this.textblock(children, 0);
      return {
        type: 'doc',
        ...(text.edge ? { attrs: { [RICH_TEXT_EDGE_ATTRIBUTE]: text.edge } } : {}),
        content: text.content,
      };
    } catch {
      return undefined;
    }
  }

  private visit(depth: number): void {
    if (++this.#count > limits.nodes || depth > limits.depth)
      throw new RangeError('RICH_TEXT_TOO_COMPLEX');
  }

  private origin(node: RichTextSourceNode): Record<string, unknown> {
    if (!node.origin) return {};
    const raw: RichTextRaw = { tag: node.tag ?? '', attrs: { ...node.attributes } };
    return { [RICH_TEXT_ORIGIN_ATTRIBUTE]: node.origin, [RICH_TEXT_RAW_ATTRIBUTE]: raw };
  }

  /** A span which wraps another mark must be rendered outside it. */
  private wraps(node: RichTextSourceNode): boolean {
    return (node.children ?? []).some(
      (child) =>
        child.type === 'element' &&
        child.tag !== 'br' &&
        (this.rules.canonicalTag(child.tag ?? '') !== 'span' || this.wraps(child)),
    );
  }

  private nest(active: readonly RichTextJsonMark[], type: string): void {
    const order = this.#options.markOrder;
    const rank = order.indexOf(type);
    const outer = active.at(-1);
    if (rank < 0) throw new Error('RICH_TEXT_UNSUPPORTED');
    if (!outer) return;
    const spans = type === 'preservedSpan' || type === RICH_TEXT_OUTER_SPAN;
    const previous = order.indexOf(outer.type);
    // The schema renders marks by rank; code excludes every other mark.
    if (
      type === 'code' ||
      active.some((mark) => mark.type === 'code') ||
      rank < previous ||
      (rank === previous && !spans)
    )
      throw new Error('RICH_TEXT_UNFAITHFUL');
  }

  private inline(
    nodes: readonly RichTextSourceNode[],
    active: readonly RichTextJsonMark[],
    depth: number,
  ): RichTextJsonNode[] {
    const result: RichTextJsonNode[] = [];
    for (const node of nodes) {
      this.visit(depth);
      if (node.type === 'text') {
        // A line break of the source is collapsible spacing; kept, the editor would turn it into
        // a visible break as soon as the text around it changed.
        const value = this.#options.collapse
          ? (node.text ?? '').replace(SOURCE_BREAK, ' ')
          : node.text;
        if (value)
          result.push({
            type: 'text',
            text: value,
            ...(active.length ? { marks: [...active] } : {}),
          });
        continue;
      }
      const tag = node.tag ?? '';
      if (node.type !== 'element' || !this.rules.isInline(tag))
        throw new Error('RICH_TEXT_UNSUPPORTED');
      if (tag === 'br') {
        result.push({
          type: 'hardBreak',
          ...(node.origin ? { attrs: this.origin(node) } : {}),
          ...(active.length ? { marks: [...active] } : {}),
        });
        continue;
      }
      const canonical = marks[this.rules.canonicalTag(tag)];
      if (!canonical) throw new Error('RICH_TEXT_UNSUPPORTED');
      const type =
        canonical === 'preservedSpan' && this.wraps(node) ? RICH_TEXT_OUTER_SPAN : canonical;
      this.nest(active, type);
      const attrs = this.origin(node);
      if (type === 'link') {
        const href = node.attributes?.href;
        if (!href) throw new Error('RICH_TEXT_UNSUPPORTED');
        Object.assign(attrs, {
          href,
          target: node.attributes?.target ?? null,
          rel: node.attributes?.rel ?? null,
        });
      } else if (canonical === 'preservedSpan' && !node.origin)
        throw new Error('RICH_TEXT_UNSUPPORTED');
      result.push(...this.inline(node.children ?? [], [...active, { type, attrs }], depth + 1));
    }
    return result;
  }

  /** Inline content of one block, with collapsible edge spacing and a final break set aside. */
  private textblock(
    nodes: readonly RichTextSourceNode[],
    depth: number,
  ): { content: RichTextJsonNode[]; edge?: RichTextEdge } {
    const run = [...nodes];
    let lead = '';
    let tail = '';
    let br = false;
    const first = run[0];
    if (this.#options.collapse && first?.type === 'text') {
      const text = first.text ?? '';
      const kept = text.replace(LEADING, '');
      lead = text.slice(0, text.length - kept.length);
      if (kept) run[0] = { type: 'text', text: kept };
      else run.shift();
    }
    const end = run.at(-1);
    if (this.#options.collapse && end?.type === 'text') {
      const text = end.text ?? '';
      const kept = text.replace(TRAILING, '');
      tail = text.slice(kept.length);
      if (kept) run[run.length - 1] = { type: 'text', text: kept };
      else run.pop();
    }
    const last = run.at(-1);
    // The editor draws its own trailing break after a final one, which would add a line.
    if (last?.type === 'element' && last.tag === 'br' && !last.origin && run.length > 1) {
      run.pop();
      br = true;
    }
    const content = this.inline(run, [], depth);
    return { content, ...(lead || tail || br ? { edge: { lead, tail, br } } : {}) };
  }

  private paragraph(nodes: readonly RichTextSourceNode[], depth: number): RichTextJsonNode {
    const text = this.textblock(nodes, depth);
    return {
      type: 'paragraph',
      attrs: {
        [RICH_TEXT_IMPLICIT_ATTRIBUTE]: true,
        ...(text.edge ? { [RICH_TEXT_EDGE_ATTRIBUTE]: text.edge } : {}),
      },
      ...(text.content.length ? { content: text.content } : {}),
    };
  }

  private blocks(
    nodes: readonly RichTextSourceNode[],
    depth: number,
    root: boolean,
  ): RichTextJsonNode[] {
    const result: RichTextJsonNode[] = [];
    const hasBlocks = nodes.some(
      (node) => node.type === 'element' && this.rules.isBlock(node.tag ?? ''),
    );
    let run: RichTextSourceNode[] = [];
    const flush = (): void => {
      const visible = run.some((node) => node.type !== 'text' || !!node.text?.trim());
      // Loose text stays loose; spacing between blocks is not content.
      if (visible || (!hasBlocks && root)) result.push(this.paragraph(run, depth));
      run = [];
    };
    for (const node of nodes) {
      if (node.type === 'element' && this.rules.isBlock(node.tag ?? '')) {
        if (run.length) flush();
        this.visit(depth);
        result.push(this.block(node, depth));
      } else run.push(node);
    }
    if (run.length || !result.length) flush();
    return result;
  }

  private block(node: RichTextSourceNode, depth: number): RichTextJsonNode {
    const tag = node.tag ?? '';
    const attrs = this.origin(node);
    const children = node.children ?? [];
    const described = (
      type: string,
      extra: Record<string, unknown>,
      content?: RichTextJsonNode[],
    ): RichTextJsonNode => {
      const merged = { ...attrs, ...extra };
      return {
        type,
        ...(Object.keys(merged).length ? { attrs: merged } : {}),
        ...(content?.length ? { content } : {}),
      };
    };
    const heading = /^h([1-6])$/.exec(tag);
    if (tag === 'p' || heading) {
      const text = this.textblock(children, depth + 1);
      return described(
        heading ? 'heading' : 'paragraph',
        {
          ...(heading ? { level: Number(heading[1]) } : {}),
          ...(text.edge ? { [RICH_TEXT_EDGE_ATTRIBUTE]: text.edge } : {}),
        },
        text.content,
      );
    }
    if (tag === 'hr') return described('horizontalRule', {});
    if (tag === 'pre') {
      // A code block holds plain text only: marked-up source is not rewritten in place.
      if (children.some((entry) => entry.type !== 'text')) throw new Error('RICH_TEXT_UNFAITHFUL');
      const value = children.map((entry) => entry.text ?? '').join('');
      return described('codeBlock', {}, value ? [{ type: 'text', text: value }] : []);
    }
    if (tag === 'blockquote') {
      const content = this.blocks(children, depth + 1, false);
      return described('blockquote', {}, content.length ? content : [this.paragraph([], depth)]);
    }
    if (tag === 'li') return this.item(node, depth);
    if (tag === 'ul' || tag === 'ol') {
      const items: RichTextJsonNode[] = [];
      for (const child of children) {
        if (child.type === 'text' && !child.text?.trim()) continue;
        if (child.type !== 'element' || child.tag !== 'li')
          throw new Error('RICH_TEXT_UNSUPPORTED');
        this.visit(depth + 1);
        items.push(this.item(child, depth + 1));
      }
      if (!items.length) throw new Error('RICH_TEXT_UNSUPPORTED');
      const start = Number(node.attributes?.start);
      return described(
        tag === 'ul' ? 'bulletList' : 'orderedList',
        tag === 'ol' && Number.isInteger(start) ? { start } : {},
        items,
      );
    }
    throw new Error('RICH_TEXT_UNSUPPORTED');
  }

  private item(node: RichTextSourceNode, depth: number): RichTextJsonNode {
    const content = this.blocks(node.children ?? [], depth + 1, false);
    // A list item starts with a paragraph in the schema, even when its source starts a list.
    if (content[0]?.type !== 'paragraph') content.unshift(this.paragraph([], depth));
    const attrs = this.origin(node);
    return { type: 'listItem', ...(Object.keys(attrs).length ? { attrs } : {}), content };
  }
}
