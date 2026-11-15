import type { Block } from '../../core/block-document';
import type { DocumentKind } from '../../core/document';

/** A block saved to use again: a section with its columns, or one content block. */
export interface EditorSavedBlock {
  /** Identifier in the host, 1 to 128 of `A-Z a-z 0-9 _ -`. */
  readonly id: string;
  readonly name: string;
  readonly kind: DocumentKind;
  /** The block as it was saved; the editor checks it again before it enters a piece. */
  readonly block: Block;
}

export interface EditorSavedBlockInput {
  readonly name: string;
  readonly kind: DocumentKind;
  readonly block: Block;
}

/**
 * The door a host implements to keep saved blocks (per account, team or project, as the host decides): the editor lists them in the
 * palette, saves the selected block under a name and removes one. Where they are stored, who
 * may see or change them and the audit belong to the host.
 */
export interface EditorSavedBlocks {
  list(kind: DocumentKind): Promise<readonly EditorSavedBlock[]>;
  save(input: EditorSavedBlockInput): Promise<EditorSavedBlock>;
  remove?(id: string): Promise<void>;
}

export const SAVED_BLOCK_LIMITS = Object.freeze({ name: 80, list: 200 });
const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** What the editor keeps of a list from the host: well-formed entries of the kind, in order. */
export function acceptedSavedBlocks(
  entries: unknown,
  kind: DocumentKind,
): readonly EditorSavedBlock[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(
      (entry): entry is EditorSavedBlock =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as EditorSavedBlock).id === 'string' &&
        ID.test((entry as EditorSavedBlock).id) &&
        typeof (entry as EditorSavedBlock).name === 'string' &&
        (entry as EditorSavedBlock).name.trim() !== '' &&
        (entry as EditorSavedBlock).name.length <= SAVED_BLOCK_LIMITS.name &&
        (entry as EditorSavedBlock).kind === kind &&
        !!(entry as EditorSavedBlock).block &&
        typeof (entry as EditorSavedBlock).block === 'object',
    )
    .slice(0, SAVED_BLOCK_LIMITS.list);
}
