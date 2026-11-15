import type { EditorSession } from '../../application/session';
import type { BlockCatalog, BlockType } from '../../core/catalog';
import type { CanvasLayout, CanvasMovementTarget } from '../../core/canvas-layout';
import type { DocumentOutline, OutlineEntry } from '../outline';

interface Revision {
  readonly documentId: string;
  readonly revision: number;
}

export interface PropertyCapabilities {
  attributes: readonly string[];
  styles: readonly string[];
  richText: boolean;
  blocks: boolean;
  container: boolean;
  kind: BlockType | 'container' | 'native';
}

/**
 * What the shell asks about the structure of the document on screen: its blocks, the selected
 * one, where a block may go. Answers which cost a walk of the tree are kept for the revision
 * which produced them; a revision number never names two different documents.
 */
export class StructureQueries {
  #entries: (Revision & { readonly entries: readonly OutlineEntry[] }) | undefined;
  #selected:
    | (Revision & { readonly id: string | undefined; readonly entry: OutlineEntry | undefined })
    | undefined;
  #insertion: (Revision & { readonly targets: readonly CanvasMovementTarget[] }) | undefined;
  #movement:
    | (Revision & { readonly sourceId: string; readonly targets: readonly CanvasMovementTarget[] })
    | undefined;

  constructor(
    private readonly session: EditorSession,
    private readonly layout: CanvasLayout,
    private readonly catalog: BlockCatalog,
    private readonly outline: DocumentOutline,
  ) {}

  private same(cached: Revision | undefined, document: { id: string; revision: number }): boolean {
    return cached?.documentId === document.id && cached.revision === document.revision;
  }

  entries(): readonly OutlineEntry[] {
    const { document } = this.session.getState();
    const cached = this.#entries;
    if (cached && this.same(cached, document)) return cached.entries;
    const entries = this.outline.entries(document);
    this.#entries = { documentId: document.id, revision: document.revision, entries };
    return entries;
  }

  regions() {
    return this.layout.selectionRegions(this.session.getState().document);
  }

  resolve(id: string) {
    return this.layout.resolveSelection(this.session.getState().document, id);
  }

  selected(): OutlineEntry | undefined {
    const { document, selectedNodeId: id } = this.session.getState();
    const cached = this.#selected;
    if (cached && this.same(cached, document) && cached.id === id) return cached.entry;
    const entry = id ? this.entries().find((candidate) => candidate.id === id) : undefined;
    this.#selected = { documentId: document.id, revision: document.revision, id, entry };
    return entry;
  }

  /** The closest selectable block which contains `id`. */
  parentOf(id: string): string | undefined {
    const region = this.resolve(id);
    const parent = region?.parentId ? this.resolve(region.parentId) : undefined;
    return parent && parent.id !== region?.id ? parent.id : undefined;
  }

  movementTargets(sourceId: string): readonly CanvasMovementTarget[] {
    const state = this.session.getState();
    if (state.readOnly) return [];
    const cached = this.#movement;
    if (cached && this.same(cached, state.document) && cached.sourceId === sourceId)
      return structuredClone(cached.targets);
    const targets = this.layout.validMovementTargets(state.document, sourceId);
    this.#movement = {
      documentId: state.document.id,
      revision: state.document.revision,
      sourceId,
      targets,
    };
    return structuredClone(targets);
  }

  /** Where a new block may be dropped, by block and side; the command validates again. */
  insertionTargets(): readonly CanvasMovementTarget[] {
    const state = this.session.getState();
    if (state.readOnly) return [];
    const cached = this.#insertion;
    if (cached && this.same(cached, state.document)) return structuredClone(cached.targets);
    const targets: CanvasMovementTarget[] = [];
    for (const region of this.layout.selectionRegions(state.document)) {
      const placements = (['before', 'after', 'inside'] as const).filter(
        (placement) =>
          (placement !== 'inside' || region.container) &&
          !!this.layout.insertionAt(state.document, region.id, placement),
      );
      if (placements.length) targets.push({ targetId: region.id, placements });
    }
    this.#insertion = {
      documentId: state.document.id,
      revision: state.document.revision,
      targets,
    };
    return structuredClone(targets);
  }

  propertyCapabilities(): PropertyCapabilities | undefined {
    const selected = this.selected();
    const region = selected ? this.resolve(selected.id) : undefined;
    if (!selected || !region) return undefined;
    const properties = this.catalog.properties(selected.node);
    return {
      attributes: properties
        .filter((property) => property.kind === 'attribute')
        .map((property) => property.name),
      styles: properties
        .filter((property) => property.kind === 'style')
        .map((property) => property.name),
      richText: region.editable && this.outline.richText(selected.node) !== undefined,
      blocks: region.editable && this.catalog.richTextAllowsBlocks(selected.node),
      container: region.container,
      kind: region.kind,
    };
  }
}
