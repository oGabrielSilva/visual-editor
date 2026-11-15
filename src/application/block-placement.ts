import type {
  Block,
  BlockDocument,
  BlockNodeType,
  BlockRules,
  BlockTarget,
} from '../core/block-document';

export type BlockPlacement = 'before' | 'after' | 'inside';

/** Where a block may land next to or inside one other block. */
export interface BlockPlacementTarget {
  readonly targetId: string;
  readonly placements: readonly BlockPlacement[];
}

interface Located {
  readonly block: Block;
  readonly parent: Block | undefined;
  readonly siblings: readonly Block[];
  readonly index: number;
}

/**
 * Where a block may go, by the rules of the block types: the drop targets of a drag, of a block
 * from the palette and the single step of "move up/down". Nothing here changes the piece; the
 * aggregate checks every command again.
 */
export class BlockPlacementService {
  constructor(private readonly rules: BlockRules) {}

  /** Targets for an existing block: never inside itself, never leaving a parent too empty. */
  movementTargets(document: BlockDocument, id: string): readonly BlockPlacementTarget[] {
    const located = this.locate(document, id);
    if (!located) return [];
    const leaving = located.parent;
    if (leaving && located.siblings.length - 1 < this.rules.childCount(leaving.type).min) return [];
    return this.targets(document, located.block.type, located.block);
  }

  /** Targets for a new block of a type. */
  insertionTargets(document: BlockDocument, type: BlockNodeType): readonly BlockPlacementTarget[] {
    if (!this.rules.allows(type, document.kind)) return [];
    return this.targets(document, type, undefined);
  }

  /** The command target of a placement next to or inside a block. */
  target(targetId: string, placement: BlockPlacement): BlockTarget {
    return placement === 'inside'
      ? { position: 'inside', parentId: targetId }
      : { position: placement, id: targetId };
  }

  /**
   * One step up or down: past the sibling on that side, or, at the edge of its parent, into the
   * neighbouring container of the same type (the next column or section).
   */
  step(document: BlockDocument, id: string, direction: 'up' | 'down'): BlockTarget | undefined {
    const located = this.locate(document, id);
    if (!located) return undefined;
    const neighbour = located.siblings[located.index + (direction === 'up' ? -1 : 1)];
    if (neighbour)
      return direction === 'up'
        ? { position: 'before', id: neighbour.id }
        : { position: 'after', id: neighbour.id };
    const parent = located.parent;
    if (!parent) return undefined;
    if (located.siblings.length - 1 < this.rules.childCount(parent.type).min) return undefined;
    const outer = this.locate(document, parent.id);
    const container = outer?.siblings[outer.index + (direction === 'up' ? -1 : 1)];
    if (!container || !this.accepts(container, located.block.type)) return undefined;
    return {
      position: 'inside',
      parentId: container.id,
      index: direction === 'up' ? (container.children?.length ?? 0) : 0,
    };
  }

  private targets(
    document: BlockDocument,
    type: BlockNodeType,
    moving: Block | undefined,
  ): readonly BlockPlacementTarget[] {
    const result: BlockPlacementTarget[] = [];
    const visit = (blocks: readonly Block[], parent: Block | undefined): void => {
      const besides =
        parent === undefined
          ? this.rules.isRoot(type)
          : this.rules.childTypes(parent.type).includes(type) &&
            (blocks.includes(moving as Block) ||
              blocks.length < this.rules.childCount(parent.type).max);
      for (const block of blocks) {
        if (block === moving) continue;
        const placements: BlockPlacement[] = besides ? ['before', 'after'] : [];
        if (this.accepts(block, type) && !block.children?.includes(moving as Block))
          placements.push('inside');
        if (placements.length) result.push({ targetId: block.id, placements });
        visit(block.children ?? [], block);
      }
    };
    visit(document.blocks, undefined);
    return result;
  }

  private accepts(container: Block, type: BlockNodeType): boolean {
    return (
      this.rules.childTypes(container.type).includes(type) &&
      (container.children?.length ?? 0) < this.rules.childCount(container.type).max
    );
  }

  private locate(document: BlockDocument, id: string): Located | undefined {
    const stack: { blocks: readonly Block[]; parent: Block | undefined }[] = [
      { blocks: document.blocks, parent: undefined },
    ];
    while (stack.length) {
      const frame = stack.pop();
      if (!frame) break;
      for (let index = 0; index < frame.blocks.length; index++) {
        const block = frame.blocks[index];
        if (!block) continue;
        if (block.id === id) return { block, parent: frame.parent, siblings: frame.blocks, index };
        if (block.children) stack.push({ blocks: block.children, parent: block });
      }
    }
    return undefined;
  }
}
