import * as v from 'valibot';
import { DocumentBudget, DocumentBudgetError } from './budget';
import { HtmlContentModel } from './html-content-model';
import type { HtmlNodeType } from './html-content-model';

export type DocumentKind = 'email' | 'page';
export type EditorMode = 'visual' | 'html';

export interface NodeMetadata {
  readonly blockType?: string;
  readonly sourceStart?: number;
  readonly sourceEnd?: number;
  readonly namespace?: string;
  /**
   * How a comment was written: `<!--` for a regular comment, or the opener of the bogus
   * comment the parser read (`<![if !mso]>`, `<?xml ... ?>`, `</3>`). Absent on old documents.
   */
  readonly commentOpener?: CommentOpener;
}

export type CommentOpener = '<!--' | '<!' | '<?' | '</';

export interface DocumentNode {
  readonly id: string;
  readonly type: HtmlNodeType;
  readonly tag?: string;
  readonly value?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly children?: readonly DocumentNode[];
  readonly metadata?: NodeMetadata;
}

export interface EditorDocumentData {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly kind: DocumentKind;
  readonly revision: number;
  readonly title: string;
  readonly nodes: readonly DocumentNode[];
  readonly css: string;
}

export interface SourceInput {
  readonly html: string;
  readonly css: string;
}

/**
 * `error` refuses the operation. `warning` tells the author something was removed or
 * rewritten. `info` describes what the document holds and was kept as written.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly messageKey: string;
  /** First node the notice refers to, when it still exists in the document. */
  readonly nodeId?: string;
  /** Occurrences grouped under this code; absent means one. */
  readonly count?: number;
}

export interface ImportResult {
  readonly document?: EditorDocumentData;
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The validated aggregate `document` was read from, when the codec has it: a policy given it
   * checks the content again without parsing the schema a second time.
   */
  readonly validated?: EditorDocument;
}

export const DOCUMENT_LIMITS = DocumentBudget.limits;

/** Every element the HTML parser and serializer treat as void, obsolete ones included. */
export const HTML_VOID_ELEMENTS: readonly string[] = Object.freeze([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const metadataSchema = v.strictObject({
  blockType: v.exactOptional(v.pipe(v.string(), v.maxLength(64))),
  sourceStart: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  sourceEnd: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  namespace: v.exactOptional(v.pipe(v.string(), v.maxLength(200))),
  commentOpener: v.exactOptional(v.picklist(['<!--', '<!', '<?', '</'])),
});

export const DocumentNodeSchema: v.GenericSchema<DocumentNode> = v.lazy(() =>
  v.strictObject({
    id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
    type: v.picklist(['element', 'text', 'comment', 'doctype']),
    tag: v.exactOptional(v.pipe(v.string(), v.maxLength(200))),
    value: v.exactOptional(v.pipe(v.string(), v.maxLength(DOCUMENT_LIMITS.sourceBytes))),
    attrs: v.exactOptional(
      v.record(
        v.pipe(v.string(), v.maxLength(200)),
        v.pipe(v.string(), v.maxLength(DOCUMENT_LIMITS.documentAttributeLength)),
      ),
    ),
    children: v.exactOptional(v.array(DocumentNodeSchema)),
    metadata: v.exactOptional(metadataSchema),
  }),
);

export const EditorDocumentSchema: v.GenericSchema<EditorDocumentData> = v.strictObject({
  schemaVersion: v.literal(1),
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  kind: v.picklist(['email', 'page']),
  revision: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER)),
  title: v.pipe(v.string(), v.maxLength(1_000)),
  nodes: v.array(DocumentNodeSchema),
  css: v.pipe(v.string(), v.maxLength(DOCUMENT_LIMITS.cssBytes)),
});

export class DocumentValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DocumentValidationError';
  }
}

/** The aggregate owns a validated snapshot. Callers only receive independent copies. */
export class EditorDocument {
  readonly #data: EditorDocumentData;
  #bytes: number | undefined;

  private constructor(data: EditorDocumentData) {
    this.#data = this.clone(data);
  }

  static from(data: unknown): EditorDocument {
    EditorDocument.assertBounded(data);
    const result = v.safeParse(EditorDocumentSchema, data);
    if (!result.success) throw new DocumentValidationError('INVALID_DOCUMENT_SCHEMA');
    EditorDocument.assertTree(result.output.nodes);
    return new EditorDocument({
      ...result.output,
      nodes: EditorDocument.normalizeText(result.output.nodes),
    });
  }

  get id(): string {
    return this.#data.id;
  }
  get kind(): DocumentKind {
    return this.#data.kind;
  }
  get revision(): number {
    return this.#data.revision;
  }

  snapshot(): EditorDocumentData {
    return this.clone(this.#data);
  }

  withChanges(
    change: Partial<Pick<EditorDocumentData, 'title' | 'nodes' | 'css'>>,
  ): EditorDocument {
    return EditorDocument.from({ ...this.#data, ...change, revision: this.#data.revision + 1 });
  }

  /** UTF-8 size of the serialized snapshot, for budgets which bound what is retained. */
  serializedBytes(): number {
    this.#bytes ??= new DocumentBudget().byteLength(JSON.stringify(this.#data));
    return this.#bytes;
  }

  /** Only the revision changes: the validated tree is not parsed a second time. */
  withRevision(revision: number): EditorDocument {
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new DocumentValidationError('INVALID_DOCUMENT_SCHEMA');
    return new EditorDocument({ ...this.#data, revision });
  }

  private clone(data: EditorDocumentData): EditorDocumentData {
    return structuredClone(data);
  }

  private static assertBounded(data: unknown): void {
    try {
      new DocumentBudget().assertInput(data);
    } catch (error: unknown) {
      throw new DocumentValidationError(
        error instanceof DocumentBudgetError ? error.code : 'INVALID_DOCUMENT_SCHEMA',
      );
    }
  }

  private static normalizeText(nodes: readonly DocumentNode[]): readonly DocumentNode[] {
    const normalized: DocumentNode[] = [];
    for (const node of nodes) {
      if (node.type === 'text' && node.value === '') continue;
      const previous = normalized.at(-1);
      if (node.type === 'text' && previous?.type === 'text') {
        const value = (previous.value ?? '') + (node.value ?? '');
        if (value.length > DOCUMENT_LIMITS.sourceBytes)
          throw new DocumentValidationError('DOCUMENT_TOO_LARGE');
        normalized[normalized.length - 1] = { id: previous.id, type: 'text', value };
      } else {
        normalized.push(
          node.children ? { ...node, children: this.normalizeText(node.children) } : node,
        );
      }
    }
    return normalized;
  }

  private static assertTree(nodes: readonly DocumentNode[]): void {
    const seen = new Set<string>();
    const model = new HtmlContentModel();
    const budget = new DocumentBudget();
    let counted = 0;
    const stack: { node: DocumentNode; depth: number; parent?: string }[] = nodes.map((node) => ({
      node,
      depth: 0,
    }));
    while (stack.length) {
      const frame = stack.pop();
      if (!frame) break;
      if (frame.depth > DOCUMENT_LIMITS.depth)
        throw new DocumentValidationError('DOCUMENT_TOO_DEEP');
      if (seen.has(frame.node.id)) throw new DocumentValidationError('DUPLICATE_NODE_ID');
      seen.add(frame.node.id);
      if (budget.countable(frame.node)) counted++;
      if (counted > DOCUMENT_LIMITS.nodes || seen.size > DOCUMENT_LIMITS.totalNodes)
        throw new DocumentValidationError('DOCUMENT_TOO_MANY_NODES');
      if (!model.parses(frame.parent, frame.node))
        throw new DocumentValidationError('INVALID_HTML_CONTENT_MODEL');
      if (Object.keys(frame.node.attrs ?? {}).length > DOCUMENT_LIMITS.attributesPerNode) {
        throw new DocumentValidationError('TOO_MANY_ATTRIBUTES');
      }
      const attributes = Object.keys(frame.node.attrs ?? {}).map((name) => name.toLowerCase());
      if (new Set(attributes).size !== attributes.length)
        throw new DocumentValidationError('AMBIGUOUS_HTML_ATTRIBUTES');
      if (frame.node.type === 'element') {
        if (!frame.node.tag || frame.node.value !== undefined)
          throw new DocumentValidationError('INVALID_ELEMENT');
        if (
          HTML_VOID_ELEMENTS.includes(frame.node.tag.toLowerCase()) &&
          frame.node.children?.length
        )
          throw new DocumentValidationError('VOID_ELEMENT_CHILDREN');
        // Their content is source text; a subtree there could not be written back as read.
        if (
          model.holdsSource(frame.node.tag) &&
          frame.node.children?.some((child) => child.type !== 'text')
        )
          throw new DocumentValidationError('INVALID_SOURCE_ELEMENT');
      } else if (
        frame.node.tag !== undefined ||
        frame.node.children?.length ||
        frame.node.value === undefined
      ) {
        throw new DocumentValidationError('INVALID_LEAF');
      }
      for (const node of frame.node.children ?? [])
        stack.push({
          node,
          depth: frame.depth + 1,
          ...(frame.node.tag ? { parent: frame.node.tag } : {}),
        });
    }
  }
}
