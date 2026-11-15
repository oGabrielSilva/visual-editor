import type { Block, BlockDocument } from '../core/block-document';
import type { SourceInput } from '../core/document';
import type { CanvasBridgeRegion } from '../renderers/canvas-bridge';
import type { BlockPreviewInput } from '../renderers/marked-preview';
import type { BlockDefinitionRegistry } from './definitions';
import type { BlockEmailRenderer } from './email-renderer';
import type { BlockPageGenerator } from './page-generator';

/**
 * The two outputs of a block piece, by kind: the final one the host stores, sends or publishes
 * (the compiled e-mail, or the HTML and CSS of the page), and the marked preview of the editing
 * frame with the regions of its blocks.
 */
export class BlockOutputRenderer {
  constructor(
    private readonly registry: BlockDefinitionRegistry,
    private readonly pages: BlockPageGenerator,
    private readonly emails: BlockEmailRenderer,
    /** The e-mail renderer of the editing frame; its compiler may queue apart from the final one. */
    private readonly previewEmails: BlockEmailRenderer = emails,
  ) {}

  /** What is sent or published. */
  render(document: BlockDocument): Promise<SourceInput> {
    return document.kind === 'email'
      ? this.emails.render(document, 'final')
      : Promise.resolve(this.pages.toHtml(document, 'final'));
  }

  /** The marked markup of the editing frame and the regions of the blocks, in document order. */
  async preview(document: BlockDocument): Promise<BlockPreviewInput> {
    const source =
      document.kind === 'email'
        ? await this.previewEmails.render(document, 'preview')
        : this.pages.toHtml(document, 'preview');
    return Object.freeze({
      id: document.id,
      revision: document.revision,
      kind: document.kind,
      source,
      regions: this.regions(document),
    });
  }

  /** What the frame runtime needs of each block: place, text mode, container, image. */
  regions(document: Pick<BlockDocument, 'blocks'>): readonly CanvasBridgeRegion[] {
    const regions: CanvasBridgeRegion[] = [];
    const visit = (blocks: readonly Block[], parentId: string | null): void => {
      for (const block of blocks) {
        const definition = this.registry.definition(block.type);
        const text = definition.fields.find((field) => field.control === 'richtext')?.value;
        const mode = text?.type === 'richtext' ? text.mode : undefined;
        regions.push(
          Object.freeze({
            id: block.id,
            parentId,
            editable: mode !== undefined,
            container: definition.childTypes.length > 0,
            ...(mode !== undefined ? { blocks: mode === 'block', links: mode !== 'button' } : {}),
            ...(block.type === 'image' ? { media: 'image' as const } : {}),
          }),
        );
        visit(block.children ?? [], block.id);
      }
    };
    visit(document.blocks, null);
    return regions;
  }
}
