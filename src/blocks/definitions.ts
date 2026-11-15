import { BlockDocumentError } from '../core/block-document';
import type {
  Block,
  BlockDocumentData,
  BlockNodeType,
  BlockPropValue,
  BlockProps,
  BlockRules,
  GlobalStyles,
  StyleValue,
} from '../core/block-document';
import type { DocumentKind } from '../core/document';
import { DocumentBudget } from '../core/budget';
import { COMPILE_LIMITS } from '../compilation/guard';
import type { BlockField, BlockTypeCatalog, BlockTypeDefinition } from './block-type';
import { BlockMjmlGenerator } from './email-generator';
import { BlockPageGenerator } from './page-generator';
import { BlockContentGuard } from './content-guard';
import { GlobalStyleSpec } from './styles';
import { ValueRules } from './values';
import type { ValueSpec } from './values';
import { ColumnBlock, SectionBlock } from './types/layout';
import { FooterBlock, HeadingBlock, TextBlock } from './types/text';
import { ButtonBlock, ImageBlock } from './types/media';
import { DividerBlock, SpacerBlock } from './types/structure';
import { FormBlock, HtmlBlock } from './types/embed';

export function defaultBlockTypes(): readonly BlockTypeDefinition[] {
  return [
    new SectionBlock(),
    new ColumnBlock(),
    new TextBlock(),
    new HeadingBlock(),
    new ImageBlock(),
    new ButtonBlock(),
    new DividerBlock(),
    new SpacerBlock(),
    new FooterBlock(),
    new FormBlock(),
    new HtmlBlock(),
  ];
}

/**
 * The catalog of block types and the rules the block document applies through its port:
 * where each type may stand, which properties it accepts and how each value is checked.
 */
/** Token of the size check: as long as a real one, so the measured preview is not shorter. */
const MEASURE_TOKEN = '0'.repeat(32);

export class BlockDefinitionRegistry implements BlockRules, BlockTypeCatalog {
  readonly #types = new Map<BlockNodeType, BlockTypeDefinition>();
  readonly #fields = new Map<string, BlockField>();
  readonly #values: ValueRules;
  readonly styles: GlobalStyleSpec;

  constructor(
    content = new BlockContentGuard(),
    styles = new GlobalStyleSpec(),
    types: readonly BlockTypeDefinition[] = defaultBlockTypes(),
  ) {
    this.#values = new ValueRules(content);
    this.styles = styles;
    for (const definition of types) {
      if (this.#types.has(definition.type)) throw new Error('DUPLICATE_BLOCK_TYPE');
      this.#types.set(definition.type, definition);
      for (const field of definition.fields) {
        if (field.inherits && !styles.has(field.inherits)) throw new Error('UNKNOWN_STYLE');
        this.#fields.set(`${definition.type}.${field.key}`, field);
      }
    }
  }

  definition(type: BlockNodeType): BlockTypeDefinition {
    const definition = this.#types.get(type);
    if (!definition) throw new BlockDocumentError('UNKNOWN_BLOCK_TYPE');
    return definition;
  }

  /** The types an author may insert in a piece of this kind. */
  list(kind: DocumentKind): readonly BlockTypeDefinition[] {
    return [...this.#types.values()].filter((definition) => definition.kinds.includes(kind));
  }

  field(type: BlockNodeType, key: string): BlockField | undefined {
    return this.#fields.get(`${type}.${key}`);
  }

  /** A new block; the document validates it when it is inserted. */
  create(type: BlockNodeType, nextId: () => string, props: BlockProps = {}): Block {
    return this.definition(type).create(nextId, props);
  }

  isRoot(type: BlockNodeType): boolean {
    return this.definition(type).root === true;
  }

  childTypes(type: BlockNodeType): readonly BlockNodeType[] {
    return this.definition(type).childTypes;
  }

  childCount(type: BlockNodeType): { readonly min: number; readonly max: number } {
    return this.definition(type).childCount;
  }

  allows(type: BlockNodeType, kind: DocumentKind): boolean {
    return this.definition(type).kinds.includes(kind);
  }

  validateProps(type: BlockNodeType, props: BlockProps, kind: DocumentKind): string | undefined {
    const definition = this.definition(type);
    for (const [key, value] of Object.entries(props)) {
      const field = this.field(type, key);
      if (!field) return 'UNKNOWN_BLOCK_PROP';
      if (!this.#values.accepts(field.value, value, kind)) return this.refusal(field.value, kind);
    }
    if (definition.fields.some((field) => field.required && props[field.key] === undefined))
      return 'MISSING_BLOCK_PROP';
    return undefined;
  }

  normalizeProp(
    type: BlockNodeType,
    key: string,
    value: BlockPropValue,
    kind: DocumentKind,
  ): BlockPropValue {
    const field = this.field(type, key);
    if (!field) throw new BlockDocumentError('UNKNOWN_BLOCK_PROP');
    let normalized: BlockPropValue | undefined;
    try {
      normalized = this.#values.normalize(field.value, value, kind);
    } catch {
      normalized = undefined;
    }
    if (normalized === undefined) throw new BlockDocumentError(this.refusal(field.value, kind));
    return normalized;
  }

  textKeys(type: BlockNodeType): readonly string[] {
    return this.definition(type)
      .fields.filter((field) => field.control === 'richtext')
      .map((field) => field.key);
  }

  /**
   * A field with a mobile value: marked responsive and written by the output of the kind (CSS
   * in a page, a mobile rule of the definition in an e-mail).
   */
  responsive(type: BlockNodeType, key: string, kind: DocumentKind): boolean {
    const definition = this.#types.get(type);
    const field = this.field(type, key);
    if (!definition || !field?.responsive || !definition.kinds.includes(kind)) return false;
    return kind === 'page' ? field.css !== undefined : definition.mobileEmail?.[key] !== undefined;
  }

  validateStyles(styles: GlobalStyles, kind: DocumentKind): string | undefined {
    for (const [group, values] of Object.entries(styles))
      for (const [key, value] of Object.entries(values)) {
        const spec = this.styles.key(group, key);
        if (!spec || (spec.kinds && !spec.kinds.includes(kind))) return 'UNKNOWN_GLOBAL_STYLE';
        if (!this.#values.accepts(spec.value, value, kind)) return 'INVALID_GLOBAL_STYLES';
      }
    return undefined;
  }

  normalizeStyle(group: string, key: string, value: StyleValue, kind: DocumentKind): StyleValue {
    const spec = this.styles.key(group, key);
    if (!spec || (spec.kinds && !spec.kinds.includes(kind)))
      throw new BlockDocumentError('UNKNOWN_GLOBAL_STYLE');
    const normalized = this.#values.normalize(spec.value, value, kind);
    if (normalized === undefined || typeof normalized === 'boolean')
      throw new BlockDocumentError('INVALID_GLOBAL_STYLES');
    return normalized;
  }

  /**
   * The output of the piece must fit what consumes it: the MJML of an e-mail (preview, the
   * larger of the two) within the compilation limit, and the HTML and CSS of a page within
   * the source limits of the HTML document a conversion would create.
   */
  validateDocument(data: BlockDocumentData): string | undefined {
    const budget = new DocumentBudget();
    if (data.kind === 'email') {
      const mjml = new BlockMjmlGenerator(this).toMjml(data, 'preview', MEASURE_TOKEN);
      return budget.byteLength(mjml.source) > COMPILE_LIMITS.sourceBytes
        ? 'BLOCK_EMAIL_TOO_LARGE'
        : undefined;
    }
    const page = new BlockPageGenerator(this).toHtml(data, 'preview');
    return budget.byteLength(page.html) > DocumentBudget.limits.sourceBytes ||
      budget.byteLength(page.css) > DocumentBudget.limits.cssBytes
      ? 'BLOCK_PAGE_TOO_LARGE'
      : undefined;
  }

  /** Every label key the definitions and the global styles refer to. */
  labelKeys(): readonly string[] {
    const keys = new Set<string>();
    for (const definition of this.#types.values()) {
      keys.add(definition.labelKey);
      for (const field of definition.fields) {
        keys.add(field.labelKey);
        for (const option of field.options ?? []) keys.add(option.labelKey);
      }
    }
    for (const group of this.styles.groups) {
      keys.add(group.labelKey);
      for (const key of group.keys) {
        keys.add(key.labelKey);
        for (const option of key.options ?? []) keys.add(option.labelKey);
      }
    }
    return [...keys];
  }

  private refusal(spec: ValueSpec, kind: DocumentKind): string {
    switch (spec.type) {
      case 'richtext':
        return 'INVALID_BLOCK_TEXT';
      case 'url':
        return 'UNSAFE_BLOCK_URL';
      case 'html':
        return kind === 'email' ? 'UNSAFE_BLOCK_HTML' : 'INVALID_BLOCK_HTML';
      default:
        return 'INVALID_BLOCK_PROPS';
    }
  }
}
