import { DocumentPresentationService } from '../application/document-presentation';
import { DocumentMetadataService } from '../application/document-metadata';
import { BlockCatalog } from '../core/catalog';
import { CanvasLayout } from '../core/canvas-layout';
import { DocumentHistory } from '../core/history';
import type { Diagnostic, DocumentKind, EditorDocumentData, SourceInput } from '../core/document';
import { HtmlDocumentCodec } from '../codecs/html';
import { CssDocumentCodec } from '../codecs/css';
import { ContentPolicy } from '../security/policy';
import { UrlPolicy } from '../security/url-policy';
import { ContentService } from '../application/content-service';
import { DocumentMutationService } from '../application/document-commands';
import { SectionLayoutService } from '../application/section-layout';
import { MjmlSectionScaffold } from '../renderers/section-scaffold';
import { ImageLinkService } from '../application/image-link';
import { SecureIdentifier } from '../security/identity';
import { HostIntegration } from '../application/host';
import type { HostAdapters } from '../application/host';
import { EditorSession } from '../application/session';
import { MjmlEmailRenderer } from '../renderers/email-renderer';
import type { MjmlCompilerPort } from '../renderers/email-renderer';
import { PageRenderer } from '../renderers/page-renderer';
import { HtmlDocumentAssembler } from '../renderers/preview-document';
import { SelectionPreviewRenderer } from '../renderers/selection-preview';
import { TemplateCatalog } from '../templates/catalog';
import { EditorController } from '../vue/controller';

export interface EditorOptions {
  readonly kind?: DocumentKind;
  readonly document?: EditorDocumentData;
  readonly source?: SourceInput;
  readonly readOnly?: boolean;
  readonly persistedRevision?: number;
  readonly host?: HostAdapters;
  readonly compiler?: MjmlCompilerPort;
  readonly exactUrlPlaceholders?: readonly string[];
  readonly previewImageOrigins?: readonly string[];
  /** Receives an exception thrown by a `session.subscribe` listener; the listener stays. */
  readonly onObserverError?: (error: unknown) => void;
}

export interface EditorInstance {
  readonly session: EditorSession;
  readonly controller: EditorController;
  readonly templates: TemplateCatalog;
  readonly pageRenderer: PageRenderer;
  readonly emailRenderer: MjmlEmailRenderer;
  readonly selectionRenderer: SelectionPreviewRenderer;
  dispose(): void;
}

/**
 * The initial source could not become a document. Since the tolerant import this only
 * happens over the limits or with markup no parser reads back the same; `diagnostics`
 * carries the specific code (`DOCUMENT_TOO_LARGE`, `DOCUMENT_TOO_MANY_NODES`...).
 */
export class InitialDocumentError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super('INVALID_INITIAL_DOCUMENT');
    this.name = 'InitialDocumentError';
  }
}

/** The only place that constructs the dependency graph. Every editor owns its state. */
export class EditorFactory {
  constructor(private readonly compilerFactory: () => MjmlCompilerPort & { dispose?(): void }) {}

  create(options: EditorOptions = {}): EditorInstance {
    const compiler = options.compiler ?? this.compilerFactory();
    const catalog = new BlockCatalog();
    // One catalog and one layout for the whole editor: session, preview and controller agree.
    const structure = { catalog, layout: new CanvasLayout(catalog) };
    const urls = new UrlPolicy(
      options.exactUrlPlaceholders ? { exactUrlPlaceholders: options.exactUrlPlaceholders } : {},
    );
    const css = new CssDocumentCodec(urls);
    const policy = new ContentPolicy(urls, css);
    const codec = new HtmlDocumentCodec(policy, catalog);
    const content = new ContentService(codec, policy, css);
    const emailRenderer = new MjmlEmailRenderer(codec, policy, compiler);
    const templates = new TemplateCatalog(emailRenderer);
    // Without a source a document is born with the structure of its kind: an e-mail starts
    // as a generated section with one text, never as a loose paragraph.
    const imported = options.document
      ? undefined
      : content.import(
          options.source ?? templates.blank(options.kind ?? 'page'),
          options.kind ?? 'page',
        );
    const document = options.document ?? imported?.document;
    if (!document) throw new InitialDocumentError(imported?.diagnostics ?? []);
    if (options.kind && options.kind !== document.kind) throw new Error('INITIAL_KIND_MISMATCH');
    const host = new HostIntegration(options.host);
    const session = new EditorSession(
      {
        content,
        mutations: new DocumentMutationService(content, catalog),
        imageLinks: new ImageLinkService(content, urls, new SecureIdentifier()),
        presentation: new DocumentPresentationService(content),
        metadata: new DocumentMetadataService(content, new SecureIdentifier()),
        sectionLayouts: new SectionLayoutService(
          content,
          new SecureIdentifier(),
          new MjmlSectionScaffold(emailRenderer, css),
        ),
        history: new DocumentHistory(),
        host,
      },
      {
        document,
        ...(imported ? { diagnostics: imported.diagnostics } : {}),
        ...(options.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
        ...(options.persistedRevision !== undefined
          ? { persistedRevision: options.persistedRevision }
          : {}),
        ...(options.onObserverError ? { onObserverError: options.onObserverError } : {}),
      },
    );
    const assembler = new HtmlDocumentAssembler(codec, policy, options.previewImageOrigins);
    return Object.freeze({
      session,
      templates,
      emailRenderer,
      selectionRenderer: new SelectionPreviewRenderer(codec, policy, assembler, structure),
      pageRenderer: new PageRenderer(codec, policy),
      controller: new EditorController(session, templates, assembler, urls, structure),
      dispose() {
        session.dispose();
        if (!options.compiler && 'dispose' in compiler && typeof compiler.dispose === 'function')
          compiler.dispose();
      },
    });
  }
}
