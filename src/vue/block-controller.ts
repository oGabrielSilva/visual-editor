import type {
  Block,
  BlockDevice,
  BlockDocumentData,
  BlockNodeType,
  BlockPropValue,
  BlockProps,
  BlockTarget,
} from '../core/block-document';
import type { DocumentKind } from '../core/document';
import type {
  BlockEditorSession,
  BlockEditorState,
  BlockImageChoice,
} from '../application/block-session';
import type { BlockPlacement, BlockPlacementService } from '../application/block-placement';
import type { BlockPlacementTarget } from '../application/block-placement';
import type { BlockDefinitionRegistry } from '../blocks/definitions';
import type {
  BlockFieldModel,
  BlockInspector,
  GlobalStyleGroupModel,
} from '../blocks/block-inspector';
import type { BlockOutputRenderer } from '../blocks/block-output';
import { BlockChecker } from '../blocks/block-checks';
import type { BlockCheck } from '../blocks/block-checks';
import type { BlockPreviewInput } from '../renderers/marked-preview';
import type { BlockTemplateCatalog, BlockTemplateDescriptor } from '../templates/blocks/catalog';
import type { UrlPolicy } from '../security/url-policy';
import type { InlineTextOwner } from './canvas/inline-text';

export interface BlockEditorControllerParts {
  readonly session: BlockEditorSession;
  readonly registry: BlockDefinitionRegistry;
  readonly inspector: BlockInspector;
  readonly placement: BlockPlacementService;
  readonly templates: BlockTemplateCatalog;
  readonly output: BlockOutputRenderer;
  readonly urls: UrlPolicy;
}

export type BlockDestination = { readonly targetId: string; readonly placement: BlockPlacement };

/** Types the palette never offers alone: a column only exists inside its section. */
const STRUCTURAL: readonly BlockNodeType[] = ['column'];

/**
 * Facade of a block piece (schema 2) for the Vue shell: queries the panels are generated from,
 * and the commands of the session, each one a step of history. Components never reach the
 * session or the definitions directly.
 */
export class BlockEditorController {
  readonly session: BlockEditorSession;
  readonly #parts: BlockEditorControllerParts;
  #textOwner: InlineTextOwner | undefined;

  constructor(parts: BlockEditorControllerParts) {
    this.session = parts.session;
    this.#parts = parts;
  }

  state(): BlockEditorState {
    return this.session.getState();
  }

  subscribe(listener: (state: BlockEditorState) => void): () => void {
    return this.session.subscribe(listener);
  }

  kind(): DocumentKind {
    return this.session.document().kind;
  }

  /** The block types of the palette, in catalog order. */
  types(): readonly { readonly type: BlockNodeType; readonly labelKey: string }[] {
    return this.#parts.registry
      .list(this.kind())
      .filter((definition) => !STRUCTURAL.includes(definition.type))
      .map((definition) => ({ type: definition.type, labelKey: definition.labelKey }));
  }

  templates(): readonly BlockTemplateDescriptor[] {
    return this.#parts.templates.list(this.kind());
  }

  typeOf(id: string): BlockNodeType | undefined {
    return this.session.document().find(id)?.type;
  }

  labelKey(id: string): string | undefined {
    const block = this.session.document().find(id);
    return block ? this.#parts.registry.definition(block.type).labelKey : undefined;
  }

  /** The fields of a block as the given screen shows them. */
  fields(id: string, device: BlockDevice = 'desktop'): readonly BlockFieldModel[] {
    return this.#parts.inspector.fields(this.state().document, id, device);
  }

  globalStyles(): readonly GlobalStyleGroupModel[] {
    return this.#parts.inspector.styles(this.state().document);
  }

  parentOf(id: string): string | undefined {
    return this.session.document().parentOf(id);
  }

  /**
   * The review before sending: what the piece has that a reader would meet broken. For an
   * e-mail the final HTML is generated to measure it against the cut of Gmail.
   */
  async review(): Promise<readonly BlockCheck[]> {
    const document = this.session.document();
    const html =
      document.kind === 'email' ? (await this.#parts.output.render(document)).html : undefined;
    return new BlockChecker().check(document, html);
  }

  /** The marked preview of the current revision, for the editing frame. */
  preview(): Promise<BlockPreviewInput> {
    return this.#parts.output.preview(this.session.document());
  }

  movementTargets(id: string): readonly BlockPlacementTarget[] {
    return this.#parts.placement.movementTargets(this.session.document(), id);
  }

  insertionTargets(type: BlockNodeType): readonly BlockPlacementTarget[] {
    return this.#parts.placement.insertionTargets(this.session.document(), type);
  }

  select(id: string | undefined): boolean {
    return this.session.select(id);
  }

  /**
   * A new block where it fits best: at the destination given, else inside or after the
   * selection (or the first of its ancestors which accepts it), else at the end of the piece. A
   * content block in a piece without a place for it arrives in a new section.
   */
  insert(
    type: BlockNodeType,
    destination?: BlockDestination | 'end',
    props: BlockProps = {},
  ): boolean {
    const target =
      destination && destination !== 'end'
        ? this.#parts.placement.target(destination.targetId, destination.placement)
        : this.automaticTarget(type, destination === 'end');
    if (target) return this.session.insert(type, target, props) !== undefined;
    const section = this.#parts.registry.create('section', () => this.session.newId());
    const block = this.#parts.registry.create(type, () => this.session.newId(), props);
    const column = section.children?.[0];
    if (!column || !this.#parts.registry.childTypes('column').includes(type)) return false;
    const wrapped: Block = { ...section, children: [{ ...column, children: [block] }] };
    if (this.session.insertBlock(wrapped, { position: 'inside' }) === undefined) return false;
    return this.session.select(block.id);
  }

  /**
   * A block saved in the library of the host, with new ids, where it fits best (as `insert` places a new
   * block). It enters only if the piece accepts it: the document parses and checks it like any
   * block from outside. A content block in a piece without a place for it gets a new section.
   */
  insertSaved(saved: Block): boolean {
    if (!saved || typeof saved !== 'object' || STRUCTURAL.includes(saved.type)) return false;
    let block: Block;
    try {
      block = this.reidentify(saved);
    } catch {
      return false;
    }
    const target = this.automaticTarget(block.type, false);
    if (target) return this.session.insertBlock(block, target) !== undefined;
    if (!this.#parts.registry.childTypes('column').includes(block.type)) return false;
    const section = this.#parts.registry.create('section', () => this.session.newId());
    const column = section.children?.[0];
    if (!column) return false;
    const wrapped: Block = { ...section, children: [{ ...column, children: [block] }] };
    if (this.session.insertBlock(wrapped, { position: 'inside' }) === undefined) return false;
    return this.session.select(block.id);
  }

  /** A copy of a block to save for later use; a column only exists inside its section. */
  savable(id: string): Block | undefined {
    const block = this.session.document().find(id);
    return block && !STRUCTURAL.includes(block.type) ? structuredClone(block) : undefined;
  }

  move(sourceId: string, targetId: string, placement: BlockPlacement): boolean {
    return this.session.move(sourceId, this.#parts.placement.target(targetId, placement));
  }

  step(id: string, direction: 'up' | 'down'): boolean {
    const target = this.#parts.placement.step(this.session.document(), id, direction);
    return !!target && this.session.move(id, target);
  }

  duplicate(id: string): boolean {
    return this.session.duplicate(id);
  }

  remove(id: string): boolean {
    return this.session.remove(id);
  }

  /** A value of every screen, or of small screens only when the field is responsive. */
  setField(
    id: string,
    key: string,
    value: BlockPropValue,
    device: BlockDevice = 'desktop',
  ): boolean {
    return this.session.updateProps(id, { [key]: value }, this.deviceFor(id, key, device));
  }

  restoreField(id: string, key: string, device: BlockDevice = 'desktop'): boolean {
    return this.session.restoreDefault(id, [key], this.deviceFor(id, key, device));
  }

  replaceImage(id: string, choice: BlockImageChoice): boolean {
    return this.session.replaceImage(id, choice);
  }

  setStyle(group: string, key: string, value: string): boolean {
    return this.session.updateStyles({ [group]: { [key]: value } });
  }

  restoreStyle(group: string, key: string): boolean {
    return this.session.restoreStyleDefault(group, [key]);
  }

  setLanguage(lang: string): boolean {
    return this.session.setLanguage(lang);
  }

  /**
   * The piece starts again from a template: one step of history, same id, kind and language
   * (the texts of the template in that language when it has them).
   */
  applyTemplate(templateId: string): boolean {
    const current = this.session.document();
    try {
      return this.session.replace(
        this.#parts.templates.create(
          templateId,
          current.id,
          () => this.session.newId(),
          current.kind,
          current.meta.lang,
        ),
      );
    } catch {
      return false;
    }
  }

  undo(): boolean {
    return this.session.undo();
  }

  redo(): boolean {
    return this.session.redo();
  }

  save(): Promise<boolean> {
    return this.session.save();
  }

  /** Saves and returns the exact piece the store received, or undefined. */
  saveDocument(): Promise<BlockDocumentData | undefined> {
    return this.session.saveDocument();
  }

  /**
   * The text edited in place, in the terms of the coordinator the HTML document also uses: one
   * transaction per text, confirmed as one step of history.
   */
  textOwner(): InlineTextOwner {
    this.#textOwner ??= {
      linkPolicy: () => this.#parts.urls,
      state: () => {
        const state = this.state();
        return {
          pendingRichText: state.pendingText,
          document: state.document,
          readOnly: state.readOnly,
        };
      },
      select: (id) => this.session.select(id),
      beginRichText: (id) => this.session.beginText(id),
      updateRichTextDraft: (html) => this.session.updateTextDraft(html),
      commitRichText: () => this.session.commitText(),
      cancelRichText: () => this.session.cancelText(),
    };
    return this.#textOwner;
  }

  /** The same block with ids of this session, so two copies never share one. */
  private reidentify(block: Block): Block {
    if (!block || typeof block !== 'object') throw new Error('INVALID_SAVED_BLOCK');
    const children = Array.isArray(block.children) ? block.children : undefined;
    return {
      ...block,
      id: this.session.newId(),
      ...(children ? { children: children.map((child) => this.reidentify(child)) } : {}),
    };
  }

  /** A field without mobile values is edited for every screen, whatever screen is shown. */
  private deviceFor(id: string, key: string, device: BlockDevice): BlockDevice {
    const type = this.typeOf(id);
    return device === 'mobile' && type && this.session.document().responsive(type, key)
      ? 'mobile'
      : 'desktop';
  }

  private automaticTarget(type: BlockNodeType, end: boolean): BlockTarget | undefined {
    const document = this.session.document();
    const registry = this.#parts.registry;
    const selected = end ? undefined : this.state().selectedBlockId;
    for (let id = selected; id !== undefined; id = document.parentOf(id)) {
      const block = document.find(id);
      if (!block) break;
      if (registry.childTypes(block.type).includes(type))
        return { position: 'inside', parentId: block.id };
      const parent = document.parentOf(id);
      const parentType = parent ? document.find(parent)?.type : undefined;
      if (parentType ? registry.childTypes(parentType).includes(type) : registry.isRoot(type))
        return { position: 'after', id: block.id };
    }
    if (registry.isRoot(type)) return { position: 'inside' };
    const containers = this.insertionTargets(type).filter((entry) =>
      entry.placements.includes('inside'),
    );
    const last = containers.at(-1);
    return last ? { position: 'inside', parentId: last.targetId } : undefined;
  }
}
