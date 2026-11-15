import type { EditorSession } from '../application/session';
import type {
  DocumentStyleProperty,
  ImageSizeSettings,
} from '../application/document-presentation';
import type { AssetReference } from '../application/host';
import type { SectionLayoutContext, SectionLayoutPatch } from '../core/section-layout';
import type { ImageLinkContext, ImageLinkOptions } from '../application/image-link';
import type { DocumentKind, SourceInput } from '../core/document';
import { BlockCatalog } from '../core/catalog';
import { CanvasLayout } from '../core/canvas-layout';
import type { CanvasMovementTarget, CanvasPlacement } from '../core/canvas-layout';
import type { TemplateCatalog } from '../templates/catalog';
import type { HtmlAssemblyPort } from '../renderers/preview-document';
import { DocumentOutline } from './outline';
import { UrlPolicy } from '../security/url-policy';
import { BlockEditing } from './session/blocks';
import { MutationGuard } from './session/guard';
import { StructureQueries } from './session/structure';
import type { PropertyCapabilities } from './session/structure';
import { TextEditing } from './session/text';
import { DocumentTransfer } from './session/transfer';

export type EditorViewState = ReturnType<EditorSession['getState']>;

/**
 * Translates presentation actions to application commands; owns no document state. It is the
 * facade the shell and the host know: each group of commands lives in a collaborator of its own
 * (`session/structure`, `text`, `blocks`, `transfer`, `guard`).
 */
export class EditorController {
  private readonly structure: StructureQueries;
  private readonly texts: TextEditing;
  private readonly blockCommands: BlockEditing;
  private readonly transfer: DocumentTransfer;
  private readonly guard: MutationGuard;

  constructor(
    readonly session: EditorSession,
    private readonly templates: TemplateCatalog,
    private readonly assembler: HtmlAssemblyPort,
    private readonly urls: UrlPolicy = new UrlPolicy(),
    /** The catalog and the layout of the editor it serves; its own when used alone. */
    shared: { readonly catalog?: BlockCatalog; readonly layout?: CanvasLayout } = {},
  ) {
    const catalog = shared.catalog ?? new BlockCatalog();
    const layout = shared.layout ?? new CanvasLayout(catalog);
    const outline = new DocumentOutline(urls, catalog, layout);
    this.guard = new MutationGuard(session);
    this.structure = new StructureQueries(session, layout, catalog, outline);
    this.texts = new TextEditing(session, layout, catalog, outline, this.structure);
    this.blockCommands = new BlockEditing(session, layout, templates, this.guard);
    this.transfer = new DocumentTransfer(session, assembler, layout, outline, this.guard);
  }

  state(): EditorViewState {
    return this.session.getState();
  }

  subscribe(listener: (state: EditorViewState) => void): () => void {
    return this.session.subscribe(listener);
  }

  entries() {
    return this.structure.entries();
  }

  canvasRegions() {
    return this.structure.regions();
  }

  resolveSelection(id: string) {
    return this.structure.resolve(id);
  }

  movementTargets(sourceId: string): readonly CanvasMovementTarget[] {
    return this.structure.movementTargets(sourceId);
  }

  /** Where a new block may be dropped, by block and side; the command validates again. */
  insertionTargets(): readonly CanvasMovementTarget[] {
    return this.structure.insertionTargets();
  }

  /** The closest selectable block which contains `id`. */
  parentOf(id: string): string | undefined {
    return this.structure.parentOf(id);
  }

  selected() {
    return this.structure.selected();
  }

  propertyCapabilities(): PropertyCapabilities | undefined {
    return this.structure.propertyCapabilities();
  }

  text() {
    return this.texts.plain();
  }

  richText(): string | undefined {
    const id = this.state().selectedNodeId;
    return id ? this.texts.richTextFor(id) : undefined;
  }

  richTextFor(id: string): string | undefined {
    return this.texts.richTextFor(id);
  }

  richTextAllowsBlocks(): boolean {
    const id = this.state().selectedNodeId;
    return !!id && this.texts.allowsBlocksFor(id);
  }

  richTextAllowsBlocksFor(id: string): boolean {
    return this.texts.allowsBlocksFor(id);
  }

  beginRichText(id: string): boolean {
    return this.select(id) && this.texts.begin(id);
  }

  updateRichTextDraft(html: string): boolean {
    return this.session.updateRichTextDraft(html);
  }

  commitRichText(): boolean {
    return this.session.commitRichText();
  }

  cancelRichText(): void {
    this.session.cancelRichText();
  }

  inlineStyles(id: string): Readonly<Record<string, string>> {
    return this.session.inlineStyles(id);
  }

  style(property: string, fallback = ''): string {
    const id = this.selected()?.id;
    const styles = id ? this.inlineStyles(id) : {};
    const name = property.toLowerCase();
    return Object.hasOwn(styles, name) ? styles[name]! : fallback;
  }

  linkPolicy(): UrlPolicy {
    return this.urls;
  }

  templateList() {
    return this.templates.list(this.state().document.kind);
  }

  async templatePreview(id: string): Promise<string> {
    const kind = this.state().document.kind;
    if (!this.templates.list(kind).some((template) => template.id === id))
      throw new Error('feedback.invalid');
    const source = await this.templates.create(id);
    return this.assembler.build(source, kind, true);
  }

  blocks(kind: DocumentKind): readonly string[] {
    return this.templates.blocks(kind);
  }

  applyTemplate(id: string): Promise<boolean> {
    return this.blockCommands.applyTemplate(id);
  }

  addBlock(
    type: string,
    targetId?: string,
    placement: CanvasPlacement = 'inside',
  ): Promise<boolean> {
    return this.blockCommands.add(type, targetId, placement);
  }

  /** Adds a block at the end of the content, whatever is selected. */
  appendBlock(type: string): Promise<boolean> {
    return this.blockCommands.add(type, undefined, 'inside', true);
  }

  /** Inserts markup next to a block: the paste of a copied block. */
  insertSource(
    source: SourceInput,
    targetId?: string,
    placement: CanvasPlacement = 'after',
  ): boolean {
    return this.blockCommands.insertSource(source, targetId, placement);
  }

  /** Inserts markup at the end of the content, whatever is selected. */
  appendSource(source: SourceInput): boolean {
    return this.blockCommands.insertSource(source, undefined, 'after', true);
  }

  /** Replaces the whole source through the ordinary import: one validated history step. */
  replaceSource(source: SourceInput): boolean {
    return this.blockCommands.replaceSource(source);
  }

  addBlockAt(
    type: string,
    targetId: string,
    placement: CanvasPlacement = 'inside',
  ): Promise<boolean> {
    return this.addBlock(type, targetId, placement);
  }

  setDraft(field: keyof SourceInput, value: string): void {
    const state = this.state();
    this.session.setDraftSource({ ...(state.draftSource ?? state.source), [field]: value });
  }

  applyDraft(): boolean {
    return this.session.commitDraft();
  }

  discardDraft(): void {
    this.session.setDraftSource(this.state().source);
  }

  setMode(mode: 'visual' | 'html'): boolean {
    return this.session.setMode(mode);
  }

  select(id: string): boolean {
    const region = this.resolveSelection(id);
    return !!region && this.session.select(region.id);
  }

  imageSize() {
    const id = this.state().selectedNodeId;
    return id ? this.session.imageSize(id) : undefined;
  }
  updateImageSize(settings: ImageSizeSettings): boolean {
    const id = this.state().selectedNodeId;
    return !!id && this.session.updateImageSize(id, settings);
  }
  /** A resize made on the piece: the stored proportion wins over the measured height. */
  resizeImage(id: string, width: number, height: number): boolean {
    if (!this.guard.prepareMutation()) return false;
    const context = this.session.imageSize(id);
    if (!context) return false;
    return this.session.updateImageSize(
      id,
      context.ratio ? { width, preserveRatio: true } : { width, height },
    );
  }
  documentStyles() {
    return this.session.documentStyles();
  }
  /** Title and, in an e-mail, the preview text shown next to the subject. */
  documentMetadata() {
    return this.session.documentMetadata();
  }
  updateTitle(value: string): boolean {
    return this.session.updateTitle(value);
  }
  updatePreheader(value: string): boolean {
    return this.session.updatePreheader(value);
  }
  updateDocumentStyle(property: DocumentStyleProperty, value: string): boolean {
    return this.session.updateDocumentStyle(property, value);
  }

  updateText(value: string): boolean {
    return this.texts.updatePlain(value);
  }

  updateRichText(value: string): boolean {
    const selected = this.selected();
    return selected ? this.texts.updateRichTextFor(selected.id, value) : false;
  }

  updateRichTextFor(id: string, value: string): boolean {
    return this.texts.updateRichTextFor(id, value);
  }

  updateAttribute(name: string, value: string): boolean {
    const selected = this.selected();
    return selected ? this.session.updateAttribute(selected.node.id, name, value) : false;
  }

  connectFormReference(reference: string, nodeId?: string): boolean {
    return this.blockCommands.connectFormReference(reference, nodeId);
  }

  attachAsset(asset: AssetReference, nodeId?: string): boolean {
    return this.blockCommands.attachAsset(asset, nodeId);
  }

  imageLink(): ImageLinkContext | undefined {
    const selected = this.selected();
    return selected?.node.tag === 'img' ? this.session.imageLink(selected.id) : undefined;
  }

  updateImageLink(href: string, options?: ImageLinkOptions): boolean {
    const selected = this.selected();
    return selected?.node.tag === 'img'
      ? this.session.updateImageLink(selected.id, href, options)
      : false;
  }

  layoutSettings(): SectionLayoutContext | undefined {
    const id = this.state().selectedNodeId;
    return id ? this.session.layoutSettings(id) : undefined;
  }
  async updateLayout(patch: SectionLayoutPatch): Promise<boolean> {
    if (!this.guard.prepareMutation()) return false;
    const id = this.state().selectedNodeId;
    return id ? this.session.updateLayout(id, patch) : false;
  }

  updateStyle(property: string, value: string): boolean {
    const selected = this.selected();
    return selected ? this.session.updateStyle(selected.node.id, property, value) : false;
  }

  duplicate(): boolean {
    const selected = this.selected();
    return selected ? this.applyCanvasAction(selected.id, 'duplicate') : false;
  }

  remove(): boolean {
    const selected = this.selected();
    return selected ? this.applyCanvasAction(selected.id, 'remove') : false;
  }

  move(direction: -1 | 1): boolean {
    const selected = this.selected();
    return !!selected && this.applyCanvasAction(selected.id, direction < 0 ? 'up' : 'down');
  }

  moveTo(sourceId: string, targetId: string, placement: CanvasPlacement): boolean {
    return this.blockCommands.moveTo(sourceId, targetId, placement);
  }

  applyCanvasAction(id: string, action: 'duplicate' | 'remove' | 'up' | 'down'): boolean {
    return this.blockCommands.act(id, action);
  }

  drop(sourceId: string, targetId: string): boolean {
    return this.moveTo(sourceId, targetId, 'before');
  }

  undo(): boolean {
    return this.session.undo();
  }
  redo(): boolean {
    return this.session.redo();
  }

  exportSource(): SourceInput {
    return this.transfer.exportSource();
  }

  exportHtml(): string {
    return this.transfer.exportHtml();
  }

  previewHtml(): string {
    return this.transfer.previewHtml();
  }

  exportJson(): string {
    return this.transfer.exportJson();
  }

  exportRecovery(): string {
    return this.transfer.exportRecovery();
  }

  importFile(file: File): Promise<boolean> {
    return this.transfer.importFile(file);
  }

  importRecovery(value: unknown): boolean {
    return this.transfer.importRecovery(value);
  }
}
