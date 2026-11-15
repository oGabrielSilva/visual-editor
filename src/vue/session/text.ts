import type { EditorSession } from '../../application/session';
import type { BlockCatalog } from '../../core/catalog';
import type { CanvasLayout } from '../../core/canvas-layout';
import type { DocumentOutline } from '../outline';
import type { StructureQueries } from './structure';

/** The text of a block: what the editors show and the transaction which changes it. */
export class TextEditing {
  constructor(
    private readonly session: EditorSession,
    private readonly layout: CanvasLayout,
    private readonly catalog: BlockCatalog,
    private readonly outline: DocumentOutline,
    private readonly structure: StructureQueries,
  ) {}

  private region(id: string) {
    return this.layout.resolveSelection(this.session.getState().document, id);
  }

  plain(): string {
    const selected = this.structure.selected();
    return selected ? this.outline.text(selected.node) : '';
  }

  /** The projection of the text of `id`: the valid pending draft, or what the document holds. */
  richTextFor(id: string): string | undefined {
    const state = this.session.getState();
    if (state.pendingRichText?.id === id && state.pendingRichText.valid)
      return state.pendingRichText.html;
    const region = this.region(id);
    return region?.editable ? this.outline.richText(region.node) : undefined;
  }

  allowsBlocksFor(id: string): boolean {
    const region = this.region(id);
    return !!region?.editable && this.catalog.richTextAllowsBlocks(region.node);
  }

  /** Opens the transaction of an already selected block. */
  begin(id: string): boolean {
    const region = this.region(id);
    const html = region?.editable ? this.outline.richText(region.node) : undefined;
    return !!region && html !== undefined && this.session.beginRichText(region.id, html);
  }

  updatePlain(value: string): boolean {
    const selected = this.structure.selected();
    if (!selected) return false;
    const textNode = this.outline.editableTextNode(selected.node);
    return textNode ? this.session.updateText(textNode.id, value) : false;
  }

  updateRichTextFor(id: string, value: string): boolean {
    const region = this.region(id);
    return (
      !!region?.editable &&
      this.outline.richText(region.node) !== undefined &&
      this.session.updateRichText(region.id, value)
    );
  }
}
