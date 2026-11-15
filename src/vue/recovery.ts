import * as v from 'valibot';
import { EditorDocument } from '../core/document';
import type { EditorDocumentData, SourceInput } from '../core/document';
import type { PendingRichTextDraft } from '../application/session';
import { DocumentBudget } from '../core/budget';

const boundedHtml = v.pipe(v.string(), v.maxLength(DocumentBudget.limits.sourceBytes));
const recoverySchema = v.strictObject({
  format: v.literal('visual-editor-recovery-v1'),
  document: v.unknown(),
  pendingSource: v.strictObject({
    html: boundedHtml,
    css: v.pipe(v.string(), v.maxLength(DocumentBudget.limits.cssBytes)),
  }),
  pendingRichText: v.exactOptional(
    v.strictObject({
      id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
      html: boundedHtml,
      originalHtml: boundedHtml,
      changed: v.boolean(),
      valid: v.boolean(),
      blocked: v.exactOptional(v.literal('oversized')),
      documentId: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
      baseRevision: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(0),
        v.maxValue(Number.MAX_SAFE_INTEGER),
      ),
      editGeneration: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(0),
        v.maxValue(Number.MAX_SAFE_INTEGER),
      ),
    }),
  ),
});

/** Pending source and canvas text are inert JSON. Reopening validates before projection. */
export class DocumentRecovery {
  encode(
    document: EditorDocumentData,
    pendingSource: SourceInput,
    pendingRichText?: PendingRichTextDraft,
  ): string {
    const serialized = JSON.stringify({
      format: 'visual-editor-recovery-v1',
      document,
      pendingSource,
      ...(pendingRichText ? { pendingRichText } : {}),
    });
    if (new DocumentBudget().byteLength(serialized) > DocumentBudget.limits.jsonBytes)
      throw new RangeError('RECOVERY_TOO_LARGE');
    return serialized;
  }

  decode(value: unknown):
    | (Omit<v.InferOutput<typeof recoverySchema>, 'document'> & {
        readonly document: EditorDocumentData;
      })
    | undefined {
    const parsed = v.safeParse(recoverySchema, value);
    if (!parsed.success) return undefined;
    try {
      const budget = new DocumentBudget();
      EditorDocument.from(parsed.output.document);
      budget.assertSource(parsed.output.pendingSource.html, parsed.output.pendingSource.css);
      if (parsed.output.pendingRichText) {
        budget.assertSource(parsed.output.pendingRichText.html, '');
        budget.assertSource(parsed.output.pendingRichText.originalHtml, '');
      }
    } catch {
      return undefined;
    }
    return { ...parsed.output, document: EditorDocument.from(parsed.output.document).snapshot() };
  }
}
