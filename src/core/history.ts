import type { EditorDocument } from './document';

/** What a history keeps: an immutable, validated document which knows its serialized size. */
export interface HistoryEntry {
  serializedBytes(): number;
}

/**
 * One history per editing session. A new branch discards only the redo branch. The HTML
 * document (schema 1) and the block piece (schema 2) use the same history.
 */
export class DocumentHistory<T extends HistoryEntry = EditorDocument> {
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  #entries: T[] = [];
  #sizes: number[] = [];
  #position = -1;

  /**
   * A document inside the import limits can serialize to about 30 MB of JSON, and its history
   * has to hold it at least twice.
   */
  constructor(maxEntries = 100, maxBytes = 64 * 1024 * 1024) {
    if (!Number.isInteger(maxEntries) || maxEntries < 2 || maxEntries > 1_000)
      throw new RangeError('INVALID_HISTORY_LIMIT');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1_024 || maxBytes > 128 * 1024 * 1024)
      throw new RangeError('INVALID_HISTORY_BUDGET');
    this.#maxEntries = maxEntries;
    this.#maxBytes = maxBytes;
  }

  get canUndo(): boolean {
    return this.#position > 0;
  }
  get canRedo(): boolean {
    return this.#position >= 0 && this.#position < this.#entries.length - 1;
  }
  get size(): number {
    return this.#entries.length;
  }
  get retainedBytes(): number {
    return this.#sizes.reduce((sum, size) => sum + size, 0);
  }

  push(document: T): void {
    const bytes = document.serializedBytes();
    if (bytes > this.#maxBytes) throw new RangeError('HISTORY_SNAPSHOT_TOO_LARGE');
    this.#entries = this.#entries.slice(0, this.#position + 1);
    this.#sizes = this.#sizes.slice(0, this.#position + 1);
    // The aggregate is immutable and was validated when it was built: it is kept as it is.
    this.#entries.push(document);
    this.#sizes.push(bytes);
    while (this.#entries.length > this.#maxEntries || this.retainedBytes > this.#maxBytes) {
      this.#entries.shift();
      this.#sizes.shift();
    }
    this.#position = this.#entries.length - 1;
  }

  current(): T | undefined {
    return this.#entries[this.#position];
  }

  undo(): T | undefined {
    if (!this.canUndo) return undefined;
    this.#position--;
    return this.current();
  }

  redo(): T | undefined {
    if (!this.canRedo) return undefined;
    this.#position++;
    return this.current();
  }

  reset(document?: T): void {
    this.#entries = [];
    this.#sizes = [];
    this.#position = -1;
    if (document) this.push(document);
  }
}
