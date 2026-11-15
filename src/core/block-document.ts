import * as v from 'valibot';
import { DocumentBudget, DocumentBudgetError } from './budget';
import { DocumentValidationError } from './document';
import type { DocumentKind } from './document';

/**
 * Schema 2: a piece made of blocks. Each block keeps only the values its author set; what is
 * absent is inherited from the global styles of the piece, and those from the defaults of the
 * catalog. The HTML of an e-mail and of a page is generated from this tree, never edited.
 *
 * The aggregate knows the shape of the tree and its invariants. What each block type accepts
 * (children, properties, content rules) comes from a `BlockRules` port, implemented by the
 * block definitions outside `core`.
 */
export const BLOCK_NODE_TYPES = [
  'section',
  'column',
  'text',
  'heading',
  'image',
  'button',
  'divider',
  'spacer',
  'footer',
  'form',
  'html',
] as const;
export type BlockNodeType = (typeof BLOCK_NODE_TYPES)[number];

export type BlockPropValue = string | number | boolean;
export type BlockProps = Readonly<Record<string, BlockPropValue>>;
export type StyleValue = string | number;
export type GlobalStyles = Readonly<Record<string, Readonly<Record<string, StyleValue>>>>;

export interface Block {
  readonly id: string;
  readonly type: BlockNodeType;
  readonly props: BlockProps;
  /**
   * Values the block uses on small screens instead of its own (or inherited) ones. Only the
   * fields the rules call responsive may appear here; absent when the block has none.
   */
  readonly mobile?: BlockProps;
  readonly children?: readonly Block[];
}

/** The screen a value applies to: `desktop` writes `props`, `mobile` writes `mobile`. */
export type BlockDevice = 'desktop' | 'mobile';
export const BLOCK_DEVICES: readonly BlockDevice[] = Object.freeze(['desktop', 'mobile']);

export interface BlockDocumentMeta {
  readonly lang: string;
}

export interface BlockDocumentData {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly kind: DocumentKind;
  readonly revision: number;
  /** Internal label of the piece. The subject, preheader and SEO title belong to the host. */
  readonly title: string;
  readonly meta: BlockDocumentMeta;
  readonly styles: GlobalStyles;
  readonly blocks: readonly Block[];
}

/** Where an inserted or moved block goes. `inside` without a parent means the root. */
export type BlockTarget =
  | { readonly position: 'before' | 'after'; readonly id: string }
  | { readonly position: 'inside'; readonly parentId?: string; readonly index?: number };

export type StylePatch = Readonly<Record<string, Readonly<Record<string, StyleValue>>>>;

/** What a block type accepts. Implemented by the block definitions. */
export interface BlockRules {
  /** Types which may stand at the root of the piece. */
  isRoot(type: BlockNodeType): boolean;
  /** Types a block of this type may contain; empty for a leaf. */
  childTypes(type: BlockNodeType): readonly BlockNodeType[];
  childCount(type: BlockNodeType): { readonly min: number; readonly max: number };
  allows(type: BlockNodeType, kind: DocumentKind): boolean;
  /** Error code for the properties of one block, or undefined when they are valid. */
  validateProps(type: BlockNodeType, props: BlockProps, kind: DocumentKind): string | undefined;
  /** The value a command writes: normalized, or a thrown `BlockDocumentError`. */
  normalizeProp(
    type: BlockNodeType,
    key: string,
    value: BlockPropValue,
    kind: DocumentKind,
  ): BlockPropValue;
  /** Keys whose value is a text the author edits in place. */
  textKeys(type: BlockNodeType): readonly string[];
  /**
   * Whether a property may take a value of its own on small screens. Without this method no
   * block of the piece accepts mobile values.
   */
  responsive?(type: BlockNodeType, key: string, kind: DocumentKind): boolean;
  validateStyles(styles: GlobalStyles, kind: DocumentKind): string | undefined;
  /**
   * Error code for the piece as a whole, once its tree is valid: e.g. an output larger than
   * the compilation or the conversion accepts. Optional.
   */
  validateDocument?(data: BlockDocumentData): string | undefined;
  normalizeStyle(group: string, key: string, value: StyleValue, kind: DocumentKind): StyleValue;
}

export const BLOCK_DOCUMENT_LIMITS = Object.freeze({
  blocks: 5_000,
  depth: 8,
  childrenPerBlock: 500,
  propsPerBlock: 64,
  propValueLength: 500_000,
  styleGroups: 32,
  stylesPerGroup: 32,
  styleValueLength: 200,
  titleLength: 1_000,
});

/** Identifiers end up in class names, selectors and MJML attributes: nothing else is allowed. */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/;
/** A language tag as `<html lang>` takes it: `pt-BR`, `en`, `es-419`. */
export const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}$/;

const keySchema = v.pipe(v.string(), v.regex(KEY_PATTERN));
const propValueSchema = v.union([
  v.pipe(v.string(), v.maxLength(BLOCK_DOCUMENT_LIMITS.propValueLength)),
  v.pipe(v.number(), v.finite()),
  v.boolean(),
]);
const styleValueSchema = v.union([
  v.pipe(v.string(), v.maxLength(BLOCK_DOCUMENT_LIMITS.styleValueLength)),
  v.pipe(v.number(), v.finite()),
]);

export const BlockSchema: v.GenericSchema<Block> = v.lazy(() =>
  v.strictObject({
    id: v.pipe(v.string(), v.regex(BLOCK_ID_PATTERN)),
    type: v.picklist(BLOCK_NODE_TYPES),
    props: v.record(keySchema, propValueSchema),
    mobile: v.exactOptional(v.record(keySchema, propValueSchema)),
    children: v.exactOptional(v.array(BlockSchema)),
  }),
);

export const GlobalStylesSchema: v.GenericSchema<GlobalStyles> = v.record(
  keySchema,
  v.record(keySchema, styleValueSchema),
);

export const BlockDocumentSchema: v.GenericSchema<BlockDocumentData> = v.strictObject({
  schemaVersion: v.literal(2),
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  kind: v.picklist(['email', 'page']),
  revision: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER)),
  title: v.pipe(v.string(), v.maxLength(BLOCK_DOCUMENT_LIMITS.titleLength)),
  meta: v.strictObject({ lang: v.pipe(v.string(), v.regex(LANGUAGE_TAG_PATTERN)) }),
  styles: GlobalStylesSchema,
  blocks: v.array(BlockSchema),
});

export class BlockDocumentError extends DocumentValidationError {
  constructor(code: string) {
    super(code);
    this.name = 'BlockDocumentError';
  }
}

interface MutableBlock {
  id: string;
  type: BlockNodeType;
  props: Record<string, BlockPropValue>;
  mobile?: Record<string, BlockPropValue>;
  children?: MutableBlock[];
}

interface Location {
  readonly list: MutableBlock[];
  readonly index: number;
  readonly parent: MutableBlock | undefined;
}

/**
 * Immutable aggregate of a block piece. Every operation is pure: it returns a new document
 * with the next revision, validated as a whole, or throws `BlockDocumentError`.
 */
export class BlockDocument {
  readonly #data: BlockDocumentData;
  readonly #rules: BlockRules;
  #bytes: number | undefined;
  /** The copies the current command made, so a block on two paths is copied once. */
  #opened = new WeakSet<MutableBlock>();
  /** Each block by id with its parent, built once: the document never changes. */
  #index: Map<string, { readonly block: Block; readonly parent: Block | undefined }> | undefined;

  private constructor(data: BlockDocumentData, rules: BlockRules) {
    this.#data = BlockDocument.freeze(data);
    this.#rules = rules;
  }

  static from(input: unknown, rules: BlockRules): BlockDocument {
    try {
      new DocumentBudget().assertInput(input);
    } catch (error: unknown) {
      throw new BlockDocumentError(
        error instanceof DocumentBudgetError && error.code !== 'INVALID_DOCUMENT_SCHEMA'
          ? error.code
          : 'INVALID_BLOCK_DOCUMENT_SCHEMA',
      );
    }
    const parsed = v.safeParse(BlockDocumentSchema, input);
    if (!parsed.success) throw new BlockDocumentError('INVALID_BLOCK_DOCUMENT_SCHEMA');
    return BlockDocument.checked(structuredClone(parsed.output), rules);
  }

  /** The invariants of the tree and of the piece, over data of the schema's shape. */
  private static checked(data: BlockDocumentData, rules: BlockRules): BlockDocument {
    BlockDocument.assertStyles(data, rules);
    BlockDocument.assertTree(data, rules);
    const error = rules.validateDocument?.(data);
    if (error) throw new BlockDocumentError(error);
    return new BlockDocument(data, rules);
  }

  get id(): string {
    return this.#data.id;
  }
  get kind(): DocumentKind {
    return this.#data.kind;
  }
  get revision(): number {
    return this.#data.revision;
  }
  get title(): string {
    return this.#data.title;
  }
  get meta(): BlockDocumentMeta {
    return this.#data.meta;
  }
  /** Frozen view of the overridden global styles. */
  get styles(): GlobalStyles {
    return this.#data.styles;
  }
  /** Frozen view of the tree; `snapshot()` gives an independent copy. */
  get blocks(): readonly Block[] {
    return this.#data.blocks;
  }

  snapshot(): BlockDocumentData {
    return structuredClone(this.#data);
  }

  /** The data itself, deeply frozen: what reads it never pays for a copy. */
  get data(): BlockDocumentData {
    return this.#data;
  }

  /** Size of the JSON of the piece, for the byte budget of the history. */
  serializedBytes(): number {
    this.#bytes ??= new DocumentBudget().byteLength(JSON.stringify(this.#data));
    return this.#bytes;
  }

  /**
   * Only the revision changes: the validated tree is not checked a second time. A session uses
   * it to move forward when it restores an earlier step of its history.
   */
  withRevision(revision: number): BlockDocument {
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new BlockDocumentError('INVALID_BLOCK_DOCUMENT_SCHEMA');
    return revision === this.#data.revision
      ? this
      : new BlockDocument({ ...this.snapshot(), revision }, this.#rules);
  }

  find(id: string): Block | undefined {
    return this.index().get(id)?.block;
  }

  /** Id of the block which contains this one; undefined at the root or when absent. */
  parentOf(id: string): string | undefined {
    return this.index().get(id)?.parent?.id;
  }

  private index(): Map<string, { readonly block: Block; readonly parent: Block | undefined }> {
    if (this.#index) return this.#index;
    const index = new Map<string, { block: Block; parent: Block | undefined }>();
    const stack: { block: Block; parent: Block | undefined }[] = this.#data.blocks.map((block) => ({
      block,
      parent: undefined,
    }));
    while (stack.length) {
      const entry = stack.pop();
      if (!entry) break;
      index.set(entry.block.id, entry);
      for (const child of entry.block.children ?? [])
        stack.push({ block: child, parent: entry.block });
    }
    this.#index = index;
    return index;
  }

  insert(block: Block, target: BlockTarget): BlockDocument {
    // The block comes from outside the document: its shape is parsed like any input.
    if (!v.safeParse(BlockSchema, block).success)
      throw new BlockDocumentError('INVALID_BLOCK_DOCUMENT_SCHEMA');
    const blocks = this.mutableBlocks();
    this.place(blocks, structuredClone(block) as MutableBlock, target);
    return this.next({ blocks });
  }

  /**
   * `inside` with an index counts the slots of the parent as it is before the move, like a
   * drop indicator between two blocks: moving the first of `[a, b]` to index 2 gives `[b, a]`.
   */
  move(id: string, target: BlockTarget): BlockDocument {
    const blocks = this.mutableBlocks();
    const location = this.require(blocks, id);
    const moving = location.list[location.index];
    if (!moving) throw new BlockDocumentError('BLOCK_NOT_FOUND');
    const anchor = target.position === 'inside' ? target.parentId : target.id;
    if (anchor !== undefined && this.contains(moving, anchor))
      throw new BlockDocumentError('INVALID_BLOCK_TARGET');
    let destination = target;
    if (
      target.position === 'inside' &&
      target.index !== undefined &&
      target.parentId === location.parent?.id
    ) {
      if (
        !Number.isInteger(target.index) ||
        target.index < 0 ||
        target.index > location.list.length
      )
        throw new BlockDocumentError('INVALID_BLOCK_TARGET');
      if (target.index > location.index) destination = { ...target, index: target.index - 1 };
    }
    location.list.splice(location.index, 1);
    this.place(blocks, moving, destination);
    return this.next({ blocks });
  }

  /** Copies a block and its children with new ids, right after the original. */
  duplicate(id: string, nextId: () => string): BlockDocument {
    const blocks = this.mutableBlocks();
    const location = this.require(blocks, id);
    const original = location.list[location.index];
    if (!original) throw new BlockDocumentError('BLOCK_NOT_FOUND');
    const copy = this.reidentify(original, nextId);
    location.list.splice(location.index + 1, 0, copy);
    return this.next({ blocks });
  }

  remove(id: string): BlockDocument {
    const blocks = this.mutableBlocks();
    const location = this.require(blocks, id);
    location.list.splice(location.index, 1);
    return this.next({ blocks });
  }

  /**
   * Sets values the author chose, for every screen or only for small ones; a patch which
   * changes nothing returns this document. A mobile value equal to the one the block already
   * uses on every screen is still kept: the author chose it for the small screen.
   */
  updateProps(id: string, patch: BlockProps, device: BlockDevice = 'desktop'): BlockDocument {
    const blocks = this.mutableBlocks();
    const block = this.blockAt(blocks, id);
    if (device === 'mobile' && Object.keys(patch).some((key) => !this.responsive(block.type, key)))
      throw new BlockDocumentError('BLOCK_PROP_NOT_RESPONSIVE');
    const target = device === 'mobile' ? (block.mobile ??= {}) : block.props;
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      const normalized = this.#rules.normalizeProp(block.type, key, value, this.kind);
      if (target[key] === normalized) continue;
      target[key] = normalized;
      changed = true;
    }
    if (block.mobile && !Object.keys(block.mobile).length) delete block.mobile;
    return changed ? this.next({ blocks }) : this;
  }

  /**
   * "Restore default": the keys disappear and the block inherits again. On mobile only the
   * mobile values go, and the block uses its value of every screen again.
   */
  restoreDefault(
    id: string,
    keys: readonly string[],
    device: BlockDevice = 'desktop',
  ): BlockDocument {
    const blocks = this.mutableBlocks();
    const block = this.blockAt(blocks, id);
    const target = device === 'mobile' ? block.mobile : block.props;
    if (!target) return this;
    const present = keys.filter((key) => Object.hasOwn(target, key));
    if (!present.length) return this;
    for (const key of present) delete target[key];
    if (block.mobile && !Object.keys(block.mobile).length) delete block.mobile;
    return this.next({ blocks });
  }

  /** Whether this property of the block may take a value of its own on small screens. */
  responsive(type: BlockNodeType, key: string): boolean {
    return this.#rules.responsive?.(type, key, this.kind) === true;
  }

  /** The text of a block, in the rich-text projection its type accepts. */
  updateText(id: string, key: string, value: string): BlockDocument {
    const block = this.find(id);
    if (!block) throw new BlockDocumentError('BLOCK_NOT_FOUND');
    if (!this.#rules.textKeys(block.type).includes(key))
      throw new BlockDocumentError('BLOCK_TEXT_NOT_EDITABLE');
    return this.updateProps(id, { [key]: value });
  }

  updateStyles(patch: StylePatch): BlockDocument {
    const styles: Record<string, Record<string, StyleValue>> = structuredClone(
      this.#data.styles,
    ) as Record<string, Record<string, StyleValue>>;
    let changed = false;
    for (const [group, values] of Object.entries(patch)) {
      for (const [key, value] of Object.entries(values)) {
        const normalized = this.#rules.normalizeStyle(group, key, value, this.kind);
        if (styles[group]?.[key] === normalized) continue;
        (styles[group] ??= {})[key] = normalized;
        changed = true;
      }
    }
    return changed ? this.next({ styles }) : this;
  }

  /**
   * Back to the catalog defaults: every style without a group, a whole group without keys,
   * or only the given keys of a group.
   */
  restoreStyleDefault(group?: string, keys?: readonly string[]): BlockDocument {
    if (group === undefined)
      return Object.keys(this.#data.styles).length ? this.next({ styles: {} }) : this;
    if (!this.#data.styles[group]) return this;
    const styles = structuredClone(this.#data.styles) as Record<string, Record<string, StyleValue>>;
    if (keys === undefined) delete styles[group];
    else {
      const values = styles[group];
      if (values) {
        if (!keys.some((key) => Object.hasOwn(values, key))) return this;
        for (const key of keys) delete values[key];
        if (!Object.keys(values).length) delete styles[group];
      }
    }
    return this.next({ styles });
  }

  withMeta(meta: BlockDocumentMeta): BlockDocument {
    return meta.lang === this.#data.meta.lang ? this : this.next({ meta });
  }

  withTitle(title: string): BlockDocument {
    return title === this.#data.title ? this : this.next({ title });
  }

  /**
   * The next revision. The data was built here from a validated document and from values the
   * rules normalized, so it keeps the shape of the schema; the parsing of the schema is not
   * paid again, but every invariant of the tree and of the piece is checked as for any input.
   */
  private next(change: {
    blocks?: readonly MutableBlock[];
    styles?: GlobalStyles;
    meta?: BlockDocumentMeta;
    title?: string;
  }): BlockDocument {
    if (change.title !== undefined && change.title.length > BLOCK_DOCUMENT_LIMITS.titleLength)
      throw new BlockDocumentError('INVALID_BLOCK_DOCUMENT_SCHEMA');
    if (change.meta !== undefined && !LANGUAGE_TAG_PATTERN.test(change.meta.lang))
      throw new BlockDocumentError('INVALID_BLOCK_DOCUMENT_SCHEMA');
    if (this.#data.revision + 1 > Number.MAX_SAFE_INTEGER)
      throw new BlockDocumentError('INVALID_BLOCK_DOCUMENT_SCHEMA');
    const data: BlockDocumentData = {
      schemaVersion: 2,
      id: this.#data.id,
      kind: this.#data.kind,
      revision: this.#data.revision + 1,
      title: change.title ?? this.#data.title,
      meta: change.meta ? { lang: change.meta.lang } : this.#data.meta,
      styles: change.styles ? structuredClone(change.styles) : this.#data.styles,
      blocks: change.blocks ? (change.blocks as readonly Block[]) : this.#data.blocks,
    };
    return BlockDocument.checked(data, this.#rules);
  }

  /**
   * The tree a command changes, copied on write: the root list is new, and `locate` copies
   * only the blocks on the path to what it finds. Every other block stays the frozen object of
   * this document, shared by the next one (and never validated again: see `assertTree`).
   */
  private mutableBlocks(): MutableBlock[] {
    this.#opened = new WeakSet();
    return [...this.#data.blocks] as MutableBlock[];
  }

  /** A block of the tree being changed, as a copy the command may write. */
  private open(block: MutableBlock): MutableBlock {
    if (this.#opened.has(block)) return block;
    const copy: MutableBlock = {
      ...block,
      props: { ...block.props },
      ...(block.mobile ? { mobile: { ...block.mobile } } : {}),
      ...(block.children ? { children: [...block.children] } : {}),
    };
    this.#opened.add(copy);
    return copy;
  }

  private place(blocks: MutableBlock[], block: MutableBlock, target: BlockTarget): void {
    if (target.position === 'inside') {
      let list = blocks;
      if (target.parentId !== undefined) {
        const parent = this.blockAt(blocks, target.parentId);
        list = parent.children ??= [];
      }
      const index = target.index ?? list.length;
      if (!Number.isInteger(index) || index < 0 || index > list.length)
        throw new BlockDocumentError('INVALID_BLOCK_TARGET');
      list.splice(index, 0, block);
      return;
    }
    const location = this.require(blocks, target.id);
    location.list.splice(location.index + (target.position === 'after' ? 1 : 0), 0, block);
  }

  private contains(block: MutableBlock, id: string): boolean {
    const stack = [block];
    while (stack.length) {
      const current = stack.pop();
      if (!current) break;
      if (current.id === id) return true;
      stack.push(...(current.children ?? []));
    }
    return false;
  }

  private reidentify(block: MutableBlock, nextId: () => string): MutableBlock {
    return {
      ...structuredClone(block),
      id: nextId(),
      ...(block.children
        ? { children: block.children.map((child) => this.reidentify(child, nextId)) }
        : {}),
    };
  }

  private blockAt(blocks: MutableBlock[], id: string): MutableBlock {
    const location = this.require(blocks, id);
    const block = location.list[location.index];
    if (!block) throw new BlockDocumentError('BLOCK_NOT_FOUND');
    return block;
  }

  private require(blocks: MutableBlock[], id: string): Location {
    const location = this.locate(blocks, id);
    if (!location) throw new BlockDocumentError('BLOCK_NOT_FOUND');
    return location;
  }

  /**
   * Where a block of this document stands in the tree being changed. The path comes from the
   * index of this document (a command never moves a block inside itself), and each block on it
   * is opened for writing, the found one included.
   */
  private locate(blocks: MutableBlock[], id: string): Location | undefined {
    const chain: string[] = [];
    const index = this.index();
    for (let entry = index.get(id); entry; entry = entry.parent && index.get(entry.parent.id))
      chain.unshift(entry.block.id);
    if (!chain.length) return undefined;
    let list = blocks;
    let parent: MutableBlock | undefined;
    for (let depth = 0; depth < chain.length; depth++) {
      const position = list.findIndex((block) => block.id === chain[depth]);
      const found = list[position];
      if (!found) return undefined;
      const opened = this.open(found);
      list[position] = opened;
      if (depth === chain.length - 1) return { list, index: position, parent };
      parent = opened;
      list = opened.children ??= [];
    }
    return undefined;
  }

  private static assertStyles(data: BlockDocumentData, rules: BlockRules): void {
    const groups = Object.values(data.styles);
    if (
      groups.length > BLOCK_DOCUMENT_LIMITS.styleGroups ||
      groups.some((group) => Object.keys(group).length > BLOCK_DOCUMENT_LIMITS.stylesPerGroup)
    )
      throw new BlockDocumentError('INVALID_GLOBAL_STYLES');
    const error = rules.validateStyles(data.styles, data.kind);
    if (error) throw new BlockDocumentError(error);
  }

  /**
   * Frozen blocks whose own values were already accepted by these rules for a kind. The values
   * of a block depend only on its type and the kind, and a frozen block never changes: a block
   * shared by the next revision is not checked again. Its place in the tree always is.
   */
  private static readonly accepted = new WeakMap<
    BlockRules,
    Record<DocumentKind, WeakSet<Block>>
  >();

  private static acceptedFor(rules: BlockRules, kind: DocumentKind): WeakSet<Block> {
    let sets = BlockDocument.accepted.get(rules);
    if (!sets) {
      sets = { email: new WeakSet(), page: new WeakSet() };
      BlockDocument.accepted.set(rules, sets);
    }
    return sets[kind];
  }

  private static assertTree(data: BlockDocumentData, rules: BlockRules): void {
    const accepted = BlockDocument.acceptedFor(rules, data.kind);
    const seen = new Set<string>();
    const stack: { block: Block; depth: number; parent: Block | undefined }[] = data.blocks.map(
      (block) => ({ block, depth: 0, parent: undefined }),
    );
    while (stack.length) {
      const frame = stack.pop();
      if (!frame) break;
      const { block, depth, parent } = frame;
      if (depth > BLOCK_DOCUMENT_LIMITS.depth)
        throw new BlockDocumentError('BLOCK_DOCUMENT_TOO_DEEP');
      if (seen.has(block.id)) throw new BlockDocumentError('DUPLICATE_BLOCK_ID');
      seen.add(block.id);
      if (seen.size > BLOCK_DOCUMENT_LIMITS.blocks)
        throw new BlockDocumentError('BLOCK_DOCUMENT_TOO_MANY_BLOCKS');
      if (!rules.allows(block.type, data.kind))
        throw new BlockDocumentError('BLOCK_KIND_NOT_ALLOWED');
      if (parent === undefined && !rules.isRoot(block.type))
        throw new BlockDocumentError('BLOCK_NOT_ALLOWED_AT_ROOT');
      if (parent !== undefined && !rules.childTypes(parent.type).includes(block.type))
        throw new BlockDocumentError('BLOCK_CHILD_NOT_ALLOWED');
      const allowed = rules.childTypes(block.type);
      if (!allowed.length && block.children !== undefined)
        throw new BlockDocumentError('BLOCK_CHILD_NOT_ALLOWED');
      if (allowed.length) {
        const count = block.children?.length ?? 0;
        const limits = rules.childCount(block.type);
        if (count < limits.min) throw new BlockDocumentError('TOO_FEW_CHILDREN');
        if (count > Math.min(limits.max, BLOCK_DOCUMENT_LIMITS.childrenPerBlock))
          throw new BlockDocumentError('TOO_MANY_CHILDREN');
      }
      if (!accepted.has(block)) {
        if (Object.keys(block.props).length > BLOCK_DOCUMENT_LIMITS.propsPerBlock)
          throw new BlockDocumentError('INVALID_BLOCK_PROPS');
        if (
          !BlockDocument.values(block.props) ||
          (block.mobile && !BlockDocument.values(block.mobile))
        )
          throw new BlockDocumentError('INVALID_BLOCK_PROPS');
        const error = rules.validateProps(block.type, block.props, data.kind);
        if (error) throw new BlockDocumentError(error);
        if (block.mobile !== undefined) BlockDocument.assertMobile(block, data.kind, rules);
        if (
          Object.isFrozen(block) &&
          Object.isFrozen(block.props) &&
          (!block.mobile || Object.isFrozen(block.mobile))
        )
          accepted.add(block);
      }
      for (const child of block.children ?? [])
        stack.push({ block: child, depth: depth + 1, parent: block });
    }
  }

  /**
   * Mobile values: at least one, each of a responsive property, each one a value the property
   * accepts. They are checked over the values of every screen, so the rules see a whole block.
   */
  private static assertMobile(block: Block, kind: DocumentKind, rules: BlockRules): void {
    const mobile = block.mobile ?? {};
    const keys = Object.keys(mobile);
    if (!keys.length || keys.length > BLOCK_DOCUMENT_LIMITS.propsPerBlock)
      throw new BlockDocumentError('INVALID_BLOCK_PROPS');
    if (keys.some((key) => rules.responsive?.(block.type, key, kind) !== true))
      throw new BlockDocumentError('BLOCK_PROP_NOT_RESPONSIVE');
    const error = rules.validateProps(block.type, { ...block.props, ...mobile }, kind);
    if (error) throw new BlockDocumentError(error);
  }

  /** Keys and values of the schema's shape, checked again for data built by a command. */
  private static values(props: BlockProps): boolean {
    for (const [key, value] of Object.entries(props)) {
      if (!KEY_PATTERN.test(key)) return false;
      if (typeof value === 'string') {
        if (value.length > BLOCK_DOCUMENT_LIMITS.propValueLength) return false;
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) return false;
      } else if (typeof value !== 'boolean') return false;
    }
    return true;
  }

  private static freeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const entry of Object.values(value)) BlockDocument.freeze(entry);
    }
    return value;
  }
}
