const inline = new Set([
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'a',
  'br',
  'small',
  'sup',
  'sub',
  'code',
]);
const blocks = new Set([
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
]);
const canonical: Readonly<Record<string, string>> = { b: 'strong', i: 'em', small: 'span' };

/**
 * Which source markup the rich-text projection understands and when an element must carry its
 * origin, so the host projection and the editor inside the preview frame agree on one answer.
 */
export class RichTextProjectionRules {
  isInline(tag: string): boolean {
    return inline.has(tag);
  }

  isBlock(tag: string): boolean {
    return blocks.has(tag);
  }

  supports(tag: string): boolean {
    return inline.has(tag) || blocks.has(tag);
  }

  canonicalTag(tag: string): string {
    return canonical[tag] ?? tag;
  }

  semanticAttributes(tag: string): readonly string[] {
    const name = this.canonicalTag(tag);
    return name === 'a' ? ['href', 'target', 'rel', 'title'] : name === 'ol' ? ['start'] : [];
  }

  /** The element keeps attributes or a tag which only its source node can restore. */
  needsOrigin(tag: string, attributeNames: readonly string[]): boolean {
    const allowed = this.semanticAttributes(tag);
    return (
      ['span', 'small', 'a'].includes(tag) ||
      attributeNames.some((name) => !allowed.includes(name)) ||
      this.canonicalTag(tag) !== tag
    );
  }
}
