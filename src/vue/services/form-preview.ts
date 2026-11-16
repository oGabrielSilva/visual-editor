import { shallowRef } from 'vue';
import type { InjectionKey, ShallowRef } from 'vue';

/**
 * A static picture of a form the host connected to a form slot. The canvas shows it inside the
 * slot so the piece looks like the published page; it is never part of the document, the export
 * or the HTML mode. Scripts, frames and event handlers in it are removed and never run.
 */
export interface EditorFormPreview {
  /** HTML of the form behind `reference`, or `undefined` when there is nothing to show. */
  preview(reference: string): Promise<string | undefined>;
}

export const FORM_PREVIEW_LIMITS = Object.freeze({
  /** Larger pictures are not shown: the slot keeps its empty look. */
  bytes: 200_000,
  /** Different forms one editor asks about; further ones are not asked. */
  entries: 50,
});

/**
 * Asks the host once per reference and keeps the answer for the life of the editor. The frame
 * reads it synchronously while it draws, and draws again when `version` changes.
 */
export class FormPreviewCache {
  readonly version: ShallowRef<number> = shallowRef(0);
  readonly #entries = new Map<string, string | null>();
  #disposed = false;

  constructor(private readonly port: () => EditorFormPreview | undefined) {}

  /** The picture of `reference` if it already arrived; otherwise asks for it and says nothing yet. */
  readonly lookup = (reference: string): string | undefined => {
    const port = this.port();
    if (!port || this.#disposed) return undefined;
    if (this.#entries.has(reference)) return this.#entries.get(reference) ?? undefined;
    if (this.#entries.size >= FORM_PREVIEW_LIMITS.entries) return undefined;
    this.#entries.set(reference, null);
    void Promise.resolve()
      .then(() => port.preview(reference))
      .then(
        (html) => {
          if (this.#disposed || typeof html !== 'string' || !html.trim()) return;
          if (new TextEncoder().encode(html).length > FORM_PREVIEW_LIMITS.bytes) return;
          this.#entries.set(reference, html);
          this.version.value += 1;
        },
        () => undefined,
      );
    return undefined;
  };

  dispose(): void {
    this.#disposed = true;
    this.#entries.clear();
  }
}

export const FORM_PREVIEWS: InjectionKey<FormPreviewCache> = Symbol('visual-editor-form-previews');
