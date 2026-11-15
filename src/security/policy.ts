import { CssDocumentCodec } from '../codecs/css';
import { DocumentValidationError, EditorDocument } from '../core/document';
import type { Diagnostic, DocumentNode, EditorDocumentData } from '../core/document';
import { ContentInspector } from './content-inventory';
import type { ContentInventory } from './content-inventory';
import { EmailSanitizer } from './email-sanitizer';
import type { EmailRemoval } from './email-sanitizer';
import { ActiveMarkupRules } from './markup-rules';
import { UrlPolicy } from './url-policy';

export class ContentPolicyError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super('UNSAFE_DOCUMENT');
    this.name = 'ContentPolicyError';
  }
}

export interface SanitizedDocument {
  readonly document: EditorDocumentData;
  /** Grouped warnings saying what was removed or rewritten; empty when nothing was. */
  readonly diagnostics: readonly Diagnostic[];
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const FOREIGN_ROOTS: Readonly<Record<string, string>> = Object.freeze({
  svg: 'http://www.w3.org/2000/svg',
  math: 'http://www.w3.org/1998/Math/MathML',
});
const REMOVAL_CODES: Readonly<Record<EmailRemoval, string>> = Object.freeze({
  script: 'SCRIPT_REMOVED',
  embed: 'EMBED_REMOVED',
  handler: 'INLINE_HANDLER_REMOVED',
  url: 'UNSAFE_URL_REMOVED',
  style: 'ACTIVE_STYLE_REMOVED',
  charset: 'CHARSET_NORMALIZED',
});
const REFUSAL_CODES: Readonly<Record<EmailRemoval, string>> = Object.freeze({
  script: 'FORBIDDEN_HTML_TAG',
  embed: 'FORBIDDEN_HTML_TAG',
  handler: 'FORBIDDEN_HTML_ATTRIBUTE',
  url: 'UNSAFE_HTML_URL',
  style: 'UNSAFE_CSS',
  charset: 'FORBIDDEN_META_DIRECTIVE',
});

/**
 * The rules of a document by kind. The editor never refuses the author's work for what it
 * contains:
 *
 * - a page keeps everything, scripts included, and `validate` only reports it (`info`);
 * - an e-mail has scripts, embeds, inline handlers and code URLs removed by `sanitize` at
 *   every entry (source or JSON), with a grouped `warning`; if they are still present,
 *   `validate` reports an error, because only a caller which skipped `sanitize` gets there.
 *
 * `assertSafe` therefore means "structurally sound, within limits and following the rules
 * of its kind". It does not mean "free of script": nothing of a document may run in the
 * editor because of the sandboxed frame and its nonce CSP, not because of this class.
 * Publication is the host's decision, taken over `inspect`.
 */
export class ContentPolicy {
  readonly #urls: UrlPolicy;
  readonly #rules: ActiveMarkupRules;
  readonly #css: CssDocumentCodec;
  readonly #inspector: ContentInspector;
  readonly #emails: EmailSanitizer;

  constructor(urls = new UrlPolicy(), css?: CssDocumentCodec) {
    this.#urls = urls;
    this.#css = css ?? new CssDocumentCodec(urls);
    const rules = new ActiveMarkupRules(urls);
    this.#rules = rules;
    this.#inspector = new ContentInspector(this.#css, rules);
    this.#emails = new EmailSanitizer(rules, this.#css);
  }

  /** An `EditorDocument` was validated when it was built and is not parsed again. */
  validate(input: EditorDocumentData | EditorDocument): readonly Diagnostic[] {
    let document: EditorDocumentData;
    try {
      document = this.snapshot(input);
    } catch (error: unknown) {
      return [
        this.error(
          error instanceof DocumentValidationError ? error.code : 'INVALID_DOCUMENT_SCHEMA',
        ),
      ];
    }
    const diagnostics: Diagnostic[] = [...this.#css.documentDiagnostics(document.css)];
    const stack = [...document.nodes];
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      this.structure(node, diagnostics);
      stack.push(...(node.children ?? []));
    }
    try {
      if (document.kind === 'email')
        for (const removal of [
          ...this.#emails.sanitize(document.nodes).removed,
          ...this.#emails.stylesheet(document.css).removed,
        ])
          diagnostics.push(this.error(REFUSAL_CODES[removal]));
      return this.group([...diagnostics, ...this.notices(document)]);
    } catch (error: unknown) {
      // Markup kept as source (a conditional comment, `noscript`, an SVG) nests beyond the limit.
      if (!(error instanceof DocumentValidationError)) throw error;
      return this.group([...diagnostics, this.error(error.code)]);
    }
  }

  assertSafe(document: EditorDocumentData | EditorDocument): void {
    const diagnostics = this.validate(document);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error'))
      throw new ContentPolicyError(diagnostics);
  }

  /**
   * Applies the removals of the kind. A page is returned as it came. Throws
   * `DocumentValidationError` when the input is not a document within the limits.
   */
  sanitize(input: EditorDocumentData | EditorDocument): SanitizedDocument {
    const document = this.snapshot(input);
    if (document.kind !== 'email') return { document, diagnostics: [] };
    const result = this.#emails.sanitize(document.nodes);
    const sheet = this.#emails.stylesheet(document.css);
    const removed = [...result.removed, ...sheet.removed];
    if (!removed.length) return { document, diagnostics: [] };
    return {
      document: EditorDocument.from({
        ...document,
        nodes: result.nodes,
        css: sheet.css,
      }).snapshot(),
      diagnostics: this.group(
        removed.map((removal) => this.notice(REMOVAL_CODES[removal], 'warning', 1)),
      ),
    };
  }

  /**
   * What the editor itself may write through its commands (an attribute, a link, a text
   * coming back from the editing frame), in either kind. It is stricter than what an author
   * may import: no script or embed, no handler, and URLs only under the strict `UrlPolicy`.
   */
  writable(nodes: readonly DocumentNode[]): boolean {
    const stack = [...nodes];
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      if (node.type !== 'element') continue;
      if (
        this.#rules.element(node.tag ?? '') ||
        this.#rules.elementWith(node.tag ?? '', node.attrs ?? {}) ||
        this.#rules.navigation(node.tag ?? '', node.attrs ?? {})
      )
        return false;
      for (const [name, value] of Object.entries(node.attrs ?? {})) {
        if (this.#rules.attribute(name, value) || this.#rules.handlerLike(name)) return false;
        const purpose = this.#rules.urlPurpose(name);
        if (purpose && !this.#urls.isSafe(value, purpose)) return false;
        if (['srcdoc', 'srcset', 'imagesrcset'].includes(name.toLowerCase())) return false;
      }
      stack.push(...(node.children ?? []));
    }
    return true;
  }

  /** The typed inventory a host uses to decide whether and how to publish the document. */
  inspect(input: EditorDocumentData): ContentInventory {
    return this.#inspector.inspect(input);
  }

  private notices(document: EditorDocumentData): readonly Diagnostic[] {
    const { inventory, anchors } = this.#inspector.survey(document);
    const notices: Diagnostic[] = [];
    const add = (code: string, count: number, nodeId: string | undefined): void => {
      if (count > 0) notices.push(this.notice(code, 'info', count, nodeId));
    };
    if (document.kind === 'page') {
      add(
        'SCRIPT_PRESERVED',
        inventory.scripts.inline + inventory.scripts.external.length,
        anchors.script,
      );
      add('EMBED_PRESERVED', inventory.frames.length + inventory.embeds, anchors.embed);
      add(
        'INLINE_HANDLER_PRESERVED',
        inventory.inlineHandlers + inventory.scriptUrls,
        anchors.handler,
      );
    }
    add('EXTERNAL_STYLE_PRESERVED', inventory.stylesheets.length, anchors.stylesheet);
    add('FORM_PRESERVED', inventory.forms.count, anchors.form);
    return notices;
  }

  private snapshot(input: EditorDocumentData | EditorDocument): EditorDocumentData {
    return (input instanceof EditorDocument ? input : EditorDocument.from(input)).snapshot();
  }

  /** Integrity of the tree itself: what no parser could have produced or written back. */
  private structure(node: DocumentNode, diagnostics: Diagnostic[]): void {
    if (
      node.value?.includes('\u0000') ||
      Object.values(node.attrs ?? {}).some((value) => value.includes('\u0000'))
    )
      diagnostics.push(this.error('INVALID_HTML_CHARACTER', node.id));
    if (node.type === 'element') {
      const tag = (node.tag ?? '').toLowerCase();
      if (!this.tagName(tag)) diagnostics.push(this.error('FORBIDDEN_HTML_TAG', node.id));
      const namespace = node.metadata?.namespace ?? FOREIGN_ROOTS[tag] ?? HTML_NAMESPACE;
      // Foreign content only exists as a whole svg or math island kept as source.
      if (namespace !== (FOREIGN_ROOTS[tag] ?? HTML_NAMESPACE))
        diagnostics.push(this.error('FORBIDDEN_NAMESPACE', node.id));
      for (const attribute of Object.keys(node.attrs ?? {}))
        if (!this.attributeName(attribute))
          diagnostics.push(this.error('FORBIDDEN_HTML_ATTRIBUTE', node.id));
      return;
    }
    if (node.type === 'comment') {
      const value = node.value ?? '';
      const opener = node.metadata?.commentOpener ?? '<!--';
      // Neither form may be closed from inside by the text it carries.
      if (
        opener === '<!--'
          ? value.includes('-->') || value.includes('--!>')
          : value.includes('>') || (opener === '<?' && !value.startsWith('?'))
      )
        diagnostics.push(this.error('INVALID_HTML_COMMENT', node.id));
    }
    if (node.type === 'doctype') {
      const identifiers = Object.entries(node.attrs ?? {});
      if (
        !this.tagName((node.value ?? '').toLowerCase() || 'html') ||
        identifiers.some(([name]) => !['publicId', 'systemId'].includes(name)) ||
        identifiers.some(
          ([, value]) => value.includes('>') || (value.includes('"') && value.includes("'")),
        )
      )
        diagnostics.push(this.error('INVALID_DOCTYPE', node.id));
      return;
    }
    if (node.attrs && Object.keys(node.attrs).length)
      diagnostics.push(this.error('INVALID_LEAF', node.id));
  }

  /** A letter, then anything the tokenizer keeps in a tag name. */
  private tagName(name: string): boolean {
    const first = name.charCodeAt(0);
    return (
      ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) && this.nameCharacters(name)
    );
  }

  /** Framework and merge syntaxes (`@click`, `:class`, `mc:edit`) are ordinary names. */
  private attributeName(name: string): boolean {
    return (
      name.length > 0 &&
      name !== '__proto__' &&
      !name.slice(1).includes('=') &&
      this.nameCharacters(name)
    );
  }

  private nameCharacters(name: string): boolean {
    return ![...name].some(
      (character) =>
        character === '/' ||
        character === '>' ||
        character === '\u0000' ||
        character === ' ' ||
        character === '\t' ||
        character === '\n' ||
        character === '\f' ||
        character === '\r',
    );
  }

  /** One entry per code: the first node it refers to and how many times it happened. */
  private group(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
    const grouped = new Map<string, Diagnostic>();
    for (const diagnostic of diagnostics) {
      const existing = grouped.get(diagnostic.code);
      if (!existing) {
        grouped.set(diagnostic.code, diagnostic);
        continue;
      }
      const nodeId = existing.nodeId ?? diagnostic.nodeId;
      grouped.set(diagnostic.code, {
        code: existing.code,
        severity: existing.severity,
        messageKey: existing.messageKey,
        ...(nodeId ? { nodeId } : {}),
        count: (existing.count ?? 1) + (diagnostic.count ?? 1),
      });
    }
    return [...grouped.values()];
  }

  private notice(
    code: string,
    severity: 'warning' | 'info',
    count: number,
    nodeId?: string,
  ): Diagnostic {
    return {
      code,
      severity,
      messageKey: `diagnostics.${code}`,
      ...(nodeId ? { nodeId } : {}),
      count,
    };
  }

  private error(code: string, nodeId?: string): Diagnostic {
    return {
      code,
      severity: 'error',
      messageKey: `diagnostics.${code}`,
      ...(nodeId ? { nodeId } : {}),
    };
  }
}
