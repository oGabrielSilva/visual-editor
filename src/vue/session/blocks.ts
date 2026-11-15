import type { AssetReference } from '../../application/host';
import type { EditorSession } from '../../application/session';
import type {
  CanvasLayout,
  CanvasMotion,
  CanvasPlacement,
  CanvasRegion,
  CanvasTarget,
} from '../../core/canvas-layout';
import type { EditorDocumentData, SourceInput } from '../../core/document';
import type { TemplateCatalog } from '../../templates/catalog';
import type { MutationGuard } from './guard';

/** Commands which add, move, duplicate and remove blocks, each one validated by the session. */
export class BlockEditing {
  constructor(
    private readonly session: EditorSession,
    private readonly layout: CanvasLayout,
    private readonly templates: TemplateCatalog,
    private readonly guard: MutationGuard,
  ) {}

  /**
   * Where something new lands: next to `targetId`, at the selected block, or (`end`) after all
   * the content whatever is selected.
   */
  private destination(
    targetId: string | undefined,
    placement: CanvasPlacement,
    end = false,
  ): CanvasTarget | undefined {
    const state = this.session.getState();
    if (end) return this.layout.insertionTarget(state.document);
    return targetId
      ? this.layout.insertionAt(state.document, targetId, placement)
      : this.layout.insertionTarget(state.document, state.selectedNodeId);
  }

  /** A block of the catalog, compiled when it is of an e-mail, where `destination` says. */
  async add(
    type: string,
    targetId: string | undefined,
    placement: CanvasPlacement,
    end = false,
  ): Promise<boolean> {
    if (!this.guard.prepareMutation()) return false;
    const initial = this.session.getState();
    const destination = this.destination(targetId, placement, end);
    if (!destination) return false;
    const source = await this.templates.createBlock(type, initial.document.kind);
    return (
      this.guard.isCurrent(initial) &&
      this.session.insertSource(source, destination.parentId, destination.index)
    );
  }

  /** Markup next to a block, at the selection or at the end: the paste of a copied block. */
  insertSource(
    source: SourceInput,
    targetId: string | undefined,
    placement: CanvasPlacement,
    end = false,
  ): boolean {
    if (!this.guard.prepareMutation()) return false;
    const destination = this.destination(targetId, placement, end);
    return (
      !!destination && this.session.insertSource(source, destination.parentId, destination.index)
    );
  }

  /** Replaces the whole source through the ordinary import: one validated history step. */
  replaceSource(source: SourceInput): boolean {
    return this.guard.prepareMutation() && this.session.importSource(source);
  }

  async applyTemplate(id: string): Promise<boolean> {
    if (!this.guard.prepareMutation()) return false;
    const initial = this.session.getState();
    const source = await this.templates.create(id);
    return this.guard.isCurrent(initial) && this.session.importSource(source);
  }

  moveTo(sourceId: string, targetId: string, placement: CanvasPlacement): boolean {
    if (!this.guard.prepareMutation()) return false;
    const document = this.session.getState().document;
    const movement = this.layout.motion(document, sourceId, targetId, placement);
    return (
      !!movement && this.session.moveBlock(movement.sourceId, movement.parentId, movement.index)
    );
  }

  act(id: string, action: 'duplicate' | 'remove' | 'up' | 'down'): boolean {
    if (!this.guard.prepareMutation()) return false;
    const document = this.session.getState().document;
    const region = this.layout.actionUnit(document, id);
    if (!region) return false;
    if (action === 'duplicate') return this.session.duplicateBlock(region.id);
    if (action === 'remove') return this.session.removeBlock(region.id);
    if (action !== 'up' && action !== 'down') return false;
    const motion = this.step(document, id, region, action === 'up' ? -1 : 1);
    return !!motion && this.session.moveBlock(motion.sourceId, motion.parentId, motion.index);
  }

  /**
   * One step of a block up or down, by keyboard or by the buttons of the bar. Next to a sibling
   * it passes it, entering it first when the sibling is a container which takes the block; at
   * the edge of its container it leaves it, before or after the closest ancestor which takes it,
   * or, where that is refused, into the container beside that ancestor.
   * Every candidate goes through the same check as a drop, so the step lands only where a drag
   * could, and it is one move of the session: one step of undo.
   */
  private step(
    document: EditorDocumentData,
    id: string,
    region: CanvasRegion,
    direction: -1 | 1,
  ): CanvasMotion | undefined {
    const source = this.layout.resolveSelection(document, id);
    const regions =
      source?.id === region.id
        ? this.layout.selectionRegions(document)
        : this.layout.regions(document);
    const siblings = regions
      .filter((candidate) => candidate.parentId === region.parentId)
      .sort((left, right) => left.index - right.index);
    const position = siblings.findIndex((candidate) => candidate.id === region.id);
    const neighbour = siblings[position + direction];
    const parents = this.layout.selectionParents(document);
    const containers = new Set(
      this.layout
        .selectionRegions(document)
        .filter((candidate) => candidate.container)
        .map((candidate) => candidate.id),
    );
    const placement: CanvasPlacement = direction < 0 ? 'before' : 'after';
    const candidates: [string, CanvasPlacement][] = [];
    if (neighbour) {
      if (!region.container && neighbour.container)
        candidates.push(...this.entry(parents, containers, neighbour.id, direction));
      candidates.push([neighbour.id, placement]);
    } else {
      const seen = new Set<string>();
      let parent = region.parentId
        ? this.layout.resolveSelection(document, region.parentId)?.id
        : undefined;
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        // Out of the container, next to it; where that is refused (the rows of an e-mail), into
        // the container beside it, as if the block had crossed the edge between the two.
        candidates.push([parent, placement]);
        const owner = parents.get(parent);
        const level = [...parents].filter(([, above]) => above === owner).map(([id]) => id);
        const beside = level[level.indexOf(parent) + direction];
        if (beside && !region.container && containers.has(beside))
          candidates.push(...this.entry(parents, containers, beside, direction));
        parent = owner;
      }
    }
    for (const [targetId, where] of candidates) {
      const motion = this.layout.motion(document, region.id, targetId, where);
      if (motion) return motion;
    }
    return undefined;
  }

  /**
   * Where a block enters a container it moves into: the near edge of its deepest container
   * first (the top going down, the end going up), then each shallower level.
   */
  private entry(
    parents: ReadonlyMap<string, string | undefined>,
    containers: ReadonlySet<string>,
    containerId: string,
    direction: -1 | 1,
  ): [string, CanvasPlacement][] {
    const children = (id: string): string[] =>
      [...parents].filter(([, parent]) => parent === id).map(([child]) => child);
    const result: [string, CanvasPlacement][] = [];
    const seen = new Set<string>();
    let current: string | undefined = containerId;
    while (current && containers.has(current) && !seen.has(current)) {
      seen.add(current);
      const list = children(current);
      const edge = direction > 0 ? list[0] : list.at(-1);
      if (!edge) {
        result.unshift([current, 'inside']);
        break;
      }
      result.unshift([edge, direction > 0 ? 'before' : 'after']);
      current = edge;
    }
    return result;
  }

  connectFormReference(reference: string, nodeId?: string): boolean {
    if (!this.guard.prepareMutation()) return false;
    const state = this.session.getState();
    if (nodeId) {
      const node = this.layout.resolveSelection(state.document, nodeId)?.node;
      return !!node && this.session.connectFormReference(reference, node.id);
    }
    const destination = this.layout.insertionTarget(state.document, state.selectedNodeId);
    return (
      !!destination &&
      this.session.connectFormReference(
        reference,
        undefined,
        destination.parentId,
        destination.index,
      )
    );
  }

  attachAsset(asset: AssetReference, nodeId?: string): boolean {
    if (!this.guard.prepareMutation()) return false;
    const state = this.session.getState();
    if (nodeId) {
      const node = this.layout.resolveSelection(state.document, nodeId)?.node;
      return !!node && this.session.attachAsset(asset, node.id);
    }
    const destination = this.layout.insertionTarget(state.document, state.selectedNodeId);
    return (
      !!destination &&
      this.session.attachAsset(asset, undefined, destination.parentId, destination.index)
    );
  }
}
