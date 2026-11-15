import type { CanvasMovementTarget, CanvasPlacement, CanvasRegion } from '../../core/canvas-layout';
import { BlockPresentation } from './block-presentation';

export interface StructureNode {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly icon: string;
  readonly container: boolean;
  readonly depth: number;
  readonly children?: StructureNode[];
}

export interface StructureEntry {
  readonly id: string;
  readonly label: string;
  readonly labelKey?: string;
}

const AUTO_EXPANDED_DEPTH = 2;

/**
 * The real hierarchy of selectable blocks. Regions arrive in document order with their depth, so
 * the tree is built in one pass, whatever plain markup lies between a block and its parent.
 */
export class StructureTree {
  private readonly presentation = new BlockPresentation();

  constructor(private readonly text: (key: string) => string) {}

  build(regions: readonly CanvasRegion[], entries: readonly StructureEntry[]): StructureNode[] {
    const details = new Map(entries.map((entry) => [entry.id, entry]));
    const roots: StructureNode[] = [];
    const stack: (StructureNode & { children: StructureNode[] })[] = [];
    for (const region of regions) {
      const depth = Math.max(0, region.depth);
      const entry = details.get(region.id);
      const label = this.text(this.presentation.regionLabelKey(region));
      const node = {
        id: region.id,
        label,
        // The excerpt names a piece of content; a container is named by what it is.
        detail:
          entry && !region.container && !entry.labelKey && entry.label !== region.node.tag
            ? entry.label
            : '',
        icon: this.presentation.regionIcon(region),
        container: region.container,
        depth,
        children: [] as StructureNode[],
      };
      stack.length = Math.min(stack.length, depth);
      const parent = stack[stack.length - 1];
      (parent ? parent.children : roots).push(node);
      stack.push(node);
    }
    return this.prune(roots);
  }

  private prune(nodes: StructureNode[]): StructureNode[] {
    return nodes.map((node) => {
      const { children, ...rest } = node;
      return children?.length ? { ...rest, children: this.prune(children) } : rest;
    });
  }

  /** Every ancestor of `id`, outermost first. */
  path(nodes: readonly StructureNode[], id: string): string[] {
    return this.trail(nodes, id) ?? [];
  }

  private trail(nodes: readonly StructureNode[], id: string): string[] | undefined {
    for (const node of nodes) {
      if (node.id === id) return [];
      const below = node.children ? this.trail(node.children, id) : undefined;
      if (below) return [node.id, ...below];
    }
    return undefined;
  }

  find(nodes: readonly StructureNode[], id: string): StructureNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = node.children ? this.find(node.children, id) : undefined;
      if (found) return found;
    }
    return undefined;
  }

  count(nodes: readonly StructureNode[]): number {
    return nodes.reduce((sum, node) => sum + 1 + this.count(node.children ?? []), 0);
  }

  /** Shallow levels start open; deep ones stay folded so a long piece remains readable. */
  defaultExpanded(nodes: readonly StructureNode[], depth = AUTO_EXPANDED_DEPTH): string[] {
    const result: string[] = [];
    const walk = (list: readonly StructureNode[]): void => {
      for (const node of list) {
        if (!node.children?.length || node.depth >= depth) continue;
        result.push(node.id);
        walk(node.children);
      }
    };
    walk(nodes);
    return result;
  }

  /**
   * Where a dragged row would land on the row under the pointer. `ratio` is the vertical position
   * inside that row; only placements the document accepts are returned.
   */
  placement(
    targets: readonly CanvasMovementTarget[],
    targetId: string,
    ratio: number,
    container: boolean,
  ): CanvasPlacement | undefined {
    const allowed = targets.find((target) => target.targetId === targetId)?.placements ?? [];
    const edge: CanvasPlacement = ratio < 0.5 ? 'before' : 'after';
    const order: CanvasPlacement[] =
      container && ratio > 0.25 && ratio < 0.75
        ? ['inside', edge]
        : [edge, ...(container ? (['inside'] as const) : [])];
    return order.find((candidate) => allowed.includes(candidate));
  }
}
