import { BlockDocument } from '../core/block-document';
import type {
  Block,
  BlockDevice,
  BlockDocumentData,
  BlockNodeType,
  BlockProps,
  BlockTarget,
  StylePatch,
} from '../core/block-document';
import { DocumentBudget } from '../core/budget';
import { DocumentValidationError } from '../core/document';
import type { Diagnostic, SourceInput } from '../core/document';
import { DocumentHistory } from '../core/history';

/** The final output of a piece: the compiled e-mail, or the HTML and CSS of the page. */
export interface BlockOutputPort {
  render(document: BlockDocument): Promise<SourceInput>;
}

/** Where the host keeps a block piece, with the output generated from it. */
export interface BlockStorePort {
  save(
    document: BlockDocumentData,
    output: SourceInput,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<{ revision: number }>;
}

/** Creates the blocks of each type and says which keys hold a text edited in place. */
export interface BlockFactoryPort {
  create(type: BlockNodeType, nextId: () => string, props?: BlockProps): Block;
  textKeys(type: BlockNodeType): readonly string[];
}

export interface IdentifierPort {
  next(): string;
}

/** An image chosen for a block: the asset of the host, when there is one. */
export interface BlockImageChoice {
  readonly url: string;
  readonly alt?: string;
  readonly assetId?: string;
}

export interface BlockEditorState {
  readonly document: BlockDocumentData;
  readonly selectedBlockId: string | undefined;
  /** The text being edited in place, until it is confirmed or cancelled. */
  readonly pendingText: { readonly id: string; readonly key: string } | undefined;
  readonly diagnostics: readonly Diagnostic[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly readOnly: boolean;
  readonly dirty: boolean;
  readonly saving: boolean;
}

export interface BlockSessionServices {
  readonly factory: BlockFactoryPort;
  readonly output: BlockOutputPort;
  readonly identifiers: IdentifierPort;
  readonly store?: BlockStorePort;
  readonly history?: DocumentHistory<BlockDocument>;
}

export interface BlockSessionOptions {
  readonly document: BlockDocument;
  readonly readOnly?: boolean;
  readonly persistedRevision?: number;
  readonly onObserverError?: (error: unknown) => void;
}

interface PendingText {
  readonly id: string;
  readonly key: string;
  readonly original: string;
  html: string;
}

/**
 * The editing session of a block piece (schema 2), beside the session of the HTML document
 * (schema 1). Every command is one step of history; the document is the immutable aggregate,
 * so a refused command changes nothing. Undoing moves forward in revision, as in schema 1, so a
 * host saving by compare-and-swap never goes back.
 */
export class BlockEditorSession {
  #document: BlockDocument;
  #selection: string | undefined;
  #text: PendingText | undefined;
  #diagnostics: readonly Diagnostic[] = [];
  #readOnly: boolean;
  #persistedRevision: number;
  #savedRevision: number;
  #saving = false;
  #saveSequence = 0;
  #saveAbort: AbortController | undefined;
  #disposed = false;
  readonly #history: DocumentHistory<BlockDocument>;
  readonly #listeners = new Set<(state: BlockEditorState) => void>();

  constructor(
    private readonly services: BlockSessionServices,
    private readonly options: BlockSessionOptions,
  ) {
    this.#document = options.document;
    this.#readOnly = options.readOnly ?? false;
    this.#persistedRevision = options.persistedRevision ?? this.#document.revision;
    this.#savedRevision = this.#document.revision;
    this.#history = services.history ?? new DocumentHistory<BlockDocument>();
    this.#history.reset(this.#document);
  }

  /** The current piece; immutable, so it can be handed to generators as it is. */
  document(): BlockDocument {
    this.assertActive();
    return this.#document;
  }

  snapshot(): BlockDocumentData {
    return this.document().snapshot();
  }

  getState(): BlockEditorState {
    this.assertActive();
    return Object.freeze({
      // Deeply frozen and never changed: the listeners share it instead of a copy each.
      document: this.#document.data,
      selectedBlockId: this.#selection,
      pendingText: this.#text
        ? Object.freeze({ id: this.#text.id, key: this.#text.key })
        : undefined,
      diagnostics: this.#diagnostics,
      canUndo: this.#history.canUndo || this.textChanged(),
      canRedo: this.#history.canRedo && !this.textChanged(),
      readOnly: this.#readOnly,
      dirty: this.#document.revision !== this.#savedRevision || this.textChanged(),
      saving: this.#saving,
    });
  }

  subscribe(listener: (state: BlockEditorState) => void): () => void {
    this.assertActive();
    this.#listeners.add(listener);
    this.deliver(listener, this.getState());
    return () => this.#listeners.delete(listener);
  }

  setReadOnly(value: boolean): void {
    this.assertActive();
    if (typeof value !== 'boolean') throw new TypeError('INVALID_READ_ONLY');
    if (value === this.#readOnly) return;
    this.#readOnly = value;
    this.#text = undefined;
    this.emit();
  }

  select(id: string | undefined): boolean {
    this.assertActive();
    if (id !== undefined && !this.#document.find(id)) return false;
    if (id === this.#selection) return true;
    if (this.#text && this.#text.id !== id && !this.commitText()) return false;
    this.#selection = id;
    this.emit();
    return true;
  }

  /** A new block of a type; it becomes the selection. Returns its id, or undefined. */
  insert(type: BlockNodeType, target: BlockTarget, props?: BlockProps): string | undefined {
    let block: Block;
    try {
      block = this.services.factory.create(type, () => this.newId(), props);
    } catch {
      this.fail('CHANGE_INVALID');
      return undefined;
    }
    return this.insertBlock(block, target);
  }

  /** A block with its children, made with ids of `newId()`; it becomes the selection. */
  insertBlock(block: Block, target: BlockTarget): string | undefined {
    if (!this.change((document) => document.insert(block, target))) return undefined;
    this.#selection = block.id;
    this.emit();
    return block.id;
  }

  /** A new block id, unique in practice: 80 random bits. */
  newId(): string {
    return `b${this.services.identifiers.next().slice(0, 20)}`;
  }

  move(id: string, target: BlockTarget): boolean {
    return this.change((document) => document.move(id, target));
  }

  duplicate(id: string): boolean {
    return this.change((document) => document.duplicate(id, () => this.newId()));
  }

  remove(id: string): boolean {
    const parent = this.#document.parentOf(id);
    const applied = this.change((document) => document.remove(id));
    if (applied && this.#selection === undefined && parent && this.#document.find(parent)) {
      this.#selection = parent;
      this.emit();
    }
    return applied;
  }

  /**
   * Properties of a block in one step. A new address typed by hand (`url` without `assetId`)
   * no longer points at the asset of the host library chosen before: that asset goes in the
   * same step, so the host never keeps a stale reference.
   */
  updateProps(id: string, patch: BlockProps, device: BlockDevice = 'desktop'): boolean {
    if (device === 'mobile')
      return this.change((document) => document.updateProps(id, patch, device));
    return this.change((document) => {
      const next = document.updateProps(id, patch);
      const staleAsset =
        'url' in patch &&
        !('assetId' in patch) &&
        next !== document &&
        next.find(id)?.props.assetId !== undefined;
      return staleAsset ? next.restoreDefault(id, ['assetId']) : next;
    });
  }

  restoreDefault(id: string, keys: readonly string[], device: BlockDevice = 'desktop'): boolean {
    if (device === 'mobile')
      return this.change((document) => document.restoreDefault(id, keys, device));
    // The address goes back to the default: the asset it came from goes with it.
    const all = keys.includes('url') && !keys.includes('assetId') ? [...keys, 'assetId'] : keys;
    return this.change((document) => document.restoreDefault(id, all));
  }

  /**
   * Address, description and asset of an image in one step of history. What the choice does
   * not bring goes: the description and the asset of the previous image never describe the new
   * one.
   */
  replaceImage(id: string, choice: BlockImageChoice): boolean {
    return this.change((document) => {
      const patch: Record<string, string> = { url: choice.url };
      if (choice.alt !== undefined) patch.alt = choice.alt;
      if (choice.assetId !== undefined) patch.assetId = choice.assetId;
      const stale = [
        ...(choice.alt === undefined ? ['alt'] : []),
        ...(choice.assetId === undefined ? ['assetId'] : []),
      ];
      const next = document.updateProps(id, patch);
      return stale.length ? next.restoreDefault(id, stale) : next;
    });
  }

  updateStyles(patch: StylePatch): boolean {
    return this.change((document) => document.updateStyles(patch));
  }

  restoreStyleDefault(group?: string, keys?: readonly string[]): boolean {
    return this.change((document) => document.restoreStyleDefault(group, keys));
  }

  setLanguage(lang: string): boolean {
    return this.change((document) => document.withMeta({ lang }));
  }

  setTitle(title: string): boolean {
    return this.change((document) => document.withTitle(title));
  }

  /** A whole piece of the same kind and id, e.g. made from a template: one step of history. */
  replace(document: BlockDocument): boolean {
    if (document.id !== this.#document.id || document.kind !== this.#document.kind) return false;
    return this.change(() => document);
  }

  /** Opens the text of a block for editing in place. */
  beginText(id: string): boolean {
    if (!this.canWrite()) return false;
    if (this.#text?.id === id) return true;
    const block = this.#document.find(id);
    const key = block ? this.services.factory.textKeys(block.type)[0] : undefined;
    if (!block || !key || (this.#text && !this.commitText())) return false;
    const value = block.props[key];
    const original = typeof value === 'string' ? value : '';
    this.#text = { id, key, original, html: original };
    this.#selection = id;
    this.emit();
    return true;
  }

  updateTextDraft(html: string): boolean {
    if (!this.canWrite() || !this.#text) return false;
    if (typeof html !== 'string' || new DocumentBudget().byteLength(html) > 1_000_000)
      return this.fail('INVALID_BLOCK_TEXT');
    const changed = this.textChanged();
    this.#text.html = html;
    if (changed !== this.textChanged()) this.emit();
    return true;
  }

  /**
   * Confirms the text being edited: the block takes it in the projection of its type. A refused
   * text stays open as it was typed, with the diagnostic, as in the HTML document: nothing the
   * person wrote is lost because the piece did not accept it.
   */
  commitText(): boolean {
    const text = this.#text;
    if (!text) return true;
    if (!this.canWrite()) return false;
    if (text.html === text.original) {
      this.#text = undefined;
      this.emit();
      return true;
    }
    const next = this.attempt((document) => document.updateText(text.id, text.key, text.html));
    if (!next) return false;
    this.#text = undefined;
    if (next === this.#document) this.emit();
    else this.apply(next);
    return true;
  }

  cancelText(): void {
    if (!this.#text) return;
    this.#text = undefined;
    this.emit();
  }

  undo(): boolean {
    return this.restore('undo');
  }

  redo(): boolean {
    return this.restore('redo');
  }

  /** Generates the final output and hands both to the host store. */
  async save(): Promise<boolean> {
    return (await this.saveDocument()) !== undefined;
  }

  /**
   * As `save`, returning the exact piece the store received (changes made while it was being
   * saved are not in it), or undefined when nothing was saved.
   */
  async saveDocument(): Promise<BlockDocumentData | undefined> {
    if (!this.canWrite() || this.#saving || !this.commitText()) return undefined;
    const store = this.services.store;
    if (!store) return undefined;
    const document = this.#document;
    this.#saving = true;
    this.#saveAbort?.abort();
    const abort = new AbortController();
    this.#saveAbort = abort;
    const job = ++this.#saveSequence;
    this.emit();
    try {
      const output = await this.services.output.render(document);
      if (this.#disposed || abort.signal.aborted) return undefined;
      const saved = document.snapshot();
      const result = await store.save(saved, { ...output }, this.#persistedRevision, abort.signal);
      if (this.#disposed || abort.signal.aborted || job !== this.#saveSequence) return undefined;
      this.#persistedRevision = result.revision;
      this.#savedRevision = document.revision;
      this.#diagnostics = [];
      return saved;
    } catch {
      if (!this.#disposed) this.fail('SAVE_FAILED', 'diagnostics.saveFailed');
      return undefined;
    } finally {
      if (!this.#disposed) {
        this.#saving = false;
        this.emit();
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#saveSequence++;
    this.#saveAbort?.abort();
    this.#text = undefined;
    this.#listeners.clear();
    this.#history.reset();
  }

  private change(action: (document: BlockDocument) => BlockDocument): boolean {
    if (!this.canWrite() || !this.commitText()) return false;
    const next = this.attempt(action);
    if (!next) return false;
    this.apply(next);
    return true;
  }

  /** The piece a command makes, or undefined (with the diagnostic) when it is refused. */
  private attempt(action: (document: BlockDocument) => BlockDocument): BlockDocument | undefined {
    try {
      return action(this.#document);
    } catch (error: unknown) {
      this.fail(error instanceof DocumentValidationError ? error.code : 'CHANGE_INVALID');
      return undefined;
    }
  }

  private apply(next: BlockDocument): void {
    if (next !== this.#document) this.commit(next.withRevision(this.#document.revision + 1), true);
  }

  private restore(direction: 'undo' | 'redo'): boolean {
    if (!this.canWrite() || !this.commitText()) return false;
    const previous = this.#history[direction]();
    if (!previous) return false;
    this.commit(previous.withRevision(this.#document.revision + 1), false);
    return true;
  }

  private commit(document: BlockDocument, history: boolean): void {
    if (history) this.#history.push(document);
    this.#document = document;
    this.#diagnostics = [];
    if (this.#selection && !document.find(this.#selection)) this.#selection = undefined;
    this.emit();
  }

  private textChanged(): boolean {
    return !!this.#text && this.#text.html !== this.#text.original;
  }

  private fail(code: string, messageKey = 'diagnostics.invalidChange'): false {
    this.#diagnostics = [{ code, messageKey, severity: 'error' }];
    this.emit();
    return false;
  }

  private canWrite(): boolean {
    this.assertActive();
    return !this.#readOnly;
  }

  private assertActive(): void {
    if (this.#disposed) throw new Error('SESSION_DISPOSED');
  }

  private emit(): void {
    if (this.#disposed || !this.#listeners.size) return;
    const state = this.getState();
    for (const listener of [...this.#listeners]) this.deliver(listener, state);
  }

  private deliver(listener: (state: BlockEditorState) => void, state: BlockEditorState): void {
    try {
      listener(state);
    } catch (error: unknown) {
      try {
        this.options.onObserverError?.(error);
      } catch {
        /* A failed observer cannot undo an accepted change. */
      }
    }
  }
}
