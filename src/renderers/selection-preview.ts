import type { DefaultTreeAdapterMap } from 'parse5';
import type { DocumentNode, EditorDocumentData } from '../core/document';
import type { DocumentOutputCodec, DocumentOutputPolicy } from './page-renderer';
import type { HtmlAssemblyPort } from './preview-document';
import { SecureIdentifier } from '../security/identity';
import { CanvasLayout } from '../core/canvas-layout';
import { BlockCatalog } from '../core/catalog';
import { RichTextProjectionRules } from '../rich-text/projection-rules';
import type { CanvasRegion } from '../core/canvas-layout';
import type { SourceInput } from '../core/document';
import { ElementSourceMap } from './element-source';
import { alignElements, canonicalElements, stripReservedAttributes } from './markup-tree';
import {
  EDIT_NODE_ATTRIBUTE,
  NODE_ATTRIBUTE,
  TEXT_ORIGIN_ATTRIBUTE,
  isReservedAttribute,
} from '../core/canvas-contract';
import { PreviewFrameDocument } from './preview-frame';
import type {
  PreviewFrameOptions,
  SelectionPreview,
  SelectionPreviewSource,
} from './preview-frame';
import { MarkedPreviewRenderer } from './marked-preview';
import type { BlockPreviewInput } from './marked-preview';

export {
  framePreview,
  normalizePreviewLanguage,
  previewThemeSchema,
  PREVIEW_FRAMESET,
} from './preview-frame';
export type {
  FramePreviewSource,
  PreviewFrameOptions,
  SelectionPreview,
  SelectionPreviewSource,
} from './preview-frame';
export type { BlockPreviewInput } from './marked-preview';

export interface SelectionPreviewOptions extends PreviewFrameOptions {
  /** Friendly name of each selectable block, in the language of the host shell. */
  readonly describe?: (region: CanvasRegion) => string | undefined;
}

/** Instruments logical regions after validating the complete untrusted document. */
export class SelectionPreviewRenderer implements SelectionPreviewSource<EditorDocumentData> {
  readonly #identifiers = new SecureIdentifier();
  readonly #catalog: BlockCatalog;
  readonly #layout: CanvasLayout;
  readonly #frame: PreviewFrameDocument;
  readonly #rules = new RichTextProjectionRules();
  readonly #sources = new ElementSourceMap();
  /**
   * The previews of block pieces (schema 2). Their markup comes from the generators already
   * marked; this path keeps those marks, only for blocks of the piece and once each, instead
   * of deriving them from an HTML document.
   */
  readonly blocks: SelectionPreviewSource<BlockPreviewInput>;

  constructor(
    private readonly codec: DocumentOutputCodec,
    private readonly policy: DocumentOutputPolicy,
    private readonly assembler: HtmlAssemblyPort,
    /** The catalog and the layout of the editor it serves; its own when used alone. */
    structure: { readonly catalog?: BlockCatalog; readonly layout?: CanvasLayout } = {},
  ) {
    this.#catalog = structure.catalog ?? new BlockCatalog();
    this.#layout = structure.layout ?? new CanvasLayout(this.#catalog);
    this.#frame = new PreviewFrameDocument(assembler);
    this.blocks = new MarkedPreviewRenderer(this.#frame, this.#identifiers);
  }

  /** The markup one element has in the exported source, for editing it as HTML. */
  elementSource(document: EditorDocumentData, id: string): string | undefined {
    return this.#sources.read(document, this.codec.export(document), id);
  }

  /** The exported source with one element replaced; it still has to be imported and validated. */
  replaceElementSource(
    document: EditorDocumentData,
    id: string,
    html: string,
  ): SourceInput | undefined {
    return this.#sources.replace(document, this.codec.export(document), id, html);
  }

  /** A complete preview for a new window: a fresh protocol secret, CSP and the runtime script. */
  build(
    document: EditorDocumentData,
    selectionLabel: string,
    options: SelectionPreviewOptions = {},
  ): SelectionPreview {
    return this.render(document, selectionLabel, options, this.#identifiers.next(), true);
  }

  /**
   * The next revision for a window which is already running: same secret, no script. The frame
   * runtime reconciles this markup over what it shows instead of reloading.
   */
  update(
    document: EditorDocumentData,
    selectionLabel: string,
    current: Pick<SelectionPreview, 'nonce'>,
    options: SelectionPreviewOptions = {},
  ): SelectionPreview {
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(current.nonce)) throw new Error('INVALID_PREVIEW_NONCE');
    return this.render(document, selectionLabel, options, current.nonce, false);
  }

  private render(
    document: EditorDocumentData,
    selectionLabel: string,
    options: SelectionPreviewOptions,
    token: string,
    executable: boolean,
  ): SelectionPreview {
    this.policy.assertSafe(document);
    const originIds = new Set<string>();
    const origins = (node: DocumentNode): void => {
      for (const child of node.children ?? []) {
        if (child.type !== 'element') continue;
        if (this.#rules.needsOrigin(child.tag ?? '', Object.keys(child.attrs ?? {})))
          originIds.add(child.id);
        origins(child);
      }
    };
    const regions = this.#layout.selectionRegions(document).map((region) => {
      if (region.editable) origins(region.node);
      const label = options.describe?.(region)?.trim().slice(0, 80);
      return Object.freeze({
        ...(label ? { label } : {}),
        ...(region.node.tag === 'img' ? { media: 'image' as const } : {}),
        id: region.id,
        parentId: region.parentId,
        editable: region.editable,
        container: region.container,
        ...(region.editable
          ? {
              blocks: this.#catalog.richTextAllowsBlocks(region.node),
              links: region.kind !== 'button',
            }
          : {}),
      });
    });
    const editIds = new Set(regions.flatMap((region) => (region.editable ? [region.id] : [])));
    const regionIds = new Set(regions.map((region) => region.id));
    const ids: string[] = [];
    const structure = canonicalElements(document.nodes);
    const source = this.codec.export(document);
    const opened = this.#frame.open(source, document.kind, selectionLabel, options);
    const parsed = opened.parsed;
    const paired = alignElements(parsed, structure, {
      // Nothing the document wrote may pass for a mark of the editor, wherever it is kept.
      element: (node) => {
        if (node.attrs.some((attribute) => isReservedAttribute(attribute.name)))
          node.attrs = node.attrs.filter((attribute) => !isReservedAttribute(attribute.name));
        if (node.tagName === 'template' && 'content' in node)
          stripReservedAttributes((node as DefaultTreeAdapterMap['template']).content);
      },
      match: (node, canonical, island) => {
        if (originIds.has(canonical.id))
          node.attrs.push({ name: TEXT_ORIGIN_ATTRIBUTE, value: canonical.id });
        if (editIds.has(canonical.id))
          node.attrs.push({ name: EDIT_NODE_ATTRIBUTE, value: canonical.id });
        // An inline SVG or MathML island is one node of the document, kept as source.
        if (island)
          for (const child of node.childNodes)
            if ('tagName' in child) stripReservedAttributes(child);
        if (!regionIds.has(canonical.id)) return;
        ids.push(canonical.id);
        node.attrs = node.attrs.filter((attribute) => attribute.name !== 'tabindex');
        node.attrs.push(
          { name: NODE_ATTRIBUTE, value: canonical.id },
          { name: 'tabindex', value: '0' },
        );
        if (!node.attrs.some((attribute) => attribute.name === 'title'))
          node.attrs.push({ name: 'title', value: selectionLabel });
      },
    });
    if (paired !== structure.length) throw new Error('PREVIEW_MAPPING_FAILED');
    return this.#frame.close(
      opened,
      { revision: document.revision, regions, nodeIds: ids, token, executable },
      options,
    );
  }
}
