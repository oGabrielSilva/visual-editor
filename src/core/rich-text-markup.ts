import type { DocumentNode } from './document';

/**
 * `block`: paragraphs, lists, headings and quotes (the HTML document and the text and footer
 * blocks). `inline`: one line of formatted text with links (heading block). `button`: formatted
 * text without links, since the button is the link.
 */
export type RichTextMode = 'block' | 'inline' | 'button';

const INLINE_TAGS = ['span', 'strong', 'b', 'em', 'i', 'u', 's', 'br', 'sup', 'sub', 'code'];
const MODE_TAGS: Readonly<Record<RichTextMode, ReadonlySet<string>>> = Object.freeze({
  button: new Set(INLINE_TAGS),
  inline: new Set([...INLINE_TAGS, 'a']),
  block: new Set([
    ...INLINE_TAGS,
    'a',
    'p',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'pre',
    'hr',
  ]),
});

export type RichTextMarkupViolation = 'tag' | 'attribute' | 'style' | 'node';

export interface RichTextMarkupCheck {
  /** Attributes the caller adds to every element, e.g. the origin marks of schema 1. */
  readonly extraAttributes?: readonly string[];
  /** Whether a `style` attribute holds only the declarations a rich text may carry. */
  style(value: string): boolean;
  /** A further rule for one element; false makes the tree invalid. */
  element?(node: DocumentNode): boolean;
}

/**
 * The single rule of the markup a rich-text projection may hold once it is imported: which
 * elements each mode accepts and which attributes each element keeps. The in-place editing of
 * the HTML document (schema 1) and the texts of the block pieces (schema 2) both apply it.
 */
export class RichTextMarkup {
  tags(mode: RichTextMode): ReadonlySet<string> {
    return MODE_TAGS[mode];
  }

  /** The attributes an element of the projection keeps besides `style`. */
  semanticAttributes(tag: string): readonly string[] {
    return tag === 'a' ? ['href', 'target', 'rel', 'title'] : tag === 'ol' ? ['start'] : [];
  }

  /** The first rule the tree breaks, or undefined when all of it follows the mode. */
  violation(
    nodes: readonly DocumentNode[],
    mode: RichTextMode,
    check: RichTextMarkupCheck,
  ): RichTextMarkupViolation | undefined {
    const tags = this.tags(mode);
    const stack = [...nodes];
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      if (node.type === 'text') continue;
      if (node.type !== 'element' || !tags.has(node.tag ?? '')) return 'tag';
      const allowed = [
        'style',
        ...(check.extraAttributes ?? []),
        ...this.semanticAttributes(node.tag ?? ''),
      ];
      for (const [name, value] of Object.entries(node.attrs ?? {})) {
        if (!allowed.includes(name)) return 'attribute';
        if (name === 'style' && !check.style(value)) return 'style';
      }
      if (check.element && !check.element(node)) return 'node';
      stack.push(...(node.children ?? []));
    }
    return undefined;
  }
}
