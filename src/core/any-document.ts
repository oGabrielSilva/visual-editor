import { BlockDocument } from './block-document';
import type { BlockRules } from './block-document';
import { DocumentValidationError, EditorDocument } from './document';

/** A stored piece in either format. Nothing converts one into the other on the way in. */
export type AnyDocument =
  | { readonly schemaVersion: 1; readonly document: EditorDocument }
  | { readonly schemaVersion: 2; readonly document: BlockDocument };

/**
 * Dispatches by `schemaVersion`: 1 is the HTML document of the editor, 2 the block piece.
 * Throws `DocumentValidationError` (or its `BlockDocumentError` subclass) like each format.
 */
export function parseAnyDocument(input: unknown, rules: BlockRules): AnyDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new DocumentValidationError('INVALID_DOCUMENT_SCHEMA');
  const version: unknown = Object.getOwnPropertyDescriptor(input, 'schemaVersion')?.value;
  if (version === 1) return { schemaVersion: 1, document: EditorDocument.from(input) };
  if (version === 2) return { schemaVersion: 2, document: BlockDocument.from(input, rules) };
  throw new DocumentValidationError('UNSUPPORTED_SCHEMA_VERSION');
}
