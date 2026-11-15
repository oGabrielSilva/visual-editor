import { defaultTreeAdapter, html, parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { HtmlDocumentCodec } from '../codecs/html';
import { ContentPolicy } from '../security/policy';

export const COMPILE_LIMITS = Object.freeze({
  sourceBytes: 200_000,
  outputBytes: 2_000_000,
  timeoutMs: 15_000,
  parallelJobs: 2,
});

const FORBIDDEN = ['mj-include', 'mj-font', 'mj-raw', 'script', 'iframe', 'object', 'embed'];
/** Preview class of a raw region: `ve-p-<token of the rendering>-<block id>`. */
const RAW_CELL_CLASS = /^ve-p-[a-f0-9]{32}-[A-Za-z0-9_-]{1,64}$/;
const RAW_CELL_STYLE = /^padding:(0|\d{1,3}(px)?)( (0|\d{1,3}(px)?)){0,3}$/;

/** Compilation accepts content, never filesystem paths, configuration or plugins. */
export class CompilationGuard {
  private readonly codec = new HtmlDocumentCodec(new ContentPolicy());

  /**
   * Without `fragments` (MJML from outside) `mj-raw` is refused like an include. With them
   * (MJML of the block codec) an `mj-raw` is accepted only as a child of `mj-column`, only
   * when its content is exactly one of the fragments, and each fragment must pass
   * `rawFragment`.
   */
  source(source: string, fragments?: readonly string[]): void {
    if (new TextEncoder().encode(source).length > COMPILE_LIMITS.sourceBytes)
      throw new Error('COMPILE_SOURCE_LIMIT');
    const allowed = fragments ? new Set(fragments) : undefined;
    for (const fragment of allowed ?? []) this.rawFragment(fragment);
    const root = parseFragment(source, { sourceCodeLocationInfo: true });
    const stack: { node: DefaultTreeAdapterMap['childNode']; parent: string }[] =
      root.childNodes.map((node) => ({ node, parent: '' }));
    let count = 0;
    while (stack.length) {
      const frame = stack.pop();
      if (!frame) break;
      const { node } = frame;
      if (++count > 10_000) throw new Error('COMPILE_NODE_LIMIT');
      if ('tagName' in node) {
        if (node.tagName === 'mj-raw' && allowed)
          this.rawRegion(node, frame.parent, source, allowed);
        else if (FORBIDDEN.includes(node.tagName)) throw new Error('COMPILE_FORBIDDEN_TAG');
      }
      if ('childNodes' in node) {
        const parent = 'tagName' in node ? node.tagName : '';
        stack.push(...node.childNodes.map((child) => ({ node: child, parent })));
      }
    }
  }

  /**
   * A raw region of generated MJML. MJML writes it, as it is, inside the `tbody` of the column,
   * so it is read here the way a browser reads it there: one row, one cell with only a class
   * and a padding, and a content the e-mail rules keep without removing or rewriting anything.
   */
  rawFragment(fragment: string): void {
    // MJML ends a raw region at its closing tag wherever it is, attributes included.
    if (/<\/?mj-/i.test(fragment)) throw new Error('COMPILE_UNSAFE_RAW');
    const context = defaultTreeAdapter.createElement('tbody', html.NS.HTML, []);
    const parsed = parseFragment(context, fragment, {});
    const row = parsed.childNodes[0];
    if (parsed.childNodes.length !== 1 || !row || !('tagName' in row) || row.tagName !== 'tr')
      throw new Error('COMPILE_UNSAFE_RAW');
    const cell = row.childNodes[0];
    if (
      row.attrs.length ||
      row.childNodes.length !== 1 ||
      !cell ||
      !('tagName' in cell) ||
      cell.tagName !== 'td'
    )
      throw new Error('COMPILE_UNSAFE_RAW');
    for (const attribute of cell.attrs)
      if (
        !(attribute.name === 'class' && RAW_CELL_CLASS.test(attribute.value)) &&
        !(attribute.name === 'style' && RAW_CELL_STYLE.test(attribute.value))
      )
        throw new Error('COMPILE_UNSAFE_RAW');
    const content = serialize(cell);
    if (!content) return;
    const result = this.codec.inspect({ html: content, css: '' }, 'email');
    if (!result.document || result.diagnostics.some((diagnostic) => diagnostic.severity !== 'info'))
      throw new Error('COMPILE_UNSAFE_RAW');
  }

  output(source: unknown): string {
    if (
      typeof source !== 'string' ||
      new TextEncoder().encode(source).length > COMPILE_LIMITS.outputBytes
    )
      throw new Error('COMPILE_OUTPUT_LIMIT');
    // Generated markup is the catalog's, not an author's: it has to be an e-mail as it is.
    // Anything the import would have to remove or rewrite makes the compilation fail.
    const result = this.codec.inspect({ html: source, css: '' }, 'email');
    if (!result.document || result.diagnostics.some((diagnostic) => diagnostic.severity !== 'info'))
      throw new Error('COMPILE_UNSAFE_OUTPUT');
    return source;
  }

  private rawRegion(
    node: DefaultTreeAdapterMap['element'],
    parent: string,
    source: string,
    allowed: ReadonlySet<string>,
  ): void {
    const location = node.sourceCodeLocation;
    if (parent !== 'mj-column' || !location?.startTag || !location.endTag)
      throw new Error('COMPILE_FORBIDDEN_TAG');
    const content = source.slice(location.startTag.endOffset, location.endTag.startOffset);
    if (!allowed.has(content)) throw new Error('COMPILE_FORBIDDEN_TAG');
  }
}

export const MJML_OPTIONS = Object.freeze({
  fonts: {},
  validationLevel: 'strict' as const,
  ignoreIncludes: true,
  useMjmlConfigOptions: false,
  keepComments: true,
  minify: false,
  juiceOptions: { webResources: { images: false, scripts: false, links: false } },
});
