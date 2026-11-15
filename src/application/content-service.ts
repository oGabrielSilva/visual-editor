import { EditorDocument } from '../core/document';
import type { RichTextDecorationLine } from '../core/rich-text-format';
import type {
  Diagnostic,
  DocumentKind,
  DocumentNode,
  EditorDocumentData,
  ImportResult,
  SourceInput,
} from '../core/document';

export interface CodecPort {
  import(source: SourceInput, kind: DocumentKind, previous?: EditorDocumentData): ImportResult;
  export(document: EditorDocumentData | EditorDocument): SourceInput;
  /** Auxiliary parse which must not replace the preserved source of an edited document. */
  inspect?(source: SourceInput, kind: DocumentKind): ImportResult;
}

export interface PolicyPort {
  validate(document: EditorDocumentData | EditorDocument): readonly Diagnostic[];
  assertSafe(document: EditorDocumentData | EditorDocument): void;
  /** Whether editor commands may write these nodes; stricter than what an import keeps. */
  writable?(nodes: readonly DocumentNode[]): boolean;
  /** Applies the removals of the document kind and says, grouped, what was removed. */
  sanitize?(document: EditorDocumentData | EditorDocument): AdmittedDocumentData;
}

export interface AdmittedDocumentData {
  readonly document: EditorDocumentData;
  readonly diagnostics: readonly Diagnostic[];
}

export interface AdmittedDocument {
  readonly document: EditorDocument;
  readonly diagnostics: readonly Diagnostic[];
}

export interface InlineStylePort {
  setDeclaration(css: string, property: string, value: string): string;
  readDeclarations?(css: string): Readonly<Record<string, string>>;
  removeDeclarations?(css: string, properties: readonly string[]): string;
  prependDefaults(existing: string, incoming: readonly string[]): string;
  richTextStyles?(css: string): Readonly<Record<string, string>> | undefined;
  removeDecoration?(css: string, line: RichTextDecorationLine): string;
  hasDecorationRules?(css: string): boolean;
}

export class ContentService {
  constructor(
    private readonly codec: CodecPort,
    private readonly policy: PolicyPort,
    private readonly styles: InlineStylePort,
  ) {}

  import(source: SourceInput, kind: DocumentKind, previous?: EditorDocumentData): ImportResult {
    return this.codec.import(source, kind, previous);
  }

  /** Imports a snippet or projection which never becomes the session document by itself. */
  inspect(source: SourceInput, kind: DocumentKind): ImportResult {
    return this.codec.inspect ? this.codec.inspect(source, kind) : this.codec.import(source, kind);
  }

  validate(document: EditorDocumentData | EditorDocument): readonly Diagnostic[] {
    return this.policy.validate(document);
  }

  setStyle(css: string, property: string, value: string): string {
    return this.styles.setDeclaration(css, property, value);
  }

  withoutStyles(css: string, properties: readonly string[]): string {
    if (!this.styles.removeDeclarations) throw new Error('UNSUPPORTED_LAYOUT_STYLE');
    return this.styles.removeDeclarations(css, properties);
  }

  inlineDeclarations(css: string): Readonly<Record<string, string>> {
    if (!this.styles.readDeclarations) throw new Error('UNSUPPORTED_STYLE_INSPECTION');
    return this.styles.readDeclarations(css);
  }

  richTextStyles(css: string): Readonly<Record<string, string>> | undefined {
    return this.styles.richTextStyles?.(css);
  }

  removeDecoration(css: string, line: RichTextDecorationLine): string {
    if (!this.styles.removeDecoration) throw new Error('Unsupported text decoration change');
    return this.styles.removeDecoration(css, line);
  }

  hasDecorationRules(css: string): boolean {
    if (!this.styles.hasDecorationRules) throw new Error('Unsupported text decoration context');
    return this.styles.hasDecorationRules(css);
  }

  mergeRichTextStyle(existing: string, incoming: string): string {
    const declarations = this.richTextStyles(incoming);
    if (!declarations) throw new Error('Unsafe rich text style');
    return Object.entries(declarations).reduce(
      (css, [property, value]) => this.setStyle(css, property, value),
      existing,
    );
  }

  addDefaultStyles(css: string, incoming: readonly string[]): string {
    return this.styles.prependDefaults(css, incoming);
  }

  /**
   * Entry of a document which did not come from this session: host JSON, a file, a backup.
   * It follows the same rules as imported source. An e-mail which still carries scripts,
   * embeds, handlers or code URLs has them removed and reported, never silently accepted.
   */
  admit(input: unknown): AdmittedDocument {
    const candidate = EditorDocument.from(input);
    const admitted = this.policy.sanitize?.(candidate);
    if (admitted?.diagnostics.length)
      return { document: this.document(admitted.document), diagnostics: admitted.diagnostics };
    this.policy.assertSafe(candidate);
    return { document: candidate, diagnostics: [] };
  }

  /**
   * Markup produced by a command or returned by the editing frame is held to the strict
   * rule, whatever the document kind keeps from an import.
   */
  assertWritable(nodes: readonly DocumentNode[]): void {
    if (this.policy.writable && !this.policy.writable(nodes))
      throw new Error('Unsafe authored markup');
  }

  document(input: unknown): EditorDocument {
    const document = EditorDocument.from(input);
    this.policy.assertSafe(document);
    return document;
  }

  export(document: EditorDocumentData | EditorDocument): SourceInput {
    this.policy.assertSafe(document);
    return this.codec.export(document);
  }

  /**
   * Source and notices of a document about to become the current one, validated once here
   * (the codec asserts the policy again and verifies its output by reparse).
   */
  render(document: EditorDocument): {
    readonly source: SourceInput;
    readonly diagnostics: readonly Diagnostic[];
  } {
    const diagnostics = this.policy.validate(document);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error'))
      throw new Error('UNSAFE_DOCUMENT');
    return { source: this.codec.export(document), diagnostics };
  }
}
