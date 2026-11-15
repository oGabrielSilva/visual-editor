import type { DocumentKind } from '../src/core/document';
import type {
  EditorSavedBlock,
  EditorSavedBlockInput,
  EditorSavedBlocks,
} from '../src/vue/services/saved-blocks';

/** The saved blocks of the playground, kept in memory like the store of its pieces. */
export class MemorySavedBlocks implements EditorSavedBlocks {
  #entries: EditorSavedBlock[] = [];
  #next = 0;

  list(kind: DocumentKind): Promise<readonly EditorSavedBlock[]> {
    return Promise.resolve(this.#entries.filter((entry) => entry.kind === kind));
  }

  save(input: EditorSavedBlockInput): Promise<EditorSavedBlock> {
    const entry: EditorSavedBlock = { ...structuredClone(input), id: `saved-${++this.#next}` };
    this.#entries = [entry, ...this.#entries];
    return Promise.resolve(entry);
  }

  remove(id: string): Promise<void> {
    this.#entries = this.#entries.filter((entry) => entry.id !== id);
    return Promise.resolve();
  }
}
