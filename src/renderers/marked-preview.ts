import type { DocumentKind, SourceInput } from '../core/document';
import { EDIT_NODE_ATTRIBUTE, NODE_ATTRIBUTE, isReservedAttribute } from '../core/canvas-contract';
import type { SecureIdentifier } from '../security/identity';
import type { CanvasBridgeRegion } from './canvas-bridge';
import type { MarkupElement, MarkupParent } from './markup-tree';
import { markupChildren, stripReservedAttributes } from './markup-tree';
import type {
  OpenedPreview,
  PreviewFrameDocument,
  PreviewFrameOptions,
  SelectionPreview,
  SelectionPreviewSource,
} from './preview-frame';

/**
 * The preview of a block piece (schema 2) for the editing frame: the output of the generators
 * in preview mode, already marked with `data-visual-editor-node` and
 * `data-visual-editor-edit-node`, and the regions of its blocks.
 */
export interface BlockPreviewInput {
  readonly id: string;
  readonly revision: number;
  readonly kind: DocumentKind;
  readonly source: SourceInput;
  readonly regions: readonly CanvasBridgeRegion[];
}

/**
 * Builds the frame document of a block piece and keeps the marks the generators wrote. A mark
 * is kept only for a block of the piece, once per block, and an edit mark only for an editable
 * block, inside its own selectable element; every other reserved attribute is removed. The
 * content rules of the blocks already refuse those attributes in free HTML: this is the second
 * barrier, so markup of the author can never pose as a block.
 */
export class MarkedPreviewRenderer implements SelectionPreviewSource<BlockPreviewInput> {
  constructor(
    private readonly frame: PreviewFrameDocument,
    private readonly identifiers: SecureIdentifier,
  ) {}

  build(
    input: BlockPreviewInput,
    selectionLabel: string,
    options: PreviewFrameOptions = {},
  ): SelectionPreview {
    return this.render(input, selectionLabel, options, this.identifiers.next(), true);
  }

  update(
    input: BlockPreviewInput,
    selectionLabel: string,
    current: Pick<SelectionPreview, 'nonce'>,
    options: PreviewFrameOptions = {},
  ): SelectionPreview {
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(current.nonce)) throw new Error('INVALID_PREVIEW_NONCE');
    return this.render(input, selectionLabel, options, current.nonce, false);
  }

  private render(
    input: BlockPreviewInput,
    selectionLabel: string,
    options: PreviewFrameOptions,
    token: string,
    executable: boolean,
  ): SelectionPreview {
    const opened = this.frame.open(input.source, input.kind, selectionLabel, options);
    const known = new Map(input.regions.map((region) => [region.id, region]));
    if (known.size !== input.regions.length) throw new Error('PREVIEW_MAPPING_FAILED');
    const { nodes: found, edits } = this.keepMarks(opened, known, selectionLabel);
    // Regions whose block draws nothing (an image without address in the final output, say)
    // are left out; a region keeps the nearest drawn block above it as its parent.
    const drawn = (id: string | null): string | null => {
      let current = id;
      while (current !== null && !found.has(current))
        current = known.get(current)?.parentId ?? null;
      return current;
    };
    const regions = input.regions
      .filter((region) => found.has(region.id))
      .map((region) =>
        Object.freeze({
          ...region,
          parentId: drawn(region.parentId),
          // Without the element of its text, the block is selected but not edited in place.
          editable: region.editable && edits.has(region.id),
        }),
      );
    return this.frame.close(
      opened,
      {
        revision: input.revision,
        regions,
        nodeIds: regions.map((region) => region.id),
        token,
        executable,
      },
      options,
    );
  }

  /** Validates the marks in document order; returns the ids of the blocks and texts found. */
  private keepMarks(
    opened: OpenedPreview,
    known: ReadonlyMap<string, CanvasBridgeRegion>,
    selectionLabel: string,
  ): { readonly nodes: ReadonlySet<string>; readonly edits: ReadonlySet<string> } {
    stripReservedAttributes(opened.head);
    const nodes = new Set<string>();
    const edits = new Set<string>();
    const visit = (parent: MarkupParent, owners: readonly string[]): void => {
      for (const child of markupChildren(parent)) {
        if (!('tagName' in child)) continue;
        const element = child as MarkupElement;
        if (element.tagName === 'template') {
          stripReservedAttributes(element);
          continue;
        }
        const node = this.attribute(element, NODE_ATTRIBUTE);
        const edit = this.attribute(element, EDIT_NODE_ATTRIBUTE);
        element.attrs = element.attrs.filter((attribute) => !isReservedAttribute(attribute.name));
        let inside = owners;
        if (node !== undefined && known.has(node) && !nodes.has(node)) {
          nodes.add(node);
          inside = [...owners, node];
          element.attrs = element.attrs.filter((attribute) => attribute.name !== 'tabindex');
          element.attrs.push(
            { name: NODE_ATTRIBUTE, value: node },
            { name: 'tabindex', value: '0' },
          );
          if (!element.attrs.some((attribute) => attribute.name === 'title'))
            element.attrs.push({ name: 'title', value: selectionLabel });
        }
        if (
          edit !== undefined &&
          known.get(edit)?.editable &&
          !edits.has(edit) &&
          inside.at(-1) === edit
        ) {
          edits.add(edit);
          element.attrs.push({ name: EDIT_NODE_ATTRIBUTE, value: edit });
        }
        visit(element, inside);
      }
    };
    visit(opened.body, []);
    return { nodes, edits };
  }

  private attribute(element: MarkupElement, name: string): string | undefined {
    return element.attrs.find((attribute) => attribute.name === name)?.value;
  }
}
