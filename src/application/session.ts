import { EditorDocument } from '../core/document';
import { DocumentPresentationService } from './document-presentation';
import { DocumentMetadataService } from './document-metadata';
import type { DocumentMetadata } from './document-metadata';
import type { DocumentStyleProperty, ImageSizeSettings } from './document-presentation';
import type {
  Diagnostic,
  DocumentNode,
  EditorDocumentData,
  EditorMode,
  SourceInput,
} from '../core/document';
import { DocumentHistory } from '../core/history';
import { DocumentBudget } from '../core/budget';
import type { BlockType } from '../core/catalog';
import { ContentService } from './content-service';
import { DocumentMutationService } from './document-commands';
import type { InsertionSource } from './document-commands';
import { SectionLayoutService } from './section-layout';
import type { SectionLayoutContext, SectionLayoutPatch } from '../core/section-layout';
import { ImageLinkService } from './image-link';
import type { ImageLinkContext, ImageLinkOptions } from './image-link';
import { HostIntegration } from './host';
import type { AssetReference } from './host';

export interface PendingRichTextDraft {
  readonly id: string;
  readonly html: string;
  readonly originalHtml: string;
  readonly changed: boolean;
  readonly valid: boolean;
  readonly blocked?: 'oversized';
  readonly documentId: string;
  readonly baseRevision: number;
  readonly editGeneration: number;
}

export interface EditorState {
  readonly document: EditorDocumentData;
  readonly mode: EditorMode;
  readonly source: SourceInput;
  readonly draftSource: SourceInput;
  readonly diagnostics: readonly Diagnostic[];
  readonly selectedNodeId: string | undefined;
  readonly pendingRichText?: PendingRichTextDraft;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly readOnly: boolean;
  readonly readonly: boolean;
  readonly dirty: boolean;
  readonly editGeneration: number;
}

export interface SessionOptions {
  readonly document: EditorDocumentData;
  /** Notices of the import which produced the initial document, e.g. what was removed. */
  readonly diagnostics?: readonly Diagnostic[];
  readonly readOnly?: boolean;
  readonly persistedRevision?: number;
  readonly onObserverError?: (error: unknown) => void;
}
export interface SessionServices {
  readonly content: ContentService;
  readonly mutations: DocumentMutationService;
  readonly imageLinks: ImageLinkService;
  readonly presentation?: DocumentPresentationService;
  readonly metadata?: DocumentMetadataService;
  readonly sectionLayouts?: SectionLayoutService;
  readonly history: DocumentHistory;
  readonly host: HostIntegration;
}

export class EditorSession {
  #document: EditorDocument;
  #mode: EditorMode = 'visual';
  #draft: SourceInput;
  #source: SourceInput;
  #diagnostics: readonly Diagnostic[] = [];
  #selection: string | undefined;
  #pendingRichText: PendingRichTextDraft | undefined;
  #disposed = false;
  #revision: number;
  #persistedRevision: number;
  #savedDocumentRevision: number;
  #saving = false;
  #readOnly: boolean;
  #editGeneration = 0;
  #listeners = new Set<(state: EditorState) => void>();
  #emitting = false;
  #emitQueued = false;

  constructor(
    private readonly services: SessionServices,
    private readonly options: SessionOptions,
  ) {
    const admitted = services.content.admit(options.document);
    this.#document = admitted.document;
    this.#diagnostics = this.notices(
      [...(options.diagnostics ?? []), ...admitted.diagnostics],
      services.content.validate(this.#document.snapshot()),
    );
    this.#readOnly = options.readOnly ?? false;
    this.#revision = this.#document.revision;
    this.#persistedRevision = options.persistedRevision ?? this.#revision;
    this.#savedDocumentRevision = this.#revision;
    this.#source = services.content.export(this.#document);
    this.#draft = { ...this.#source };
    services.history.reset(this.#document);
  }

  getState(): EditorState {
    this.assertActive();
    return Object.freeze({
      document: this.#document.snapshot(),
      mode: this.#mode,
      source: this.exportSource(),
      draftSource: { ...this.#draft },
      diagnostics: structuredClone(this.#diagnostics),
      selectedNodeId: this.#selection,
      ...(this.#pendingRichText ? { pendingRichText: { ...this.#pendingRichText } } : {}),
      canUndo:
        this.services.history.canUndo ||
        !!(this.#pendingRichText?.changed && this.#pendingRichText.valid),
      canRedo: this.services.history.canRedo && !this.#pendingRichText?.changed,
      readOnly: this.#readOnly,
      readonly: this.#readOnly,
      dirty:
        this.#revision !== this.#savedDocumentRevision ||
        this.hasPendingDraft() ||
        !!this.#pendingRichText?.changed,
      editGeneration: this.#editGeneration,
    });
  }

  snapshot(): EditorDocumentData {
    this.assertActive();
    return this.#document.snapshot();
  }
  exportSource(): SourceInput {
    this.assertActive();
    return { ...this.#source };
  }

  setReadOnly(value: boolean): void {
    this.assertActive();
    if (typeof value !== 'boolean') throw new TypeError('INVALID_READ_ONLY');
    if (value === this.#readOnly) return;
    this.#readOnly = value;
    this.#editGeneration++;
    if (this.#pendingRichText)
      this.#pendingRichText = { ...this.#pendingRichText, editGeneration: this.#editGeneration };
    this.emit();
  }

  subscribe(listener: (state: EditorState) => void): () => void {
    this.assertActive();
    this.#listeners.add(listener);
    this.notify(listener);
    return () => this.#listeners.delete(listener);
  }

  select(id: string | undefined): boolean {
    this.assertActive();
    if (id && !this.find(this.#document.snapshot().nodes, id)) return false;
    if (id !== this.#selection && !this.commitRichText()) return false;
    this.#selection = id;
    this.emit();
    return true;
  }

  setDraftSource(source: SourceInput): void {
    if (!this.canWrite() || !this.commitRichText()) return;
    this.#editGeneration++;
    this.#draft = { ...source };
    this.#diagnostics = [];
    this.emit();
  }

  commitDraft(): boolean {
    return this.importSource(this.#draft);
  }

  importSource(source: SourceInput): boolean {
    if (!this.canWrite() || !this.commitRichText()) return false;
    if (source.html === this.#source.html && source.css === this.#source.css) {
      this.#draft = { ...source };
      this.#diagnostics = [];
      this.#editGeneration++;
      this.emit();
      return true;
    }
    this.#draft = { ...source };
    this.#editGeneration++;
    try {
      const imported = this.services.content.import(
        source,
        this.#document.kind,
        this.#document.snapshot(),
      );
      this.#diagnostics = imported.diagnostics;
      if (!imported.document || imported.diagnostics.some((item) => item.severity === 'error')) {
        this.emit();
        return false;
      }
      this.commit(
        this.services.content.document(imported.document),
        true,
        false,
        imported.diagnostics,
      );
      return true;
    } catch {
      return this.fail('IMPORT_INVALID', 'diagnostics.invalidDocument');
    }
  }

  importJson(input: unknown): boolean {
    if (!this.canWrite() || !this.commitRichText()) return false;
    try {
      const { document, diagnostics } = this.services.content.admit(input);
      if (document.kind !== this.#document.kind)
        return this.fail('KIND_MISMATCH', 'diagnostics.kindMismatch');
      this.commit(document, true, false, diagnostics);
      return true;
    } catch {
      return this.fail('IMPORT_INVALID', 'diagnostics.invalidDocument');
    }
  }

  setMode(mode: EditorMode): boolean {
    this.assertActive();
    if (mode !== 'html' && mode !== 'visual') return false;
    if (mode === this.#mode) return true;
    if (!this.commitRichText()) return false;
    if (mode === 'visual' && !this.#readOnly) {
      const current = this.exportSource();
      if (
        (current.html !== this.#draft.html || current.css !== this.#draft.css) &&
        !this.commitDraft()
      )
        return false;
    }
    this.#mode = mode;
    this.#editGeneration++;
    this.emit();
    return true;
  }

  beginRichText(id: string, initialHtml: string): boolean {
    if (!this.canWrite() || this.#mode !== 'visual' || this.hasPendingDraft()) return false;
    if (this.#pendingRichText?.id === id) return true;
    if (!this.commitRichText() || !this.services.mutations.canEditRichText(this.snapshot(), id))
      return false;
    if (!this.boundedRichText(initialHtml))
      return this.fail('CHANGE_INVALID', 'diagnostics.invalidChange');
    try {
      this.services.mutations.validateRichTextProjection(this.snapshot(), id, initialHtml);
    } catch {
      return this.fail('CHANGE_INVALID', 'diagnostics.invalidChange');
    }
    this.#pendingRichText = {
      id,
      html: initialHtml,
      originalHtml: initialHtml,
      changed: false,
      valid: true,
      documentId: this.#document.id,
      baseRevision: this.#revision,
      editGeneration: this.#editGeneration,
    };
    this.emit();
    return true;
  }

  updateRichTextDraft(html: string): boolean {
    if (!this.canWrite() || !this.#pendingRichText) return false;
    if (!this.boundedRichText(html)) return this.rejectRichTextSize();
    const draft = this.#pendingRichText;
    let valid = false;
    try {
      this.services.mutations.validateRichTextProjection(this.snapshot(), draft.id, html);
      valid = true;
    } catch {
      // Invalid input stays recoverable but never becomes an HTML projection in the host.
    }
    this.#editGeneration++;
    this.#pendingRichText = {
      id: draft.id,
      originalHtml: draft.originalHtml,
      documentId: draft.documentId,
      baseRevision: draft.baseRevision,
      html,
      changed: html !== draft.originalHtml,
      valid,
      editGeneration: this.#editGeneration,
    };
    this.#diagnostics = valid
      ? []
      : [{ code: 'CHANGE_INVALID', severity: 'error', messageKey: 'diagnostics.invalidChange' }];
    this.emit();
    return valid;
  }

  restoreRichTextDraft(
    draft: Pick<PendingRichTextDraft, 'id' | 'html' | 'blocked'>,
    initialHtml: string,
  ): boolean {
    if (draft.blocked !== undefined && draft.blocked !== 'oversized') return false;
    if (!this.beginRichText(draft.id, initialHtml)) return false;
    this.updateRichTextDraft(draft.html);
    if (draft.blocked === 'oversized') this.rejectRichTextSize();
    return !!this.#pendingRichText;
  }

  commitRichText(): boolean {
    this.assertActive();
    const draft = this.#pendingRichText;
    if (!draft) return true;
    if (!draft.changed) {
      this.#pendingRichText = undefined;
      this.emit();
      return true;
    }
    if (!this.canWrite()) return false;
    if (!draft.valid) return this.fail('CHANGE_INVALID', 'diagnostics.invalidChange');
    if (
      draft.documentId !== this.#document.id ||
      draft.baseRevision !== this.#revision ||
      draft.editGeneration !== this.#editGeneration ||
      this.hasPendingDraft()
    )
      return this.fail('CHANGE_INVALID', 'diagnostics.invalidChange');
    try {
      const next = this.services.mutations.richText(this.snapshot(), draft.id, draft.html);
      this.commit(next, true, true);
      return true;
    } catch {
      return this.fail('CHANGE_INVALID', 'diagnostics.invalidChange');
    }
  }

  cancelRichText(): void {
    this.assertActive();
    if (!this.#pendingRichText) return;
    this.#pendingRichText = undefined;
    this.#editGeneration++;
    this.#diagnostics = [];
    this.emit();
  }

  inlineStyles(id: string): Readonly<Record<string, string>> {
    const node = this.find(this.snapshot().nodes, id);
    if (!node) return {};
    try {
      return this.services.content.inlineDeclarations(node.attrs?.style ?? '');
    } catch {
      // An imported style may hold hacks the strict reader does not vouch for.
      return {};
    }
  }

  /** Title and, in an e-mail, preheader of the document. */
  documentMetadata(): DocumentMetadata | undefined {
    return this.services.metadata?.read(this.snapshot());
  }
  updateTitle(value: string): boolean {
    return this.change((document) => this.metadata().title(document, value));
  }
  updatePreheader(value: string): boolean {
    return this.change((document) => this.metadata().preheader(document, value));
  }

  imageSize(id: string) {
    return this.services.presentation?.image(this.snapshot(), id);
  }
  updateImageSize(id: string, settings: ImageSizeSettings): boolean {
    return this.change((document) => this.presentation().resize(document, id, settings));
  }
  documentStyles() {
    return this.services.presentation?.styles(this.snapshot());
  }
  updateDocumentStyle(property: DocumentStyleProperty, value: string): boolean {
    return this.change((document) => this.presentation().style(document, property, value));
  }

  updateText(id: string, value: string): boolean {
    return this.change((document) => this.services.mutations.text(document, id, value));
  }
  updateRichText(id: string, html: string): boolean {
    return this.change((document) => this.services.mutations.richText(document, id, html));
  }
  updateAttribute(id: string, name: string, value: string): boolean {
    return this.change((document) => this.services.mutations.attribute(document, id, name, value));
  }
  updateStyle(id: string, property: string, value: string): boolean {
    return this.change((document) => this.services.mutations.style(document, id, property, value));
  }
  connectFormReference(reference: string, id?: string, parentId?: string, index?: number): boolean {
    return this.change((document) =>
      this.services.mutations.connectFormReference(document, reference, id, parentId, index),
    );
  }
  attachAsset(asset: AssetReference, id?: string, parentId?: string, index?: number): boolean {
    return this.change((document) =>
      this.services.mutations.attachAsset(document, asset, id, parentId, index),
    );
  }
  imageLink(imageId: string): ImageLinkContext | undefined {
    this.assertActive();
    return this.services.imageLinks.context(this.#document.snapshot(), imageId);
  }
  updateImageLink(imageId: string, href: string, options?: ImageLinkOptions): boolean {
    return this.change((document) =>
      this.services.imageLinks.update(document, imageId, href, options),
    );
  }
  layoutSettings(id: string): SectionLayoutContext | undefined {
    this.assertActive();
    const context = this.services.sectionLayouts?.context(this.snapshot(), id);
    return context && this.#readOnly
      ? { ...context, editable: false, reason: 'readonly' }
      : context;
  }
  async updateLayout(id: string, patch: SectionLayoutPatch): Promise<boolean> {
    if (!this.canWrite() || !this.commitRichText()) return false;
    if (this.hasPendingDraft()) return this.fail('DRAFT_PENDING', 'diagnostics.invalidChange');
    const service = this.services.sectionLayouts;
    if (!service) return this.fail('LAYOUT_UNAVAILABLE', 'diagnostics.invalidChange');
    const initial = this.getState();
    try {
      const next = await service.update(initial.document, id, patch);
      if (
        this.#disposed ||
        this.#readOnly ||
        this.#editGeneration !== initial.editGeneration ||
        this.#document.id !== initial.document.id ||
        this.#revision !== initial.document.revision ||
        this.#selection !== initial.selectedNodeId ||
        this.#mode !== initial.mode
      )
        return false;
      this.commit(next, true);
      return true;
    } catch (error: unknown) {
      if (this.#disposed || this.#readOnly || this.#editGeneration !== initial.editGeneration)
        return false;
      const reason = error instanceof Error ? error.message : '';
      const codes: Readonly<Record<string, string>> = {
        'column-not-empty': 'LAYOUT_COLUMN_NOT_EMPTY',
        'identity-bearing-column': 'LAYOUT_IDENTITY_BEARING_COLUMN',
        'unsupported-structure': 'LAYOUT_UNSUPPORTED_STRUCTURE',
        'invalid-settings': 'LAYOUT_INVALID_SETTINGS',
        unavailable: 'LAYOUT_UNAVAILABLE',
      };
      return this.fail(
        Object.hasOwn(codes, reason)
          ? (codes[reason] ?? 'LAYOUT_INVALID_SETTINGS')
          : 'LAYOUT_INVALID_SETTINGS',
        'diagnostics.invalidChange',
      );
    }
  }

  addBlock(type: BlockType, parentId?: string, index?: number): boolean {
    return this.change((document) => this.services.mutations.add(document, type, parentId, index));
  }
  insertSource(source: InsertionSource, parentId?: string, index?: number): boolean {
    return this.change((document) =>
      this.services.mutations.insert(document, source, parentId, index),
    );
  }
  removeBlock(id: string): boolean {
    return this.change((document) => this.services.mutations.remove(document, id));
  }
  duplicateBlock(id: string): boolean {
    return this.change((document) => this.services.mutations.duplicate(document, id));
  }
  moveBlock(id: string, parentId: string | undefined, index: number): boolean {
    return this.change((document) => this.services.mutations.move(document, id, parentId, index));
  }

  undo(): boolean {
    return this.restore('undo');
  }
  redo(): boolean {
    return this.restore('redo');
  }

  async save(): Promise<boolean> {
    if (!this.canWrite() || this.#saving || !this.commitRichText()) return false;
    if (this.#mode === 'html') {
      const source = this.exportSource();
      if (
        (source.html !== this.#draft.html || source.css !== this.#draft.css) &&
        !this.commitDraft()
      )
        return false;
    }
    const revision = this.#revision;
    this.#saving = true;
    try {
      const persisted = await this.services.host.save(
        this.snapshot(),
        this.exportSource(),
        this.#persistedRevision,
      );
      if (this.#disposed || persisted === undefined) return false;
      this.#persistedRevision = persisted;
      this.#savedDocumentRevision = revision;
      this.emit();
      return true;
    } catch {
      return this.#disposed ? false : this.fail('SAVE_FAILED', 'diagnostics.saveFailed');
    } finally {
      this.#saving = false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pendingRichText = undefined;
    this.services.host.dispose();
    this.#listeners.clear();
    this.services.history.reset();
  }

  private metadata(): DocumentMetadataService {
    if (!this.services.metadata) throw new Error('UNSUPPORTED_METADATA');
    return this.services.metadata;
  }

  /** What an import removed stays visible next to what the committed document holds. */
  private notices(
    imported: readonly Diagnostic[],
    current: readonly Diagnostic[],
  ): readonly Diagnostic[] {
    const merged = new Map<string, Diagnostic>();
    for (const diagnostic of [
      ...imported.filter(
        (entry) => entry.severity === 'warning' || entry.code === 'HTML_NORMALIZED',
      ),
      ...current,
    ])
      if (!merged.has(diagnostic.code)) merged.set(diagnostic.code, diagnostic);
    return [...merged.values()];
  }

  private presentation(): DocumentPresentationService {
    if (!this.services.presentation) throw new Error('UNSUPPORTED_PRESENTATION');
    return this.services.presentation;
  }

  private change(action: (document: EditorDocumentData) => EditorDocument): boolean {
    if (!this.canWrite() || !this.commitRichText()) return false;
    if (this.hasPendingDraft()) return this.fail('DRAFT_PENDING', 'diagnostics.invalidChange');
    try {
      this.commit(action(this.snapshot()), true);
      return true;
    } catch {
      return this.fail('CHANGE_INVALID', 'diagnostics.invalidChange');
    }
  }

  private restore(direction: 'undo' | 'redo'): boolean {
    if (!this.canWrite() || !this.commitRichText()) return false;
    if (this.hasPendingDraft()) return this.fail('DRAFT_PENDING', 'diagnostics.invalidChange');
    const previous = this.services.history[direction]();
    if (!previous) return false;
    try {
      this.commit(previous, false);
      return true;
    } catch {
      // The entry could not become the current document: step the pointer back where it was.
      this.services.history[direction === 'undo' ? 'redo' : 'undo']();
      return this.fail('HISTORY_RESTORE_FAILED', 'diagnostics.invalidChange');
    }
  }

  private commit(
    document: EditorDocument,
    history: boolean,
    clearRichText = false,
    imported: readonly Diagnostic[] = [],
  ): void {
    // The document was validated when it was built; the revision alone changes here.
    const next = document.withRevision(this.#revision + 1);
    const { source, diagnostics } = this.services.content.render(next);
    if (history) this.services.history.push(next);
    if (clearRichText) this.#pendingRichText = undefined;
    this.#document = next;
    this.#revision = next.revision;
    this.#editGeneration++;
    this.#source = source;
    this.#draft = source;
    this.#diagnostics = this.notices(imported, diagnostics);
    if (this.#selection && !this.find(this.snapshot().nodes, this.#selection))
      this.#selection = undefined;
    this.emit();
  }

  private fail(code: string, messageKey: string): false {
    this.#diagnostics = [{ code, messageKey, severity: 'error' }];
    this.emit();
    return false;
  }

  private rejectRichTextSize(): false {
    const draft = this.#pendingRichText;
    if (draft) {
      this.#editGeneration++;
      this.#pendingRichText = {
        ...draft,
        valid: false,
        changed: true,
        blocked: 'oversized',
        editGeneration: this.#editGeneration,
      };
    }
    return this.fail('CHANGE_INVALID', 'diagnostics.invalidChange');
  }

  private boundedRichText(html: string): boolean {
    return (
      typeof html === 'string' &&
      new DocumentBudget().byteLength(html) <= DocumentBudget.limits.sourceBytes
    );
  }

  private canWrite(): boolean {
    this.assertActive();
    return !this.#readOnly;
  }
  private assertActive(): void {
    if (this.#disposed) throw new Error('SESSION_DISPOSED');
  }
  private hasPendingDraft(): boolean {
    const current = this.exportSource();
    return current.html !== this.#draft.html || current.css !== this.#draft.css;
  }
  private emit(): void {
    if (!this.#listeners.size) return;
    if (this.#emitting) {
      this.#emitQueued = true;
      return;
    }
    this.#emitting = true;
    // A listener which failed is not served again by this emission: an error handler which
    // changes the session would otherwise redeliver to it forever. It stays subscribed.
    const failed = new Set<(state: EditorState) => void>();
    try {
      do {
        this.#emitQueued = false;
        const state = this.getState();
        this.freezeBroadcast(state);
        for (const listener of this.#listeners) {
          if (failed.has(listener)) continue;
          if (!this.notify(listener, state)) failed.add(listener);
          if (this.#emitQueued) break;
        }
      } while (this.#emitQueued && !this.#disposed);
    } finally {
      this.#emitting = false;
    }
  }

  private freezeBroadcast(state: EditorState): void {
    const stack: unknown[] = [state];
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== 'object') continue;
      Object.freeze(value);
      stack.push(...Object.values(value));
    }
  }

  /** False when the listener threw; the failure was already reported. */
  private notify(listener: (state: EditorState) => void, state?: EditorState): boolean {
    try {
      listener(state ?? this.getState());
      return true;
    } catch (error) {
      // One failed delivery is isolated; the listener keeps receiving later states.
      try {
        this.options.onObserverError?.(error);
      } catch {
        /* A failed observer cannot corrupt an accepted document transaction. */
      }
      return false;
    }
  }
  private find(nodes: readonly DocumentNode[], id: string): DocumentNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = this.find(node.children ?? [], id);
      if (found) return found;
    }
    return undefined;
  }
}
