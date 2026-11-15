import type {
  DocumentStyleProperty,
  ImageSizeSettings,
} from '../../application/document-presentation';
import type { ImageLinkOptions } from '../../application/image-link';
import type { SectionLayoutPatch } from '../../core/section-layout';
import type { EditorController } from '../controller';

/**
 * The single door for changing what a block or the document says and looks like: the fields of
 * the properties panel, the document settings and the text typed in the panel or reviewed after
 * a recovery. Components decide when a change is one history step (`LiveChangeGroup`) and where
 * its error is shown; what reaches the controller passes here.
 */
export class PropertyCommandService {
  constructor(private readonly controller: () => EditorController) {}

  style(property: string, value: string): boolean {
    return this.controller().updateStyle(property, value);
  }

  attribute(name: string, value: string): boolean {
    return this.controller().updateAttribute(name, value);
  }

  imageLink(href: string, options?: ImageLinkOptions): boolean {
    return this.controller().updateImageLink(href, options);
  }

  imageSize(settings: ImageSizeSettings): boolean {
    return this.controller().updateImageSize(settings);
  }

  /** The columns of a section; the answer belongs to the editor which was asked. */
  layout(patch: SectionLayoutPatch): Promise<boolean> {
    return this.controller().updateLayout(patch);
  }

  documentStyle(property: DocumentStyleProperty, value: string): boolean {
    return this.controller().updateDocumentStyle(property, value);
  }

  title(value: string): boolean {
    return this.controller().updateTitle(value);
  }

  preheader(value: string): boolean {
    return this.controller().updatePreheader(value);
  }

  /** Opens the text of a block for the editor of the panel. */
  beginText(id: string): boolean {
    return this.controller().beginRichText(id);
  }

  draftText(html: string): boolean {
    return this.controller().updateRichTextDraft(html);
  }

  commitText(): boolean {
    return this.controller().commitRichText();
  }

  cancelText(): void {
    this.controller().cancelRichText();
  }
}
