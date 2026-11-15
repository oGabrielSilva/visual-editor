import { defaultTreeAdapter, html, serialize, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { BlockCatalog } from '../core/catalog';
import { DocumentBudget, DocumentBudgetError } from '../core/budget';
import { HtmlContentModel } from '../core/html-content-model';
import {
  DOCUMENT_LIMITS,
  DocumentValidationError,
  EditorDocument,
  HTML_VOID_ELEMENTS,
} from '../core/document';
import type {
  CommentOpener,
  Diagnostic,
  DocumentKind,
  DocumentNode,
  EditorDocumentData,
  ImportResult,
  NodeMetadata,
  SourceInput,
} from '../core/document';
import { ContentPolicy } from '../security/policy';
import { SecureIdentifier } from '../security/identity';
import { BoundedHtmlParser } from '../security/bounded-parser';
import { DownlevelRevealedConditional } from '../security/conditional-comment';

/** parse5 drops the first line feed of these elements, so the serializer must restore it. */
const LEADING_NEWLINE_ELEMENTS: readonly string[] = Object.freeze(['pre', 'textarea', 'listing']);

/** Elements which only exist inside a table; alone at the top of a fragment they are orphans. */
const TABLE_PARTS: ReadonlySet<string> = new Set([
  'td',
  'th',
  'tr',
  'tbody',
  'thead',
  'tfoot',
  'caption',
  'colgroup',
  'col',
]);

/** Top-level nodes above which a fragment is read from the document parse instead. */
const WIDE_FRAGMENT_NODES = 20_000;

interface SourceRegion {
  readonly node: DocumentNode;
  readonly start: number;
  readonly end: number;
}

interface SourceRecord {
  /** Absent when the tree is not what the source parses to, e.g. after an e-mail was cleaned. */
  readonly fingerprint: string | undefined;
  readonly source: SourceInput;
  readonly regions: ReadonlyMap<string, SourceRegion>;
  readonly weight: number;
}

/** HTML5 parser, structural recognition and a bounded, private source-preservation cache. */
export class HtmlDocumentCodec {
  readonly #policy: ContentPolicy;
  readonly #catalog: BlockCatalog;
  readonly #records = new Map<string, SourceRecord>();
  /** Documents which were exported are being edited; unrelated imports must not evict them. */
  readonly #exported = new Set<string>();
  readonly #cacheSize: number;
  readonly #cacheCharacters = 8_000_000;
  #nextId = 0;
  readonly #instanceId = new SecureIdentifier().next();
  readonly #conditionals = new DownlevelRevealedConditional();
  readonly #model = new HtmlContentModel();
  readonly #digests = new WeakMap<DocumentNode, string>();
  readonly #budget = new DocumentBudget();
  /** Ends a parse at the first element nested beyond the limit, before it costs quadratic time. */
  readonly #parser = new BoundedHtmlParser(DOCUMENT_LIMITS.depth);

  constructor(policy = new ContentPolicy(), catalog = new BlockCatalog(), cacheSize = 20) {
    if (!Number.isInteger(cacheSize) || cacheSize < 1 || cacheSize > 100)
      throw new RangeError('INVALID_CODEC_CACHE_LIMIT');
    this.#policy = policy;
    this.#catalog = catalog;
    this.#cacheSize = cacheSize;
  }

  /**
   * Never refuses a document for what it contains. A source is only turned down when it is
   * over the limits or when its tree cannot be written back as the same tree; a tree which
   * needed one pass of the serializer to settle is accepted in that settled form.
   */
  import(source: SourceInput, kind: DocumentKind, previous?: EditorDocumentData): ImportResult {
    const result = this.read(source, kind, previous, true);
    if (!result.document || this.roundTrips(result.document)) return result;
    this.forget(result.document.id);
    const settled = this.read(
      { html: this.plain(result.document), css: source.css },
      kind,
      previous,
      true,
    );
    if (!settled.document || !this.roundTrips(settled.document)) {
      if (settled.document) this.forget(settled.document.id);
      return { diagnostics: [this.error('INVALID_HTML')] };
    }
    const diagnostics = new Map<string, Diagnostic>();
    for (const diagnostic of [
      ...result.diagnostics.filter((entry) => entry.severity === 'warning'),
      ...settled.diagnostics,
      this.notice('HTML_NORMALIZED'),
    ])
      if (!diagnostics.has(diagnostic.code)) diagnostics.set(diagnostic.code, diagnostic);
    return { document: settled.document, diagnostics: [...diagnostics.values()] };
  }

  /**
   * Parses and validates auxiliary source (rich text projections, snippets, verification)
   * without touching the preservation cache of the documents being edited.
   */
  inspect(source: SourceInput, kind: DocumentKind): ImportResult {
    return this.read(source, kind, undefined, false);
  }

  private read(
    source: SourceInput,
    kind: DocumentKind,
    previous: EditorDocumentData | undefined,
    remember: boolean,
  ): ImportResult {
    if (
      typeof source?.html !== 'string' ||
      typeof source.css !== 'string' ||
      !['email', 'page'].includes(kind)
    )
      return { diagnostics: [this.error('INVALID_SOURCE')] };
    try {
      this.#budget.assertSource(source.html, source.css);
    } catch (error: unknown) {
      return {
        diagnostics: [
          this.error(error instanceof DocumentBudgetError ? error.code : 'DOCUMENT_TOO_LARGE'),
        ],
      };
    }
    if (previous) {
      try {
        this.#policy.assertSafe(previous);
      } catch {
        return { diagnostics: [this.error('INVALID_PREVIOUS_DOCUMENT')] };
      }
      if (previous.kind !== kind) return { diagnostics: [this.error('DOCUMENT_KIND_MISMATCH')] };
    }
    // The parser drops or replaces U+0000; without it positions and tree agree again.
    const markup = source.html.includes('\u0000')
      ? source.html.replaceAll('\u0000', '')
      : source.html;
    const kept: SourceInput = { html: markup, css: source.css };
    try {
      const { nodes: parsedNodes, slices } = this.tree(markup);
      // The rules of the kind are applied to the tree: an e-mail loses what it may not carry.
      const draft = EditorDocument.from({
        schemaVersion: 1,
        id: previous?.id ?? this.newId('document'),
        kind,
        revision: (previous?.revision ?? -1) + 1,
        title: (this.findTitle(parsedNodes) ?? previous?.title ?? '').slice(0, 1_000),
        nodes: parsedNodes,
        css: source.css,
      });
      const sanitized = this.#policy.sanitize(draft);
      const cleaned = sanitized.document.nodes;
      const nodes = previous ? this.reconcileIds(cleaned, previous.nodes) : cleaned;
      // Reconciliation keeps the shape, so both trees are walked in lockstep.
      const regions = new Map<string, SourceRegion>();
      const pending = nodes.map((node, index) => ({ node, origin: cleaned[index] }));
      while (pending.length) {
        const frame = pending.pop();
        if (!frame) break;
        const slice = frame.origin ? slices.get(frame.origin.id) : undefined;
        if (slice) regions.set(frame.node.id, slice);
        (frame.node.children ?? []).forEach((child, index) =>
          pending.push({ node: child, origin: frame.origin?.children?.[index] }),
        );
      }
      // The draft is the document unless the kind rules or older identities changed its tree.
      const settled =
        previous || sanitized.diagnostics.length
          ? EditorDocument.from({ ...sanitized.document, nodes })
          : draft;
      const diagnostics = this.#policy.validate(settled);
      if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return { diagnostics };
      const document = settled.snapshot();
      if (remember) this.remember(document, kept, regions, sanitized.diagnostics.length === 0);
      return {
        document,
        validated: settled,
        diagnostics: [...sanitized.diagnostics, ...diagnostics],
      };
    } catch (error: unknown) {
      return {
        diagnostics: [
          this.error(error instanceof DocumentValidationError ? error.code : 'INVALID_HTML'),
        ],
      };
    }
  }

  /**
   * The tree the parser builds for this markup, in the shape of the document model, and the
   * source slice of every node which stands alone in it. Throws over the node limits.
   */
  private tree(markup: string): {
    readonly nodes: readonly DocumentNode[];
    readonly slices: ReadonlyMap<string, SourceRegion>;
  } {
    // Scripting is on, as in the browsers which will render the result: `noscript` is text.
    const options = { sourceCodeLocationInfo: true, scriptingEnabled: true };
    const parsed = this.#parser.document(markup, options);
    const roots = this.isDocument(parsed) ? parsed.childNodes : this.fragment(parsed, markup);
    let counted = 0;
    let total = 0;
    const contained = new WeakSet<DocumentNode>();
    const convert = (node: DefaultTreeAdapterMap['childNode'], depth: number): DocumentNode => {
      if (depth > DOCUMENT_LIMITS.depth) throw new DocumentValidationError('DOCUMENT_TOO_DEEP');
      const id = this.newId('node');
      const location = node.sourceCodeLocation;
      const metadata: NodeMetadata = location
        ? { sourceStart: location.startOffset, sourceEnd: location.endOffset }
        : {};
      let converted: DocumentNode;
      if (defaultTreeAdapter.isElementNode(node)) {
        const attrs = Object.fromEntries(
          node.attrs
            .map((attribute) => [
              attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name,
              attribute.value,
            ])
            // Never an HTML attribute; as an object key it would be the prototype.
            .filter(([name]) => name !== '__proto__'),
        );
        const island = this.island(node, markup, id);
        const children =
          island?.children ??
          defaultTreeAdapter.getChildNodes(node).map((child) => convert(child, depth + 1));
        converted = {
          id,
          type: 'element',
          tag: node.tagName,
          attrs,
          children,
          metadata: { ...metadata, namespace: node.namespaceURI },
        };
        const descriptor = this.#catalog.recognize(converted);
        if (descriptor)
          converted = {
            ...converted,
            metadata: { ...converted.metadata, blockType: descriptor.type },
          };
        if (island ? island.contained : this.selfContainedElement(node, children, contained))
          contained.add(converted);
      } else if (defaultTreeAdapter.isTextNode(node)) {
        converted = { id, type: 'text', value: node.value, metadata };
        // Adjacent character tokens are merged: a slice holding markup is not this text alone.
        if (location && !markup.slice(location.startOffset, location.endOffset).includes('<'))
          contained.add(converted);
      } else if (defaultTreeAdapter.isCommentNode(node)) {
        // The tree cannot tell `<!--[if mso]-->` from `<![if mso]>` nor `<?xml ?>` from a
        // comment: how it was written is read from the source and kept with the node.
        const opener = location ? this.opener(markup, location.startOffset) : '<!--';
        converted = {
          id,
          type: 'comment',
          value: node.data,
          metadata:
            opener !== '<!--' || this.#conditionals.isMarker(node.data)
              ? { ...metadata, commentOpener: opener }
              : metadata,
        };
        if (location) contained.add(converted);
      } else if (defaultTreeAdapter.isDocumentTypeNode(node)) {
        converted = {
          id,
          type: 'doctype',
          value: node.name,
          attrs: { publicId: node.publicId, systemId: node.systemId },
          metadata,
        };
        if (location) contained.add(converted);
      } else {
        throw new DocumentValidationError('UNSUPPORTED_HTML_NODE');
      }
      if (this.#budget.countable(converted)) counted++;
      if (counted > DOCUMENT_LIMITS.nodes || ++total > DOCUMENT_LIMITS.totalNodes)
        throw new DocumentValidationError('DOCUMENT_TOO_MANY_NODES');
      return converted;
    };
    const parsedNodes = roots.map((node) => convert(node, 0));
    const slices = new Map<string, SourceRegion>();
    const located = [...parsedNodes];
    while (located.length) {
      const node = located.pop();
      if (!node) break;
      const start = node.metadata?.sourceStart;
      const end = node.metadata?.sourceEnd;
      if (contained.has(node) && start !== undefined && end !== undefined && end > start)
        slices.set(node.id, { node, start, end });
      located.push(...(node.children ?? []));
    }
    return { nodes: parsedNodes, slices };
  }

  export(input: EditorDocumentData | EditorDocument): SourceInput {
    const aggregate = input instanceof EditorDocument ? input : EditorDocument.from(input);
    this.#policy.assertSafe(aggregate);
    const document = aggregate.snapshot();
    const record = this.#records.get(document.id);
    if (record) {
      // Exporting is the session's use of its record: keep it the most recent entry.
      this.#records.delete(document.id);
      this.#records.set(document.id, record);
      this.#exported.add(document.id);
    }
    const fingerprint = this.documentFingerprint(document);
    if (record?.fingerprint !== undefined && record.fingerprint === fingerprint)
      return { ...record.source };
    if (record) {
      const preserved = document.nodes.map((node) => this.serialize(node, record)).join('');
      if (this.verification(preserved, document, fingerprint) === undefined)
        return { html: preserved, css: document.css };
      // A preserved slice was not as self-contained as its locations suggested: serialize plainly.
    }
    const html = this.plain(document);
    const failure = this.verification(html, document, fingerprint);
    if (failure) throw new Error(failure);
    return { html, css: document.css };
  }

  clearCache(): void {
    this.#records.clear();
    this.#exported.clear();
  }

  private plain(document: EditorDocumentData): string {
    return document.nodes.map((node) => this.serialize(node)).join('');
  }

  private roundTrips(document: EditorDocumentData): boolean {
    return (
      this.verification(this.plain(document), document, this.documentFingerprint(document)) ===
      undefined
    );
  }

  private forget(id: string): void {
    this.#records.delete(id);
    this.#exported.delete(id);
  }

  /**
   * `template`, `svg` and `math` are kept as one block of source. Their inner markup follows
   * other parsing rules (inert content, foreign elements, CDATA) which a tree of HTML nodes
   * would not write back as it was read.
   */
  private island(
    node: DefaultTreeAdapterMap['element'],
    markup: string,
    id: string,
  ): { readonly children: readonly DocumentNode[]; readonly contained: boolean } | undefined {
    if (
      !this.#model.isSourceIsland(node.tagName) ||
      (node.tagName === 'template') !== (node.namespaceURI === html.NS.HTML)
    )
      return undefined;
    const start = node.sourceCodeLocation?.startTag?.endOffset;
    const end = node.sourceCodeLocation?.endTag?.startOffset;
    const closed = start !== undefined && end !== undefined;
    // Without its own end tag the positions say nothing certain about what it holds.
    const source = closed ? markup.slice(start, end) : serialize(node);
    return {
      children: source ? [{ id: `${id}-source`, type: 'text', value: source }] : [],
      contained: closed,
    };
  }

  private opener(markup: string, offset: number): CommentOpener {
    if (markup.startsWith('<!--', offset)) return '<!--';
    if (markup.startsWith('<!', offset)) return '<!';
    if (markup.startsWith('</', offset)) return '</';
    return markup.startsWith('<?', offset) ? '<?' : '<!--';
  }

  /** How a comment is written: as recorded, or by the grammar of old documents without it. */
  private commentOpener(node: DocumentNode): CommentOpener {
    return (
      node.metadata?.commentOpener ??
      (this.#conditionals.isMarker(node.value ?? '') ? '<!' : '<!--')
    );
  }

  private namespace(node: DocumentNode): string {
    const tag = node.tag?.toLowerCase();
    if (tag === 'svg') return html.NS.SVG;
    if (tag === 'math') return html.NS.MATHML;
    return node.metadata?.namespace ?? html.NS.HTML;
  }

  /**
   * Reparse output before returning it; serializer edge cases are a security boundary too.
   * The tree read back has to be the tree which was written: the same nodes, attributes,
   * text, comment forms and namespaces. Anything a parser would read differently, such as
   * text which closes its own script or comment, fails here whatever the kind allows.
   */
  private verification(
    html: string,
    document: EditorDocumentData,
    fingerprint: string,
  ): string | undefined {
    try {
      this.#budget.assertSource(html, document.css);
      const nodes = this.tree(html).nodes;
      return this.documentFingerprint({ ...document, nodes }) === fingerprint
        ? undefined
        : 'SERIALIZED_STRUCTURE_CHANGED';
    } catch {
      return 'UNSAFE_SERIALIZED_DOCUMENT';
    }
  }

  /**
   * A source slice may stand for a node only when it holds that node and nothing else.
   * Foster parenting, formatting reconstruction and ignored tokens leave foreign source
   * between the located children; implied elements carry no location and are transparent.
   */
  private selfContainedElement(
    node: DefaultTreeAdapterMap['element'],
    children: readonly DocumentNode[],
    contained: WeakSet<DocumentNode>,
  ): boolean {
    const location = node.sourceCodeLocation;
    if (!location?.startTag) return false;
    const cursor = { offset: location.startTag.endOffset };
    return (
      this.tile(defaultTreeAdapter.getChildNodes(node), children, contained, cursor) &&
      cursor.offset === (location.endTag?.startOffset ?? location.endOffset)
    );
  }

  private tile(
    parsed: readonly DefaultTreeAdapterMap['childNode'][],
    converted: readonly DocumentNode[],
    contained: WeakSet<DocumentNode>,
    cursor: { offset: number },
  ): boolean {
    for (const [index, child] of parsed.entries()) {
      const node = converted[index];
      if (!node) return false;
      const location = child.sourceCodeLocation;
      if (!location) {
        if (
          !defaultTreeAdapter.isElementNode(child) ||
          !this.tile(
            defaultTreeAdapter.getChildNodes(child),
            node.children ?? [],
            contained,
            cursor,
          )
        )
          return false;
        continue;
      }
      if (location.startOffset !== cursor.offset) return false;
      if (node.type === 'element' && !contained.has(node)) return false;
      cursor.offset = location.endOffset;
    }
    return true;
  }

  private serialize(node: DocumentNode, record?: SourceRecord): string {
    const region = record?.regions.get(node.id);
    if (region && this.nodeFingerprint(region.node) === this.nodeFingerprint(node))
      return record?.source.html.slice(region.start, region.end) ?? '';
    if (node.type === 'doctype') {
      const quote = (value: string): string => (value.includes('"') ? `'${value}'` : `"${value}"`);
      const publicId = node.attrs?.publicId ?? '';
      const systemId = node.attrs?.systemId ?? '';
      const declaration = publicId
        ? ` PUBLIC ${quote(publicId)}${systemId ? ` ${quote(systemId)}` : ''}`
        : systemId
          ? ` SYSTEM ${quote(systemId)}`
          : '';
      return `<!DOCTYPE ${node.value || 'html'}${declaration}>`;
    }
    if (node.type === 'comment') {
      const value = node.value ?? '';
      // A downlevel-revealed marker or a processing instruction written as a regular
      // comment would no longer mean what the author wrote.
      const opener = this.commentOpener(node);
      if (opener === '<!--') return `<!--${value}-->`;
      // The data of `<?xml ?>` already starts with its question mark.
      return opener === '<?' ? `<${value}>` : `${opener}${value}>`;
    }
    if (node.type === 'text') {
      const element = defaultTreeAdapter.createElement('div', html.NS.HTML, []);
      defaultTreeAdapter.insertText(element, node.value ?? '');
      const text = element.childNodes[0];
      return text ? serializeOuter(text).replaceAll('\r', '&#13;') : '';
    }
    const tag = node.tag ?? 'div';
    // The serializer reads a template through a content fragment this skeleton does not have:
    // its tags are written over a stand-in element with the same attributes.
    const template = tag.toLowerCase() === 'template';
    const element = defaultTreeAdapter.createElement(
      template ? 'div' : tag,
      html.NS.HTML,
      Object.entries(node.attrs ?? {}).map(([name, value]) => ({ name, value })),
    );
    const written = serializeOuter(element).replaceAll('\r', '&#13;');
    const skeleton = template
      ? `<${tag}${written.slice('<div'.length, written.length - '</div>'.length)}</${tag}>`
      : written;
    const closing = `</${tag}>`;
    // The parser decides what is void: never cut a start tag which has no end tag.
    if (HTML_VOID_ELEMENTS.includes(tag.toLowerCase()) || !skeleton.endsWith(closing))
      return skeleton;
    const opening = skeleton.slice(0, skeleton.length - closing.length);
    const children = node.children ?? [];
    // Raw text and source islands are written as they were read: escaping would change them.
    if (this.#model.holdsSource(tag)) {
      const source = children.map((child) => child.value ?? '').join('');
      // Nothing ends `plaintext`: an end tag would become part of its text.
      return tag.toLowerCase() === 'plaintext'
        ? `${opening}${source}`
        : `${opening}${source}${closing}`;
    }
    const restoresNewline = LEADING_NEWLINE_ELEMENTS.includes(tag.toLowerCase());
    const content = children
      .map((child, index) =>
        // The slice of that first text may or may not hold the line feed the parser dropped.
        this.serialize(child, restoresNewline && index === 0 ? undefined : record),
      )
      .join('');
    const first = children[0];
    const newline =
      restoresNewline && first?.type === 'text' && first.value?.startsWith('\n') ? '\n' : '';
    return `${opening}${newline}${content}${closing}`;
  }

  /**
   * Markup without `html`, `head` or `body` is read as a fragment. The fragment parser moves
   * its result node by node, which is quadratic over tens of thousands of top-level nodes:
   * such a wide source uses the flow content of the document parse, which is the same tree
   * for everything a browser would place in a body.
   */
  private fragment(
    document: DefaultTreeAdapterMap['document'],
    markup: string,
  ): readonly DefaultTreeAdapterMap['childNode'][] {
    const flow = document.childNodes.flatMap((root) =>
      defaultTreeAdapter.isElementNode(root)
        ? root.childNodes.flatMap((section) =>
            defaultTreeAdapter.isElementNode(section) ? section.childNodes : [section],
          )
        : [],
    );
    if (flow.length > WIDE_FRAGMENT_NODES) return flow;
    const fragment = this.#parser.fragment(markup, {
      sourceCodeLocationInfo: true,
      scriptingEnabled: true,
    }).childNodes;
    // A row or a cell pasted without its table has no place in a document. Rather than
    // refuse it, its content is kept the way a browser keeps it when it lands in a body.
    return fragment.some(
      (node) => defaultTreeAdapter.isElementNode(node) && TABLE_PARTS.has(node.tagName),
    )
      ? flow
      : fragment;
  }

  private isDocument(document: DefaultTreeAdapterMap['document']): boolean {
    const stack = [...document.childNodes];
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      if (defaultTreeAdapter.isDocumentTypeNode(node)) return true;
      if (defaultTreeAdapter.isElementNode(node)) {
        if (['html', 'head', 'body'].includes(node.tagName) && node.sourceCodeLocation?.startTag)
          return true;
        stack.push(...node.childNodes);
      }
    }
    return false;
  }

  private findTitle(nodes: readonly DocumentNode[]): string | undefined {
    for (const node of nodes) {
      if (node.type === 'element' && node.tag === 'title')
        return (node.children ?? []).map((child) => child.value ?? '').join('');
      const nested = this.findTitle(node.children ?? []);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  private newId(prefix: string): string {
    return `${prefix}-${this.#instanceId}-${++this.#nextId}`;
  }

  private reconcileIds(
    nodes: readonly DocumentNode[],
    previous: readonly DocumentNode[],
  ): readonly DocumentNode[] {
    const candidates = new Map<string, DocumentNode[]>();
    const fingerprints = new Set<string>();
    const previousStack = [...previous];
    while (previousStack.length) {
      const node = previousStack.pop();
      if (!node) break;
      const fingerprint = this.nodeFingerprint(node);
      const known = candidates.get(fingerprint);
      if (known) known.push(node);
      else candidates.set(fingerprint, [node]);
      previousStack.push(...(node.children ?? []));
    }
    const currentStack = [...nodes];
    while (currentStack.length) {
      const node = currentStack.pop();
      if (!node) break;
      fingerprints.add(this.nodeFingerprint(node));
      currentStack.push(...(node.children ?? []));
    }
    const used = new Set<string>();
    // Identities are only ever marked as used, so each list is read once, from where it stopped.
    const cursors = new Map<string, number>();
    const unused = (fingerprint: string): DocumentNode | undefined => {
      const list = candidates.get(fingerprint);
      if (!list) return undefined;
      let cursor = cursors.get(fingerprint) ?? 0;
      while (cursor < list.length && used.has(list[cursor]?.id ?? '')) cursor++;
      cursors.set(fingerprint, cursor);
      return list[cursor];
    };
    const reconcile = (node: DocumentNode, previousAtPosition?: DocumentNode): DocumentNode => {
      const fingerprint = this.nodeFingerprint(node);
      let candidate = unused(fingerprint);
      if (
        previousAtPosition &&
        this.nodeFingerprint(previousAtPosition) === fingerprint &&
        !used.has(previousAtPosition.id)
      )
        candidate = previousAtPosition;
      if (
        !candidate &&
        previousAtPosition &&
        previousAtPosition.type === node.type &&
        previousAtPosition.tag === node.tag &&
        !used.has(previousAtPosition.id) &&
        !fingerprints.has(this.nodeFingerprint(previousAtPosition))
      ) {
        candidate = previousAtPosition;
      }
      const id = candidate?.id ?? node.id;
      used.add(id);
      return {
        ...node,
        id,
        ...(node.children
          ? {
              children: node.children.map((child, index) =>
                reconcile(child, candidate?.children?.[index]),
              ),
            }
          : {}),
      };
    };
    return nodes.map((node, index) => reconcile(node, previous[index]));
  }

  /**
   * Digest of a subtree, remembered per node object so that matching preserved slices and
   * older identities costs one pass over the tree. It only chooses candidates: whatever is
   * written is still verified against the exact document fingerprint by reparse.
   */
  private nodeFingerprint(node: DocumentNode): string {
    const known = this.#digests.get(node);
    if (known !== undefined) return known;
    const children = (node.children ?? []).map((child) => this.nodeFingerprint(child)).join(',');
    const digest = this.digest(`${JSON.stringify(this.ownStructure(node))}|${children}`);
    this.#digests.set(node, digest);
    return digest;
  }

  /** Two independent 32-bit mixes and the length: enough to pick a candidate, never a proof. */
  private digest(text: string): string {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b) ^ (second >>> 13);
    }
    return `${(first >>> 0).toString(36)}.${(second >>> 0).toString(36)}.${text.length.toString(36)}`;
  }

  private ownStructure(node: DocumentNode): object {
    const attributes =
      node.type === 'doctype'
        ? { publicId: node.attrs?.publicId ?? '', systemId: node.attrs?.systemId ?? '' }
        : (node.attrs ?? {});
    return {
      type: node.type,
      tag: node.tag?.toLowerCase(),
      value: node.type === 'doctype' ? node.value?.toLowerCase() : node.value,
      opener: node.type === 'comment' ? this.commentOpener(node) : undefined,
      attrs: Object.entries(attributes)
        .map(([key, value]) => [node.type === 'doctype' ? key : key.toLowerCase(), value] as const)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
      namespace: node.type === 'element' ? this.namespace(node) : undefined,
    };
  }

  private nodeStructure(node: DocumentNode): object {
    return {
      ...this.ownStructure(node),
      children: (node.children ?? []).map((child) => this.nodeStructure(child)),
    };
  }

  private documentFingerprint(document: EditorDocumentData): string {
    return JSON.stringify({
      kind: document.kind,
      css: document.css,
      nodes: document.nodes.map((node) => this.nodeStructure(node)),
    });
  }

  private remember(
    document: EditorDocumentData,
    source: SourceInput,
    regions: ReadonlyMap<string, SourceRegion>,
    faithful: boolean,
  ): void {
    this.#records.delete(document.id);
    // A cleaned tree is not what the source parses to: the source is never returned whole.
    const fingerprint = faithful ? this.documentFingerprint(document) : undefined;
    const weight =
      source.html.length + source.css.length + (fingerprint?.length ?? source.html.length);
    if (weight > this.#cacheCharacters) {
      this.#exported.delete(document.id);
      return;
    }
    this.#records.set(document.id, { source: { ...source }, fingerprint, regions, weight });
    while (
      this.#records.size > this.#cacheSize ||
      [...this.#records.values()].reduce((sum, record) => sum + record.weight, 0) >
        this.#cacheCharacters
    ) {
      const ids = [...this.#records.keys()];
      const oldest = ids.find((id) => !this.#exported.has(id)) ?? ids[0];
      if (oldest === undefined) break;
      this.#records.delete(oldest);
      this.#exported.delete(oldest);
    }
  }

  private error(code: string): Diagnostic {
    return { code, severity: 'error', messageKey: `diagnostics.${code}` };
  }

  private notice(code: string): Diagnostic {
    return { code, severity: 'info', messageKey: `diagnostics.${code}` };
  }
}
