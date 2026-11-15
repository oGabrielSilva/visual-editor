import * as cssTree from 'css-tree';
import { DOCUMENT_LIMITS } from '../core/document';
import type { RichTextDecorationLine } from '../core/rich-text-format';
import { DocumentBudget } from '../core/budget';
import type { Diagnostic } from '../core/document';
import { UrlPolicy } from '../security/url-policy';
import { TEXT_FONT_FAMILIES, TEXT_STYLE_LIMITS } from '../security/text-presentation';

export interface CssInspection {
  readonly diagnostics: readonly Diagnostic[];
  readonly declarations: Readonly<Record<string, string>>;
  readonly urls: readonly string[];
  readonly urlCandidates: readonly string[];
}

/** What an author's CSS holds. Nothing here refuses a document; the host decides. */
export interface CssSurvey {
  /** Targets of `@import`, as written. */
  readonly imports: readonly string[];
  readonly fontFaces: number;
  /** Every `url()` and string source the stylesheet refers to. */
  readonly urls: readonly string[];
  /** `expression()`, `behavior`, `-moz-binding` and URLs which would run code. */
  readonly active: number;
}

/** Functions whose string argument is the address of what they load. */
const URL_FUNCTIONS: readonly string[] = ['image-set', '-webkit-image-set', 'src'];

interface InlinePiece {
  readonly text: string;
  readonly declaration: boolean;
}

/** Parse CSS rather than matching dangerous strings in the original stylesheet. */
export class CssDocumentCodec {
  readonly #urls: UrlPolicy;

  constructor(urls = new UrlPolicy()) {
    this.#urls = urls;
  }

  validate(
    css: string,
    context: 'stylesheet' | 'declarationList' = 'stylesheet',
  ): readonly Diagnostic[] {
    return this.inspect(css, context).diagnostics;
  }

  inspect(css: string, context: 'stylesheet' | 'declarationList' = 'stylesheet'): CssInspection {
    const diagnostics: Diagnostic[] = [];
    const declarations: Record<string, string> = Object.create(null) as Record<string, string>;
    const urls: string[] = [];
    const urlCandidates: string[] = [];
    if (new DocumentBudget().byteLength(css) > DOCUMENT_LIMITS.cssBytes)
      return { diagnostics: [this.error('CSS_TOO_LARGE')], declarations, urls, urlCandidates };
    if (!css.trim()) return { diagnostics, declarations, urls, urlCandidates };
    // CSS is emitted inside a style element. Even a CSS comment can close that boundary.
    if (css.toLowerCase().includes('</style') || css.includes('<!--') || css.includes('-->'))
      diagnostics.push(this.error('CSS_HTML_BOUNDARY'));
    try {
      const ast = cssTree.parse(css, {
        context,
        positions: true,
        parseCustomProperty: true,
        onParseError: () => {
          diagnostics.push(this.error('INVALID_CSS'));
        },
      });
      const functions: string[] = [];
      let customProperty = false;
      let count = 0;
      cssTree.walk(ast, {
        enter: (node: cssTree.CssNode) => {
          if (++count > DOCUMENT_LIMITS.nodes * 10) throw new RangeError('CSS_TOO_COMPLEX');
          if (node.type === 'Raw') diagnostics.push(this.error('UNPARSED_CSS'));
          if (node.type === 'Atrule') {
            const name = cssTree.ident.decode(node.name).toLowerCase();
            if (['import', 'charset', 'document', '-moz-document'].includes(name))
              diagnostics.push(this.error('FORBIDDEN_CSS_RULE'));
          }
          if (node.type === 'Declaration') {
            const name = cssTree.ident.decode(node.property).toLowerCase();
            customProperty = name.startsWith('--');
            if (['behavior', '-moz-binding'].includes(name))
              diagnostics.push(this.error('FORBIDDEN_CSS_PROPERTY'));
            declarations[name] = cssTree.generate(node.value);
          }
          if (node.type === 'String' && customProperty) urlCandidates.push(node.value);
          if (node.type === 'Function') {
            const name = cssTree.ident.decode(node.name).toLowerCase();
            functions.push(name);
            if (['expression', '-moz-binding'].includes(name))
              diagnostics.push(this.error('FORBIDDEN_CSS_FUNCTION'));
          }
          if (
            node.type === 'Url' ||
            (node.type === 'String' &&
              functions.some((name) => ['image-set', '-webkit-image-set', 'src'].includes(name)))
          ) {
            urls.push(node.value);
            if (!this.#urls.isSafe(node.value, 'image'))
              diagnostics.push(this.error('UNSAFE_CSS_URL'));
          }
        },
        leave: (node: cssTree.CssNode) => {
          if (node.type === 'Function') functions.pop();
          if (node.type === 'Declaration') customProperty = false;
        },
      });
    } catch {
      diagnostics.push(this.error('INVALID_CSS'));
    }
    return {
      diagnostics: this.unique(diagnostics),
      declarations,
      urls: [...new Set(urls)],
      urlCandidates: [...new Set(urlCandidates)],
    };
  }

  /** The only refusals left for the CSS of a document: its size and the element it lives in. */
  documentDiagnostics(css: string): readonly Diagnostic[] {
    if (new DocumentBudget().byteLength(css) > DOCUMENT_LIMITS.cssBytes)
      return [this.error('CSS_TOO_LARGE')];
    // The stylesheet is written inside a style element, which this sequence would close.
    return css.toLowerCase().includes('</style') ? [this.error('CSS_HTML_BOUNDARY')] : [];
  }

  /**
   * Tolerant inventory of imported CSS: hacks, vendor filters and parse errors are kept as
   * written. It never validates; `inspect` stays the strict gate of what the editor writes.
   */
  survey(css: string, context: 'stylesheet' | 'declarationList' = 'stylesheet'): CssSurvey {
    const imports: string[] = [];
    const urls: string[] = [];
    let fontFaces = 0;
    let active = 0;
    if (!css.trim()) return { imports, urls, fontFaces, active };
    try {
      const ast = cssTree.parse(css, { context, parseCustomProperty: true });
      let count = 0;
      let importing = false;
      cssTree.walk(ast, {
        enter: (node: cssTree.CssNode) => {
          if (++count > DOCUMENT_LIMITS.nodes * 10) throw new RangeError('CSS_TOO_COMPLEX');
          if (node.type === 'Atrule') {
            const name = cssTree.ident.decode(node.name).toLowerCase();
            importing = name === 'import';
            if (name === 'font-face') fontFaces++;
          }
          if (node.type === 'Declaration') {
            const name = cssTree.ident.decode(node.property).toLowerCase();
            if (['behavior', '-moz-binding'].includes(name)) active++;
          }
          if (
            node.type === 'Function' &&
            ['expression', '-moz-binding'].includes(cssTree.ident.decode(node.name).toLowerCase())
          )
            active++;
          // A value the grammar could not read is kept as text; only its intent is noted.
          if (node.type === 'Raw' && this.activeRaw(node.value)) active++;
          if (node.type === 'Url' || (importing && node.type === 'String')) {
            if (importing) imports.push(node.value);
            urls.push(node.value);
            if (this.#urls.isActive(node.value)) active++;
          }
        },
        leave: (node: cssTree.CssNode) => {
          if (node.type === 'Atrule') importing = false;
        },
      });
    } catch {
      // An unreadable stylesheet is still the author's; what was read so far is reported.
    }
    return { imports: [...new Set(imports)], urls: [...new Set(urls)], fontFaces, active };
  }

  /**
   * Removes from imported CSS what `survey` counts as active: a declaration which holds
   * `expression()`, a binding, a behavior file or a code URL, and an `@import` of a code URL.
   * Everything else keeps its bytes: the cut is made by the positions of the parser. The built-in
   * behaviors of Outlook (`behavior:url(#default#VML)`) load nothing and stay: without them the
   * VML of an e-mail does not draw.
   */
  stripActive(
    css: string,
    context: 'stylesheet' | 'declarationList' = 'stylesheet',
  ): { readonly css: string; readonly removed: number } {
    const cuts = this.activeSpans(css, context);
    if (!cuts?.length) return { css, removed: 0 };
    let output = '';
    let cursor = 0;
    let removed = 0;
    for (const cut of [...cuts].sort((left, right) => left.start - right.start)) {
      if (cut.start < cursor) continue;
      output += css.slice(cursor, cut.start);
      cursor = cut.end;
      // The separator of a removed declaration leaves with it.
      let next = cursor;
      while (next < css.length && ' \t\n\r\f'.includes(css[next] ?? '')) next++;
      if (css[next] === ';') cursor = next + 1;
      removed++;
    }
    output += css.slice(cursor);
    // What is written is read again: text which still holds any of it is not kept at all.
    return this.activeSpans(output, context)?.length === 0
      ? { css: output, removed }
      : { css: '', removed: removed + 1 };
  }

  /** Source spans of the declarations and imports to remove; undefined when unreadable. */
  private activeSpans(
    css: string,
    context: 'stylesheet' | 'declarationList',
  ): readonly { readonly start: number; readonly end: number }[] | undefined {
    if (!css.trim()) return [];
    const spans = new Map<cssTree.CssNode, { start: number; end: number }>();
    try {
      const ast = cssTree.parse(css, { context, parseCustomProperty: true, positions: true });
      const units: cssTree.CssNode[] = [];
      const functions: string[] = [];
      let count = 0;
      const mark = (node: cssTree.CssNode): void => {
        const unit = units.at(-1) ?? node;
        if (unit.loc) spans.set(unit, { start: unit.loc.start.offset, end: unit.loc.end.offset });
      };
      cssTree.walk(ast, {
        enter: (node: cssTree.CssNode) => {
          if (++count > DOCUMENT_LIMITS.nodes * 10) throw new RangeError('CSS_TOO_COMPLEX');
          const importing =
            node.type === 'Atrule' && cssTree.ident.decode(node.name).toLowerCase() === 'import';
          if (node.type === 'Declaration' || importing) units.push(node);
          const unit = units.at(-1);
          if (node.type === 'Declaration') {
            const name = cssTree.ident.decode(node.property).toLowerCase();
            if (name === '-moz-binding') mark(node);
            if (name === 'behavior' && !this.builtInBehavior(node)) mark(node);
          }
          if (
            node.type === 'Function' &&
            ['expression', '-moz-binding'].includes(cssTree.ident.decode(node.name).toLowerCase())
          )
            mark(node);
          if (node.type === 'Raw' && this.activeRaw(node.value)) mark(node);
          // A string is an address in an import and inside the functions which load an image.
          if (node.type === 'Function')
            functions.push(cssTree.ident.decode(node.name).toLowerCase());
          if (
            (node.type === 'Url' ||
              (node.type === 'String' &&
                (unit?.type === 'Atrule' ||
                  functions.some((name) => URL_FUNCTIONS.includes(name))))) &&
            this.#urls.isActive(node.value)
          )
            mark(node);
        },
        leave: (node: cssTree.CssNode) => {
          if (node.type === 'Function') functions.pop();
          if (units.at(-1) === node) units.pop();
        },
      });
    } catch {
      return undefined;
    }
    return [...spans.values()];
  }

  /**
   * A value the grammar could not read is kept as text. Whether it means code is judged over
   * that text with its escapes resolved and its white space removed, as an engine would join it.
   */
  private activeRaw(value: string): boolean {
    let text: string;
    try {
      text = cssTree.ident.decode(value);
    } catch {
      text = value;
    }
    const flat = [...text.toLowerCase()].filter((character) => character > ' ').join('');
    return [
      'expression(',
      '-moz-binding',
      'javascript:',
      'vbscript:',
      'livescript:',
      'data:text/html',
      'data:application/xhtml+xml',
    ].some((marker) => flat.includes(marker));
  }

  /** `behavior:url(#default#VML)`: a behavior of the program itself, not a file it would load. */
  private builtInBehavior(declaration: cssTree.Declaration): boolean {
    let builtIn = true;
    let urls = 0;
    cssTree.walk(declaration, (node: cssTree.CssNode) => {
      if (node.type !== 'Url') return;
      urls++;
      if (!node.value.trim().toLowerCase().startsWith('#default#')) builtIn = false;
    });
    return builtIn && urls > 0;
  }

  readDeclarations(css: string): Readonly<Record<string, string>> {
    const result = this.inspect(css, 'declarationList');
    if (result.diagnostics.length) throw new Error('INVALID_INLINE_STYLE');
    const ast = cssTree.parse(css, { context: 'declarationList', parseCustomProperty: true });
    if (ast.type !== 'DeclarationList') throw new Error('INVALID_INLINE_STYLE');
    const declarations: Record<string, string> = {};
    const priority = new Set<string>();
    ast.children.forEach((node) => {
      if (node.type !== 'Declaration') return;
      const property = cssTree.ident.decode(node.property).toLowerCase();
      if (priority.has(property) && !node.important) return;
      declarations[property] = cssTree.generate(node.value);
      if (node.important) priority.add(property);
    });
    return declarations;
  }

  /** Only semantic text declarations may enter the authenticated editing DOM. */
  richTextStyles(css: string): Readonly<Record<string, string>> | undefined {
    const inspected = this.inspect(css, 'declarationList');
    if (inspected.diagnostics.length || inspected.urls.length || inspected.urlCandidates.length)
      return undefined;
    try {
      const ast = cssTree.parse(css, { context: 'declarationList', parseCustomProperty: true });
      if (ast.type !== 'DeclarationList') return undefined;
      const allowed = new Set([
        'color',
        'background-color',
        'font-family',
        'font-size',
        'line-height',
      ]);
      const result: Record<string, string> = {};
      let invalid = false;
      ast.children.forEach((node) => {
        if (node.type !== 'Declaration') {
          invalid = true;
          return;
        }
        const name = cssTree.ident.decode(node.property).toLowerCase();
        if (
          !allowed.has(name) ||
          node.important ||
          !cssTree.lexer.matchProperty(name, node.value).matched
        ) {
          invalid = true;
          return;
        }
        cssTree.walk(node.value, (value) => {
          if (value.type === 'Url' || value.type === 'Raw') invalid = true;
          if (
            value.type === 'Function' &&
            ![
              'rgb',
              'rgba',
              'hsl',
              'hsla',
              'hwb',
              'lab',
              'lch',
              'oklab',
              'oklch',
              'color',
            ].includes(cssTree.ident.decode(value.name).toLowerCase())
          )
            invalid = true;
        });
        const serialized = cssTree.generate(node.value);
        if (name === 'font-size' || name === 'line-height') {
          const numeric = /^([0-9]+(?:\.[0-9]+)?)(px|pt)?$/.exec(serialized);
          const amount = Number(numeric?.[1]);
          const pixels = numeric?.[2] === 'pt' ? (amount * 4) / 3 : amount;
          if (
            !numeric ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            (name === 'font-size' && (!numeric[2] || pixels > TEXT_STYLE_LIMITS.fontSizePx)) ||
            (name === 'line-height' &&
              (numeric[2]
                ? pixels > TEXT_STYLE_LIMITS.lineHeightPx
                : amount > TEXT_STYLE_LIMITS.lineHeightRatio))
          )
            invalid = true;
        }
        if (name === 'font-family') {
          const families: string[] = [];
          let parts: string[] = [];
          cssTree.walk(node.value, (value) => {
            if (value.type === 'String') parts.push(value.value);
            else if (value.type === 'Identifier') parts.push(cssTree.ident.decode(value.name));
            else if (value.type === 'Operator' && value.value === ',') {
              families.push(parts.join(' '));
              parts = [];
            }
          });
          families.push(parts.join(' '));
          const permitted = new Set<string>(TEXT_FONT_FAMILIES.map((font) => font.toLowerCase()));
          if (families.some((font) => !permitted.has(font.toLowerCase()))) invalid = true;
        }
        result[name] = serialized;
      });
      return invalid ? undefined : result;
    } catch {
      return undefined;
    }
  }

  /** Conservative stylesheet check; cascade applicability is deliberately not inferred. */
  hasDecorationRules(css: string): boolean {
    const inspected = this.inspect(css, 'stylesheet');
    // Imported stylesheets may hold hacks this parser cannot vouch for: assume a rule exists.
    if (inspected.diagnostics.length) return true;
    return (
      Object.hasOwn(inspected.declarations, 'text-decoration') ||
      Object.hasOwn(inspected.declarations, 'text-decoration-line')
    );
  }

  /** Removes one line while keeping an independent strike/underline and its color/style. */
  removeDecoration(css: string, line: RichTextDecorationLine): string {
    if (this.validate(css, 'declarationList').length) throw new Error('INVALID_STYLE_DECLARATION');
    const ast = cssTree.parse(css, { context: 'declarationList', parseCustomProperty: true });
    if (ast.type !== 'DeclarationList') throw new Error('INVALID_STYLE_DECLARATION');
    let lines: string[] = [];
    let important = false;
    ast.children.forEach((node) => {
      if (node.type !== 'Declaration') return;
      const name = cssTree.ident.decode(node.property).toLowerCase();
      if (
        !['text-decoration', 'text-decoration-line'].includes(name) ||
        (important && !node.important)
      )
        return;
      const identifiers: string[] = [];
      let unresolved = false;
      cssTree.walk(node.value, (value) => {
        if (value.type === 'Identifier')
          identifiers.push(cssTree.ident.decode(value.name).toLowerCase());
        if (
          value.type === 'Function' &&
          ['var', 'env', 'attr'].includes(cssTree.ident.decode(value.name).toLowerCase())
        )
          unresolved = true;
      });
      if (
        unresolved ||
        identifiers.some((value) => ['inherit', 'unset', 'revert', 'revert-layer'].includes(value))
      )
        throw new Error('UNRESOLVED_TEXT_DECORATION');
      lines = identifiers.filter((value) =>
        ['underline', 'overline', 'line-through'].includes(value),
      );
      important = !!node.important;
    });
    if (!lines.includes(line)) return css;
    const remaining = [...new Set(lines.filter((value) => value !== line))];
    return this.setDeclaration(
      css,
      'text-decoration-line',
      (remaining.join(' ') || 'none') + (important ? '!important' : ''),
    );
  }

  /**
   * Catalog defaults go before the author's rules, which keep precedence, yet after any
   * leading `@charset` / `@import`, which only count at the top. The existing CSS is the
   * author's and is kept as written, hacks included; only the incoming CSS is validated.
   */
  prependDefaults(existing: string, incoming: readonly string[]): string {
    if (this.documentDiagnostics(existing).length) throw new Error('INVALID_CSS');
    const keys = new Set<string>();
    let preamble = 0;
    try {
      const current = cssTree.parse(existing, { parseCustomProperty: true, positions: true });
      if (current.type !== 'StyleSheet') throw new Error('INVALID_CSS');
      let leading = true;
      current.children.forEach((node) => {
        keys.add(cssTree.generate(node));
        if (
          leading &&
          node.type === 'Atrule' &&
          ['charset', 'import'].includes(cssTree.ident.decode(node.name).toLowerCase()) &&
          node.loc
        )
          preamble = node.loc.end.offset;
        else leading = false;
      });
    } catch {
      keys.clear();
      preamble = 0;
    }
    const additions: string[] = [];
    for (const css of incoming) {
      if (this.validate(css).length) throw new Error('INVALID_CSS');
      const stylesheet = cssTree.parse(css, { parseCustomProperty: true });
      if (stylesheet.type !== 'StyleSheet') throw new Error('INVALID_CSS');
      stylesheet.children.forEach((node) => {
        const key = cssTree.generate(node);
        if (!keys.has(key)) {
          keys.add(key);
          additions.push(key);
        }
      });
    }
    if (!additions.length) return existing;
    const result = [existing.slice(0, preamble), ...additions, existing.slice(preamble)]
      .filter(Boolean)
      .join('\n');
    if (this.documentDiagnostics(result).length) throw new Error('INVALID_CSS');
    return result;
  }

  removeDeclarations(css: string, properties: readonly string[]): string {
    if (this.validate(css, 'declarationList').length) throw new Error('INVALID_STYLE_DECLARATION');
    const names = new Set(properties.map((name) => name.toLowerCase()));
    const output = this.join(this.remaining(css, names).pieces);
    const result = this.inspect(output, 'declarationList');
    // The rebuilt text is parsed again: an unterminated comment may not hide what it claims.
    if (result.diagnostics.length || [...names].some((name) => name in result.declarations))
      throw new Error('INVALID_STYLE_DECLARATION');
    return output;
  }

  /** Replaces every declaration of the property and keeps the priority the author gave it. */
  setDeclaration(css: string, property: string, value: string): string {
    if (this.validate(css, 'declarationList').length) throw new Error('INVALID_STYLE_DECLARATION');
    const name = cssTree.ident.decode(property).toLowerCase();
    const candidate = `${name}:${value}`;
    const inspected = this.inspect(candidate, 'declarationList');
    if (
      inspected.diagnostics.length ||
      Object.keys(inspected.declarations).length !== 1 ||
      !(name in inspected.declarations)
    ) {
      throw new Error('INVALID_STYLE_DECLARATION');
    }
    const declaration = cssTree.parse(candidate, { context: 'declaration' });
    if (declaration.type !== 'Declaration') throw new Error('INVALID_STYLE_DECLARATION');
    const { pieces, important } = this.remaining(css, new Set([name]));
    if (important) declaration.important = true;
    const output = this.join([
      ...pieces,
      { text: cssTree.generate(declaration), declaration: true },
    ]);
    const result = this.inspect(output, 'declarationList');
    // The new declaration must be what a parser reads back, not text lost inside a comment.
    if (result.diagnostics.length || result.declarations[name] !== inspected.declarations[name])
      throw new Error('INVALID_STYLE_DECLARATION');
    return output;
  }

  /** Untouched declarations and comments keep their source text; empty separators are dropped. */
  private remaining(
    css: string,
    removed: ReadonlySet<string>,
  ): { pieces: readonly InlinePiece[]; important: boolean } {
    const comments: { start: number; end: number }[] = [];
    const ast = cssTree.parse(css, {
      context: 'declarationList',
      parseCustomProperty: true,
      positions: true,
      onComment: (_value: string, location: cssTree.CssLocation) => {
        comments.push({ start: location.start.offset, end: location.end.offset });
      },
    });
    if (ast.type !== 'DeclarationList') throw new Error('INVALID_STYLE_DECLARATION');
    const located: (InlinePiece & { start: number; end: number; kept: boolean })[] = [];
    let important = false;
    ast.children.forEach((node) => {
      if (node.type !== 'Declaration' || !node.loc) throw new Error('INVALID_STYLE_DECLARATION');
      const start = node.loc.start.offset;
      const end = node.loc.end.offset;
      const kept = !removed.has(cssTree.ident.decode(node.property).toLowerCase());
      if (!kept && node.important) important = true;
      located.push({ start, end, kept, declaration: true, text: css.slice(start, end).trim() });
    });
    for (const comment of comments) {
      // A comment inside a declaration already travels (or leaves) with that declaration.
      if (located.some((piece) => comment.start >= piece.start && comment.end <= piece.end))
        continue;
      located.push({
        ...comment,
        kept: true,
        declaration: false,
        text: css.slice(comment.start, comment.end),
      });
    }
    return {
      important,
      pieces: located
        .filter((piece) => piece.kept && piece.text)
        .sort((left, right) => left.start - right.start)
        .map(({ text, declaration }) => ({ text, declaration })),
    };
  }

  private join(pieces: readonly InlinePiece[]): string {
    let output = '';
    let open = false;
    for (const piece of pieces) {
      if (piece.declaration) {
        output += (open ? ';' : output ? ' ' : '') + piece.text;
        open = true;
      } else output += (output ? ' ' : '') + piece.text;
    }
    return output;
  }

  private error(code: string): Diagnostic {
    return { code, severity: 'error', messageKey: `diagnostics.${code}` };
  }

  private unique(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
    return [...new Map(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic])).values()];
  }
}
