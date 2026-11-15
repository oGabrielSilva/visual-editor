export type HtmlNodeType = 'element' | 'text' | 'comment' | 'doctype';

export interface HtmlContentNode {
  readonly type: HtmlNodeType;
  readonly tag?: string;
  readonly value?: string;
}

/** Structural constraints prevent HTML parsers from silently relocating or dropping nodes. */
export class HtmlContentModel {
  private readonly requiredParents: Readonly<Record<string, readonly string[]>> = {
    html: ['#document'],
    head: ['html'],
    body: ['html'],
    td: ['tr'],
    th: ['tr'],
    tr: ['thead', 'tbody', 'tfoot'],
    thead: ['table'],
    tbody: ['table'],
    tfoot: ['table'],
    caption: ['table'],
    colgroup: ['table'],
    col: ['colgroup'],
    li: ['ul', 'ol', 'menu'],
    dt: ['dl'],
    dd: ['dl'],
    option: ['select', 'optgroup', 'datalist'],
    optgroup: ['select'],
    legend: ['fieldset'],
    summary: ['details'],
    area: ['map'],
  };

  private readonly structuralChildren: Readonly<Record<string, readonly string[]>> = {
    html: ['head', 'body'],
    head: ['base', 'link', 'meta', 'style', 'title', 'noscript', 'template'],
    table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot'],
    colgroup: ['col'],
    thead: ['tr'],
    tbody: ['tr'],
    tfoot: ['tr'],
    tr: ['td', 'th'],
    ul: ['li'],
    ol: ['li'],
    menu: ['li'],
    dl: ['dt', 'dd'],
    select: ['option', 'optgroup'],
    optgroup: ['option'],
  };

  /** Parents the HTML parser itself guarantees; anything else it accepts where it was written. */
  private readonly parserParents: Readonly<Record<string, readonly string[]>> = {
    html: ['#document'],
    head: ['html'],
    body: ['html'],
    frameset: ['html', 'frameset'],
    td: ['tr'],
    th: ['tr'],
    tr: ['thead', 'tbody', 'tfoot'],
    thead: ['table'],
    tbody: ['table'],
    tfoot: ['table'],
    caption: ['table'],
    colgroup: ['table'],
    col: ['colgroup'],
  };

  /** Children the parser leaves inside these parents instead of moving them elsewhere. */
  private readonly parserChildren: Readonly<Record<string, readonly string[]>> = {
    html: ['head', 'body', 'frameset', 'noframes'],
    head: [
      'base',
      'basefont',
      'bgsound',
      'link',
      'meta',
      'style',
      'title',
      'noscript',
      'noframes',
      'template',
      'script',
    ],
    table: [
      'caption',
      'colgroup',
      'thead',
      'tbody',
      'tfoot',
      'script',
      'style',
      'template',
      'input',
      'form',
    ],
    colgroup: ['col', 'template'],
    thead: ['tr', 'script', 'style', 'template'],
    tbody: ['tr', 'script', 'style', 'template'],
    tfoot: ['tr', 'script', 'style', 'template'],
    tr: ['td', 'th', 'script', 'style', 'template'],
  };

  /** HTML elements whose content the tokenizer reads as text, never as markup. */
  private readonly rawText: ReadonlySet<string> = new Set([
    'script',
    'style',
    'xmp',
    'iframe',
    'noembed',
    'noframes',
    'plaintext',
    'noscript',
  ]);

  /**
   * Whether a tree an HTML parser produced may hold this child. It is the integrity rule of
   * a stored document: looser than `accepts`, which governs what editing commands may build.
   */
  parses(parentTag: string | undefined, child: HtmlContentNode): boolean {
    const parent = parentTag?.toLowerCase() ?? '#document';
    if (child.type === 'doctype') return parent === '#document';
    const tag = child.tag?.toLowerCase() ?? '';
    const required = this.parserParents[tag];
    if (required && !required.includes(parent)) return false;
    const expected = this.parserChildren[parent];
    if (!expected) return true;
    return (
      child.type === 'comment' ||
      (child.type === 'text' && !child.value?.trim()) ||
      (child.type === 'element' && expected.includes(tag))
    );
  }

  /**
   * Elements whose single text child is their source, written back verbatim: the raw text
   * elements of HTML, `template`, and whole inline `svg` / `math` islands.
   */
  holdsSource(tag: string): boolean {
    const name = tag.toLowerCase();
    return this.rawText.has(name) || this.isSourceIsland(name);
  }

  /** Markup kept as an opaque block of source rather than as a subtree. */
  isSourceIsland(tag: string): boolean {
    return ['template', 'svg', 'math'].includes(tag.toLowerCase());
  }

  accepts(parentTag: string | undefined, child: HtmlContentNode): boolean {
    const parent = parentTag?.toLowerCase() ?? '#document';
    if (child.type === 'doctype') return parent === '#document';
    const tag = child.tag?.toLowerCase() ?? '';
    const required = this.requiredParents[tag];
    if (required && !required.includes(parent)) return false;
    const expected = this.structuralChildren[parent];
    if (!expected) return true;
    return (
      child.type === 'comment' ||
      (child.type === 'text' && !child.value?.trim()) ||
      (child.type === 'element' && expected.includes(tag))
    );
  }

  acceptsChildren(parentTag: string, children: readonly HtmlContentNode[]): boolean {
    return children.every((child) => this.accepts(parentTag, child));
  }

  isStructuralContainer(tag: string): boolean {
    return Boolean(this.structuralChildren[tag.toLowerCase()]);
  }
}
