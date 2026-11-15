import { BlockDocument } from '../core/block-document';
import type { BlockDocumentData } from '../core/block-document';
import { parseAnyDocument } from '../core/any-document';
import type { AnyDocument } from '../core/any-document';
import type { DocumentKind, EditorDocumentData, SourceInput } from '../core/document';
import { DocumentHistory } from '../core/history';
import { BlockEditorSession } from '../application/block-session';
import type { BlockStorePort } from '../application/block-session';
import { BlockPlacementService } from '../application/block-placement';
import { BlockContentGuard } from '../blocks/content-guard';
import { BlockDefinitionRegistry } from '../blocks/definitions';
import { BlockMjmlGenerator } from '../blocks/email-generator';
import { BlockEmailRenderer } from '../blocks/email-renderer';
import { BlockPageGenerator } from '../blocks/page-generator';
import { BlockOutputRenderer } from '../blocks/block-output';
import { BlockInspector } from '../blocks/block-inspector';
import { BlockToHtmlConversion } from '../blocks/conversion';
import type { OutputMode } from '../blocks/block-type';
import { HtmlDocumentCodec } from '../codecs/html';
import { CssDocumentCodec } from '../codecs/css';
import type { GeneratedMjml, GeneratedMjmlCompilerPort } from '../compilation/generated-mjml';
import { CompileLanes } from '../compilation/compile-lanes';
import type { MjmlCompilerPort } from '../renderers/email-renderer';
import { HtmlDocumentAssembler } from '../renderers/preview-document';
import { SelectionPreviewRenderer } from '../renderers/selection-preview';
import { ContentPolicy } from '../security/policy';
import { SecureIdentifier } from '../security/identity';
import { UrlPolicy } from '../security/url-policy';
import { BlockTemplateCatalog } from '../templates/blocks/catalog';
import { BlockEditorController } from '../vue/block-controller';

/** A compiler of both kinds of MJML; the browser and the Node compilers are. */
export type BlockCompiler = MjmlCompilerPort & GeneratedMjmlCompilerPort & { dispose?(): void };

export interface BlockToolkitOptions {
  /** A compiler the host owns; otherwise the toolkit creates one and disposes of it. */
  readonly compiler?: BlockCompiler;
  /** Placeholders accepted as whole link addresses, e.g. `{{unsubscribe_url}}`. */
  readonly exactUrlPlaceholders?: readonly string[];
}

/**
 * What a host needs of block pieces (schema 2) without the editor: validate what it stores,
 * generate and compile the output, and convert a piece to the HTML document (schema 1).
 */
export interface BlockToolkit {
  readonly registry: BlockDefinitionRegistry;
  readonly templates: BlockTemplateCatalog;
  /** A stored piece of either schema; throws `DocumentValidationError` (or a subclass). */
  parse(input: unknown): AnyDocument;
  /** A block piece; throws `BlockDocumentError`. */
  parseBlocks(input: unknown): BlockDocument;
  /** A new piece of a kind, blank or from a template, with fresh block ids. */
  /**
   * A new piece from a template (the blank one by default), with the texts in `language`
   * (pt-BR by default; English and Spanish are written too).
   */
  create(
    kind: DocumentKind,
    documentId: string,
    templateId?: string,
    language?: string,
  ): BlockDocument;
  /** The HTML and CSS of a page piece. */
  generatePage(document: BlockDocument, mode?: OutputMode): SourceInput;
  /** The MJML of an e-mail piece, with the raw regions only the compilers accept. */
  generateMjml(document: BlockDocument, mode?: OutputMode): GeneratedMjml;
  /** The compiled HTML of an e-mail piece, checked against the e-mail rules. */
  compileEmail(document: BlockDocument): Promise<SourceInput>;
  /** The final output of a piece of either kind: what is stored, sent or published. */
  render(document: BlockDocument): Promise<SourceInput>;
  /** "Convert to editable HTML": one way only, to a schema 1 document. */
  convert(document: BlockDocument): Promise<EditorDocumentData>;
  dispose(): void;
}

export interface BlockEditorOptions extends BlockToolkitOptions {
  readonly kind?: DocumentKind;
  /** A stored piece (schema 2); validated here. */
  readonly document?: BlockDocumentData;
  /** The template a new piece starts from; the blank one of its kind by default. */
  readonly template?: string;
  /** Language of the texts of a new piece and of the templates applied to it. */
  readonly language?: string;
  /** Id of a new piece. */
  readonly documentId?: string;
  readonly readOnly?: boolean;
  readonly persistedRevision?: number;
  readonly store?: BlockStorePort;
  readonly previewImageOrigins?: readonly string[];
  readonly onObserverError?: (error: unknown) => void;
}

export interface BlockEditorInstance {
  readonly session: BlockEditorSession;
  readonly controller: BlockEditorController;
  readonly selectionRenderer: SelectionPreviewRenderer;
  readonly toolkit: BlockToolkit;
  dispose(): void;
}

interface Parts {
  readonly toolkit: BlockToolkit;
  readonly urls: UrlPolicy;
  readonly codec: HtmlDocumentCodec;
  readonly policy: ContentPolicy;
  readonly output: BlockOutputRenderer;
}

/** The only place that builds the graph of block pieces; every instance owns its state. */
export class BlockEditorFactory {
  constructor(private readonly compilerFactory: () => BlockCompiler) {}

  toolkit(options: BlockToolkitOptions = {}): BlockToolkit {
    return this.parts(options).toolkit;
  }

  create(options: BlockEditorOptions = {}): BlockEditorInstance {
    const { toolkit, urls, codec, policy, output } = this.parts(options);
    const identifiers = new SecureIdentifier();
    const kind = options.kind ?? options.document?.kind ?? 'page';
    const document = options.document
      ? toolkit.parseBlocks(options.document)
      : toolkit.create(
          kind,
          options.documentId ?? `piece-${identifiers.next()}`,
          options.template,
          options.language,
        );
    if (document.kind !== kind) throw new Error('INITIAL_KIND_MISMATCH');
    const session = new BlockEditorSession(
      {
        factory: toolkit.registry,
        output: { render: (piece) => toolkit.render(piece) },
        identifiers,
        history: new DocumentHistory<BlockDocument>(),
        ...(options.store ? { store: options.store } : {}),
      },
      {
        document,
        ...(options.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
        ...(options.persistedRevision !== undefined
          ? { persistedRevision: options.persistedRevision }
          : {}),
        ...(options.onObserverError ? { onObserverError: options.onObserverError } : {}),
      },
    );
    const controller = new BlockEditorController({
      session,
      registry: toolkit.registry,
      inspector: new BlockInspector(toolkit.registry),
      placement: new BlockPlacementService(toolkit.registry),
      templates: toolkit.templates,
      output,
      urls,
    });
    const assembler = new HtmlDocumentAssembler(codec, policy, options.previewImageOrigins);
    return Object.freeze({
      session,
      controller,
      toolkit,
      selectionRenderer: new SelectionPreviewRenderer(codec, policy, assembler),
      dispose() {
        session.dispose();
        toolkit.dispose();
      },
    });
  }

  private static ofKind(document: BlockDocument, kind: DocumentKind): BlockDocument {
    if (document.kind !== kind) throw new Error('BLOCK_KIND_MISMATCH');
    return document;
  }

  private parts(options: BlockToolkitOptions): Parts {
    const compiler = options.compiler ?? this.compilerFactory();
    const urls = new UrlPolicy(
      options.exactUrlPlaceholders ? { exactUrlPlaceholders: options.exactUrlPlaceholders } : {},
    );
    const css = new CssDocumentCodec(urls);
    const policy = new ContentPolicy(urls, css);
    const codec = new HtmlDocumentCodec(policy);
    const registry = new BlockDefinitionRegistry(new BlockContentGuard(urls));
    const mjml = new BlockMjmlGenerator(registry);
    const pages = new BlockPageGenerator(registry);
    // The preview of every revision and the save share the compiler without taking each other's
    // place: previews run one at a time (the newest waiting), the final output in its own lane.
    const lanes = new CompileLanes(compiler);
    const emails = new BlockEmailRenderer(mjml, lanes.final);
    const output = new BlockOutputRenderer(
      registry,
      pages,
      emails,
      new BlockEmailRenderer(mjml, lanes.preview),
    );
    const conversion = new BlockToHtmlConversion(codec, emails, pages);
    const templates = new BlockTemplateCatalog(registry);
    const identifiers = new SecureIdentifier();
    const nextId = (): string => `b${identifiers.next().slice(0, 20)}`;
    const toolkit: BlockToolkit = Object.freeze({
      registry,
      templates,
      parse: (input: unknown) => parseAnyDocument(input, registry),
      parseBlocks: (input: unknown) => BlockDocument.from(input, registry),
      create: (kind: DocumentKind, documentId: string, templateId?: string, language?: string) =>
        templateId
          ? templates.create(templateId, documentId, nextId, kind, language)
          : templates.blank(kind, documentId, nextId, language),
      generatePage: (document: BlockDocument, mode: OutputMode = 'final') =>
        pages.toHtml(BlockEditorFactory.ofKind(document, 'page'), mode),
      generateMjml: (document: BlockDocument, mode: OutputMode = 'final') =>
        mjml.toMjml(BlockEditorFactory.ofKind(document, 'email'), mode),
      compileEmail: (document: BlockDocument) =>
        emails.render(BlockEditorFactory.ofKind(document, 'email'), 'final'),
      render: (document: BlockDocument) => output.render(document),
      convert: (document: BlockDocument) => conversion.convert(document),
      dispose: () => {
        if (!options.compiler) compiler.dispose?.();
      },
    });
    return { toolkit, urls, codec, policy, output };
  }
}
