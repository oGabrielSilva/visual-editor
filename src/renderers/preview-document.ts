import { defaultTreeAdapter, html, parse, parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { DocumentKind, EditorDocumentData, ImportResult, SourceInput } from '../core/document';
import type { DocumentOutputPolicy } from './page-renderer';
import { documentParts, markupChildren, stripReservedAttributes } from './markup-tree';

export interface SourceValidationCodec {
  import(source: SourceInput, kind: DocumentKind): ImportResult;
  /** Read without touching the preservation cache of the documents being edited. */
  inspect?(source: SourceInput, kind: DocumentKind): ImportResult;
  /** Needed when the rules of the kind changed what the given source parses to. */
  export?(document: EditorDocumentData): SourceInput;
}

/** `<meta http-equiv>` values which act on the window that renders them. */
const ACTIVE_META: ReadonlySet<string> = new Set([
  'refresh',
  'content-security-policy',
  'content-security-policy-report-only',
  'set-cookie',
]);

/**
 * The only policy of the editing frame. Nothing of the document may run: `script-src` is
 * left to `default-src 'none'` here and narrowed by the selection preview to the SHA-256 digest
 * of the one runtime script, which
 * also covers inline handlers and `javascript:` URLs. Styles, fonts and images of the author
 * load over HTTPS so that the piece looks like itself while it is edited; frames, objects,
 * connections, forms, workers and a `<base>` do not.
 */
const PREVIEW_POLICY: readonly string[] = Object.freeze([
  "default-src 'none'",
  "style-src 'unsafe-inline' https:",
  'font-src https: data:',
  'media-src https: data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
]);

export interface HtmlAssemblyPort {
  build(source: SourceInput, kind: DocumentKind, preview?: boolean): string;
}

/** Produces a complete portable file from an already policy-validated source. */
export class HtmlDocumentAssembler {
  readonly #imageOrigins: readonly string[];

  constructor(
    private readonly codec: SourceValidationCodec,
    private readonly policy: DocumentOutputPolicy,
    imageOrigins: readonly string[] = [],
  ) {
    if (imageOrigins.length > 10) throw new Error('PREVIEW_ORIGIN_LIMIT');
    this.#imageOrigins = Object.freeze(
      imageOrigins.map((value) => {
        const url = new URL(value);
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash ||
          (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
        )
          throw new Error('INVALID_PREVIEW_ORIGIN');
        return url.origin;
      }),
    );
  }

  build(source: SourceInput, kind: DocumentKind, preview = false): string {
    const imported = this.codec.inspect
      ? this.codec.inspect(source, kind)
      : this.codec.import(source, kind);
    if (
      !imported.document ||
      imported.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    )
      throw new Error('preview.invalid_document');
    // The policy checks the content again; the aggregate spares it a second schema parse.
    this.policy.assertSafe(imported.validated ?? imported.document);
    if (source.css.toLowerCase().includes('</style')) throw new Error('preview.invalid_styles');
    // A source the kind rules had to clean is not the document: its clean form is built.
    let markup = source.html;
    if (imported.diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) {
      if (!this.codec.export) throw new Error('preview.invalid_document');
      markup = this.codec.export(imported.document).html;
    }
    const document = parse(markup);
    const { head } = documentParts(document);
    if (!head) throw new Error('preview.invalid_document');
    if (source.css) {
      const style = defaultTreeAdapter.createElement('style', html.NS.HTML, []);
      defaultTreeAdapter.insertText(style, source.css);
      defaultTreeAdapter.appendChild(head, style);
    }
    if (preview) {
      this.neutralize(document);
      const policy = [
        ...PREVIEW_POLICY,
        ['img-src data: blob: https:', ...this.#imageOrigins].join(' '),
      ].join('; ');
      const csp = defaultTreeAdapter.createElement('meta', html.NS.HTML, [
        { name: 'http-equiv', value: 'Content-Security-Policy' },
        { name: 'content', value: policy },
      ]);
      const first = head.childNodes[0];
      if (first) defaultTreeAdapter.insertBefore(head, csp, first);
      else defaultTreeAdapter.appendChild(head, csp);
      defaultTreeAdapter.appendChild(
        head,
        defaultTreeAdapter.createElement('meta', html.NS.HTML, [
          { name: 'name', value: 'referrer' },
          { name: 'content', value: 'no-referrer' },
        ]),
      );
    }
    const hasDoctype = document.childNodes.some((node) => node.nodeName === '#documentType');
    return `${hasDoctype ? '' : '<!doctype html>'}${serialize(document)}`;
  }

  /**
   * Changes only the copy shown in the editor, never the document. A policy written by the
   * author cannot stand next to the editor's (it could neither loosen it nor break the
   * editing script), a refresh would navigate the frame away, and a base would redirect
   * every relative reference. The elements which stay keep their place in the tree.
   *
   * The content of `noscript` is text to a parser with scripting and markup to one without: the
   * editing frame reads it the first way, the plain preview and the parser which reconciles a
   * revision read it the second. It is read here as markup, given the same treatment, cleared
   * of every attribute reserved to the editor and written back as text.
   */
  private neutralize(document: DefaultTreeAdapterMap['parentNode']): void {
    const stack: DefaultTreeAdapterMap['parentNode'][] = [document];
    while (stack.length) {
      const parent = stack.pop();
      if (!parent) break;
      for (const node of [...markupChildren(parent)]) {
        if (!defaultTreeAdapter.isElementNode(node)) continue;
        if (node.namespaceURI === html.NS.HTML && node.tagName === 'meta') {
          const directive = node.attrs
            .find((attribute) => attribute.name === 'http-equiv')
            ?.value.trim()
            .toLowerCase();
          if (directive !== undefined && ACTIVE_META.has(directive)) {
            defaultTreeAdapter.detachNode(node);
            continue;
          }
        }
        if (node.namespaceURI === html.NS.HTML && node.tagName === 'base')
          node.attrs = node.attrs.filter(
            (attribute) => attribute.name !== 'href' && attribute.name !== 'target',
          );
        // Read without scripting, as here inside another `noscript`, it holds ordinary elements.
        if (
          node.namespaceURI === html.NS.HTML &&
          node.tagName === 'noscript' &&
          node.childNodes.every((entry) => defaultTreeAdapter.isTextNode(entry))
        ) {
          this.noscript(node);
          continue;
        }
        stack.push(node);
      }
    }
  }

  private noscript(node: DefaultTreeAdapterMap['element']): void {
    const source = node.childNodes
      .map((entry) => (defaultTreeAdapter.isTextNode(entry) ? entry.value : ''))
      .join('');
    if (!source) return;
    const fragment = parseFragment(source, { scriptingEnabled: false });
    this.neutralize(fragment);
    stripReservedAttributes(fragment);
    const safe = serialize(fragment, { scriptingEnabled: false });
    node.childNodes = [];
    // Nothing written back may end the element for the parser which reads it as text.
    if (!safe.toLowerCase().includes('</noscript')) defaultTreeAdapter.insertText(node, safe);
  }
}

/** Sandbox remains mandatory even with CSP; no user markup reaches the host DOM. */
export class PreviewDocument {
  constructor(private readonly assembler: HtmlAssemblyPort) {}
  build(source: SourceInput, kind: DocumentKind): string {
    return this.assembler.build(source, kind, true);
  }
}
