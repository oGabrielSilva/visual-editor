import type { DocumentNode, EditorDocumentData } from './document';
import { BlockCatalog } from './catalog';
import type { BlockType } from './catalog';

export type CanvasPlacement = 'before' | 'after' | 'inside';
export interface CanvasTarget {
  readonly parentId?: string;
  /** Index after removing the moving source. Insertion indices have no removal adjustment. */
  readonly index: number;
}
export interface CanvasMotion extends CanvasTarget {
  readonly sourceId: string;
}
export interface CanvasMovementTarget {
  readonly targetId: string;
  readonly placements: readonly CanvasPlacement[];
}
export interface CanvasRegion {
  readonly id: string;
  readonly parentId: string | null;
  readonly index: number;
  readonly depth: number;
  readonly kind: BlockType | 'container' | 'native';
  readonly labelKey?: string;
  readonly node: DocumentNode;
  readonly editable: boolean;
  readonly container: boolean;
}
interface NodeLocation {
  readonly node: DocumentNode;
  readonly parentId: string | null;
  readonly index: number;
}

interface MovementProjection {
  readonly locations: ReadonlyMap<string, NodeLocation>;
  readonly structural: ReadonlyMap<string, CanvasRegion>;
  readonly selection: ReadonlyMap<string, CanvasRegion>;
}

const infrastructure = new Set([
  'html',
  'body',
  'head',
  'style',
  'script',
  'title',
  'meta',
  'link',
]);

/**
 * Elements which draw nothing in the canvas: they are part of the document, written back as
 * they came, but are neither selected nor moved as content.
 */
const unrendered = new Set([
  'head',
  'style',
  'script',
  'title',
  'meta',
  'link',
  'base',
  'noscript',
  'template',
  'noembed',
  'noframes',
]);

/** Logical canvas regions and valid destinations derived from the canonical HTML tree. */
export class CanvasLayout {
  constructor(private readonly catalog = new BlockCatalog()) {}

  regions(document: EditorDocumentData): readonly CanvasRegion[] {
    const regions: CanvasRegion[] = [];
    const walk = (nodes: readonly DocumentNode[], parentId: string | null, depth: number): void => {
      nodes.forEach((node, index) => {
        if (node.type !== 'element' || unrendered.has(node.tag ?? '')) return;
        const region = this.region(node, parentId, index, depth);
        if (region) regions.push(region);
        // A text/media row is an atomic HTML unit. Its descendants resolve to that region.
        if (region && !region.container) return;
        walk(node.children ?? [], node.id, region ? depth + 1 : depth);
      });
    };
    walk(document.nodes, null, 0);
    return structuredClone(regions);
  }

  /** Content selection is independent of the HTML unit used by structural commands. */
  selectionRegions(document: EditorDocumentData): readonly CanvasRegion[] {
    const regions: CanvasRegion[] = [];
    const containers = new Set(
      this.regions(document)
        .filter((region) => region.container)
        .map((region) => region.id),
    );
    const walk = (nodes: readonly DocumentNode[], parentId: string | null, depth: number): void => {
      nodes.forEach((node, index) => {
        if (node.type !== 'element' || unrendered.has(node.tag ?? '')) return;
        const region = this.region(node, parentId, index, depth);
        const composite = this.hasRichTextBlocks(node);
        const structuralRow = node.tag === 'tr';
        if (region) {
          regions.push({
            ...region,
            ...(composite || (structuralRow && !region.container)
              ? { kind: 'container' as const, editable: false }
              : {}),
            container: region.container && containers.has(region.id),
          });
        }
        // Inline marks belong to their text block; composed content retains its own targets.
        if (
          region &&
          !region.container &&
          !composite &&
          !structuralRow &&
          !this.isContentWrapper(node, region.editable)
        )
          return;
        walk(node.children ?? [], node.id, region ? depth + 1 : depth);
      });
    };
    walk(document.nodes, null, 0);
    return structuredClone(regions);
  }

  /**
   * The closest selection region above each selection region, in document order; `undefined`
   * for a region at the top. Plain markup between two regions is skipped, as in the piece.
   */
  selectionParents(document: EditorDocumentData): ReadonlyMap<string, string | undefined> {
    const locations = this.locations(document);
    const regions = this.selectionRegions(document);
    const ids = new Set(regions.map((region) => region.id));
    const result = new Map<string, string | undefined>();
    for (const region of regions) {
      let parentId = region.parentId;
      while (parentId && !ids.has(parentId)) parentId = locations.get(parentId)?.parentId ?? null;
      result.set(region.id, parentId ?? undefined);
    }
    return result;
  }

  resolveSelection(document: EditorDocumentData, id: string): CanvasRegion | undefined {
    const locations = this.locations(document);
    const regions = new Map(this.selectionRegions(document).map((region) => [region.id, region]));
    let location = locations.get(id);
    while (location) {
      const region = regions.get(location.node.id);
      if (region) return region;
      location = location.parentId ? locations.get(location.parentId) : undefined;
    }
    return undefined;
  }

  resolve(document: EditorDocumentData, id: string): CanvasRegion | undefined {
    const locations = this.locations(document);
    const regions = new Map(this.regions(document).map((region) => [region.id, region]));
    let location = locations.get(id);
    while (location) {
      const region = regions.get(location.node.id);
      if (region) return region;
      location = location.parentId ? locations.get(location.parentId) : undefined;
    }
    return undefined;
  }

  editableNode(document: EditorDocumentData, id: string): DocumentNode | undefined {
    const region = this.resolve(document, id);
    if (!region) return undefined;
    return structuredClone(
      region.node.tag === 'tr' ? (this.rowContent(region.node) ?? region.node) : region.node,
    );
  }

  target(
    document: EditorDocumentData,
    sourceId: string,
    targetId: string,
    placement: CanvasPlacement,
  ): CanvasTarget | undefined {
    const locations = this.locations(document);
    const regions = new Map(this.regions(document).map((region) => [region.id, region]));
    const source = this.resolveRegion(regions, locations, sourceId);
    const target = this.resolveRegion(regions, locations, targetId);
    return this.structuralTarget(document, locations, source, target, placement);
  }

  motion(
    document: EditorDocumentData,
    sourceId: string,
    targetId: string,
    placement: CanvasPlacement,
  ): CanvasMotion | undefined {
    const projection = this.movementProjection(document);
    const source = this.resolveRegion(projection.selection, projection.locations, sourceId);
    const target = this.resolveRegion(projection.selection, projection.locations, targetId);
    return this.motionUsing(document, projection, source, target, placement);
  }

  validMovementTargets(
    document: EditorDocumentData,
    sourceId: string,
  ): readonly CanvasMovementTarget[] {
    const projection = this.movementProjection(document);
    const source = this.resolveRegion(projection.selection, projection.locations, sourceId);
    if (!source) return [];
    const result: CanvasMovementTarget[] = [];
    for (const target of projection.selection.values()) {
      const placements = (['before', 'after', 'inside'] as const).filter((placement) =>
        Boolean(this.motionUsing(document, projection, source, target, placement)),
      );
      if (placements.length) result.push({ targetId: target.id, placements });
    }
    return result;
  }

  actionUnit(document: EditorDocumentData, id: string): CanvasRegion | undefined {
    const projection = this.movementProjection(document);
    const selected = this.resolveRegion(projection.selection, projection.locations, id);
    const structural = this.resolveRegion(projection.structural, projection.locations, id);
    if (!selected || !structural) return undefined;
    const parent = selected.parentId
      ? projection.locations.get(selected.parentId)?.node
      : undefined;
    const hasSibling = (parent?.children ?? document.nodes).some(
      (node) => node.id !== selected.id && (node.type !== 'text' || !!node.value?.trim()),
    );
    if (
      this.isContentUnit(selected) &&
      hasSibling &&
      (parent
        ? this.catalog.acceptsChildren(parent, [selected.node])
        : this.catalog.acceptsRootChildren([selected.node]))
    )
      return selected;
    return structural;
  }

  insertionAt(
    document: EditorDocumentData,
    targetId: string,
    placement: CanvasPlacement,
  ): CanvasTarget | undefined {
    const region = this.resolve(document, targetId);
    return region ? this.regionDestination(region, placement) : undefined;
  }

  insertionTarget(document: EditorDocumentData, selectedId?: string): CanvasTarget | undefined {
    if (selectedId) {
      const region = this.resolve(document, selectedId);
      if (!region) return undefined;
      return this.insertionAt(document, region.id, region.container ? 'inside' : 'after');
    }
    const body = this.findTag(document.nodes, 'body');
    const roots = body?.children ?? document.nodes;
    const visible = roots.filter(
      (node) => node.type === 'element' && !infrastructure.has(node.tag ?? ''),
    );
    const root = visible.length === 1 ? visible[0] : undefined;
    if (root && this.region(root, body?.id ?? null, 0, 0)?.container) {
      const parent = this.contentTarget(root);
      return { parentId: parent.id, index: parent.children?.length ?? 0 };
    }
    return { ...(body ? { parentId: body.id } : {}), index: roots.length };
  }

  acceptsInsertion(
    document: EditorDocumentData,
    destination: CanvasTarget,
    nodes: readonly DocumentNode[],
  ): boolean {
    return this.acceptsAt(document, this.locations(document), destination, nodes);
  }

  private movementProjection(document: EditorDocumentData): MovementProjection {
    return {
      locations: this.locations(document),
      structural: new Map(this.regions(document).map((region) => [region.id, region])),
      selection: new Map(this.selectionRegions(document).map((region) => [region.id, region])),
    };
  }

  private resolveRegion(
    regions: ReadonlyMap<string, CanvasRegion>,
    locations: ReadonlyMap<string, NodeLocation>,
    id: string,
  ): CanvasRegion | undefined {
    let location = locations.get(id);
    while (location) {
      const region = regions.get(location.node.id);
      if (region) return region;
      location = location.parentId ? locations.get(location.parentId) : undefined;
    }
    return undefined;
  }

  private motionUsing(
    document: EditorDocumentData,
    projection: MovementProjection,
    source: CanvasRegion | undefined,
    target: CanvasRegion | undefined,
    placement: CanvasPlacement,
  ): CanvasMotion | undefined {
    if (!source || !target || source.id === target.id) return undefined;
    if (
      this.isContentUnit(source) &&
      source.parentId === target.parentId &&
      (placement === 'before' || placement === 'after')
    ) {
      const destination = {
        ...(target.parentId ? { parentId: target.parentId } : {}),
        index: target.index + (placement === 'after' ? 1 : 0),
      };
      if (this.acceptsAt(document, projection.locations, destination, [source.node])) {
        const index = destination.index - (source.index < destination.index ? 1 : 0);
        if (index === source.index) return undefined;
        return {
          sourceId: source.id,
          ...(destination.parentId ? { parentId: destination.parentId } : {}),
          index,
        };
      }
    }
    const structural = this.resolveRegion(projection.structural, projection.locations, source.id);
    const structuralTarget = this.resolveRegion(
      projection.structural,
      projection.locations,
      target.id,
    );
    const destination = this.structuralTarget(
      document,
      projection.locations,
      structural,
      structuralTarget,
      placement,
    );
    return structural && destination ? { sourceId: structural.id, ...destination } : undefined;
  }

  private structuralTarget(
    document: EditorDocumentData,
    locations: ReadonlyMap<string, NodeLocation>,
    source: CanvasRegion | undefined,
    target: CanvasRegion | undefined,
    placement: CanvasPlacement,
  ): CanvasTarget | undefined {
    if (!source || !target || source.id === target.id) return undefined;
    const destination = this.regionDestination(target, placement);
    if (
      !destination ||
      destination.parentId === source.id ||
      (destination.parentId && this.contains(source.node, destination.parentId))
    )
      return undefined;
    if (!this.acceptsAt(document, locations, destination, [source.node])) return undefined;
    const index =
      destination.index -
      (source.parentId === (destination.parentId ?? null) && source.index < destination.index
        ? 1
        : 0);
    if (source.parentId === (destination.parentId ?? null) && source.index === index)
      return undefined;
    return { ...(destination.parentId ? { parentId: destination.parentId } : {}), index };
  }

  private regionDestination(
    region: CanvasRegion,
    placement: CanvasPlacement,
  ): CanvasTarget | undefined {
    if (!['before', 'after', 'inside'].includes(placement)) return undefined;
    if (placement === 'inside') {
      if (!region.container) return undefined;
      const parent = this.contentTarget(region.node);
      return { parentId: parent.id, index: parent.children?.length ?? 0 };
    }
    return {
      ...(region.parentId ? { parentId: region.parentId } : {}),
      index: region.index + (placement === 'after' ? 1 : 0),
    };
  }

  private acceptsAt(
    document: EditorDocumentData,
    locations: ReadonlyMap<string, NodeLocation>,
    destination: CanvasTarget,
    nodes: readonly DocumentNode[],
  ): boolean {
    if (!Number.isInteger(destination.index) || destination.index < 0) return false;
    if (!destination.parentId)
      return destination.index <= document.nodes.length && this.catalog.acceptsRootChildren(nodes);
    const parent = locations.get(destination.parentId)?.node;
    return (
      !!parent &&
      destination.index <= (parent.children?.length ?? 0) &&
      this.catalog.acceptsChildren(parent, nodes)
    );
  }

  private isContentUnit(region: CanvasRegion): boolean {
    return (
      region.editable || ['image', 'button', 'divider', 'spacer', 'form'].includes(region.kind)
    );
  }

  private region(
    node: DocumentNode,
    parentId: string | null,
    index: number,
    depth: number,
  ): CanvasRegion | undefined {
    const tag = node.tag ?? '';
    if (infrastructure.has(tag) || tag === 'br') return undefined;
    const rowContent = tag === 'tr' ? this.rowContent(node) : undefined;
    const content = rowContent ?? node;
    const descriptor = this.catalog.recognize(content);
    const editable =
      this.catalog.canEditRichText(content) &&
      content.type === 'element' &&
      ['heading', 'text', 'button', 'footer'].includes(descriptor?.type ?? '');
    const rowCells = (node.children ?? []).filter(
      (child) => child.tag === 'td' || child.tag === 'th',
    );
    if (['tbody', 'thead', 'tfoot', 'colgroup', 'col'].includes(tag)) return undefined;
    if (tag === 'tr' && !rowContent && rowCells.length <= 1) return undefined;
    if (tag === 'table' && node.attrs?.role === 'presentation') return undefined;
    if (tag === 'div' && !descriptor && !this.hasVisibleContent(node)) return undefined;
    const container =
      !rowContent &&
      !editable &&
      (descriptor?.canContainChildren === true ||
        ['table', 'tr', 'td', 'th', 'ul', 'ol', 'dl'].includes(tag));
    return {
      id: node.id,
      parentId,
      index,
      depth,
      kind:
        tag === 'tr' && rowCells.length > 1
          ? 'columns'
          : (descriptor?.type ?? (container ? 'container' : 'native')),
      ...(descriptor ? { labelKey: descriptor.labelKey } : {}),
      node,
      editable,
      container,
    };
  }

  private rowContent(row: DocumentNode): DocumentNode | undefined {
    const cells = (row.children ?? []).filter((node) => node.tag === 'td' || node.tag === 'th');
    if (cells.length !== 1) return undefined;
    const childElements = (cells[0]?.children ?? []).filter((child) => child.type === 'element');
    if (
      this.findTag(cells[0]?.children ?? [], 'tr') &&
      !(childElements.length === 1 && childElements[0]?.tag === 'table')
    )
      return undefined;
    const candidates: DocumentNode[] = [];
    const visit = (node: DocumentNode): void => {
      if (node.type !== 'element') return;
      const descriptor = this.catalog.recognize(node);
      const children = (node.children ?? []).filter(
        (child) => child.type === 'element' || (child.type === 'text' && !!child.value?.trim()),
      );
      if (
        node.tag === 'div' &&
        children.length === 1 &&
        ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(children[0]?.tag ?? '')
      ) {
        visit(children[0]!);
        return;
      }
      if (
        ['td', 'th'].includes(node.tag ?? '') &&
        children.length === 1 &&
        ['a', 'img', 'hr'].includes(children[0]?.tag ?? '')
      ) {
        visit(children[0]!);
        return;
      }
      if (
        (this.catalog.canEditRichText(node) && this.hasVisibleContent(node)) ||
        ['image', 'button', 'divider', 'spacer', 'form'].includes(descriptor?.type ?? '')
      ) {
        candidates.push(node);
        return;
      }
      (node.children ?? []).forEach(visit);
    };
    (cells[0]?.children ?? []).forEach(visit);
    if (
      !candidates.length &&
      cells[0] &&
      this.hasVisibleContent(cells[0]) &&
      this.catalog.canEditRichText(cells[0])
    )
      candidates.push(cells[0]);
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  private hasRichTextBlocks(node: DocumentNode): boolean {
    return (
      this.catalog.richTextAllowsBlocks(node) &&
      (node.children ?? []).some((child) =>
        [
          'p',
          'ul',
          'ol',
          'li',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'blockquote',
          'pre',
          'hr',
        ].includes(child.tag ?? ''),
      )
    );
  }

  private isContentWrapper(node: DocumentNode, editable: boolean): boolean {
    return (
      !editable &&
      [
        'a',
        'p',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'span',
        'strong',
        'b',
        'em',
        'i',
        'u',
        's',
        'small',
        'sup',
        'sub',
        'code',
        'li',
        'pre',
        'summary',
        'figcaption',
        'blockquote',
      ].includes(node.tag ?? '')
    );
  }

  private contentTarget(node: DocumentNode): DocumentNode {
    const tag = node.tag ?? '';
    if (
      [
        'tbody',
        'thead',
        'tfoot',
        'td',
        'th',
        'body',
        'section',
        'article',
        'main',
        'header',
        'footer',
        'figure',
        'details',
      ].includes(tag)
    )
      return node;
    if (tag === 'tr') {
      const firstCell = (node.children ?? []).find(
        (child) => child.tag === 'td' || child.tag === 'th',
      );
      return firstCell ? this.contentTarget(firstCell) : node;
    }
    if (tag === 'table') {
      const body = (node.children ?? []).find((child) =>
        ['tbody', 'thead', 'tfoot'].includes(child.tag ?? ''),
      );
      return body ?? node;
    }
    // Compiled columns own a presentation table. Content moves as rows inside it.
    const table = (node.children ?? []).find(
      (child) => child.tag === 'table' && child.attrs?.role === 'presentation',
    );
    if (table) return this.contentTarget(table);
    return node;
  }

  private locations(document: EditorDocumentData): ReadonlyMap<string, NodeLocation> {
    const result = new Map<string, NodeLocation>();
    const visit = (nodes: readonly DocumentNode[], parentId: string | null): void => {
      nodes.forEach((node, index) => {
        result.set(node.id, { node, parentId, index });
        visit(node.children ?? [], node.id);
      });
    };
    visit(document.nodes, null);
    return result;
  }

  private hasVisibleContent(node: DocumentNode): boolean {
    return (node.children ?? []).some(
      (child) => child.type === 'element' || (child.type === 'text' && !!child.value?.trim()),
    );
  }

  private contains(node: DocumentNode, id: string): boolean {
    return node.id === id || (node.children ?? []).some((child) => this.contains(child, id));
  }

  private findTag(nodes: readonly DocumentNode[], tag: string): DocumentNode | undefined {
    for (const node of nodes) {
      if (node.tag === tag) return node;
      const child = this.findTag(node.children ?? [], tag);
      if (child) return child;
    }
    return undefined;
  }
}
