import type { BlockDevice, BlockDocumentData, BlockPropValue } from '../core/block-document';
import type { BlockField, FieldControl, FieldOption, FieldTab } from './block-type';
import type { BlockDefinitionRegistry } from './definitions';
import { StyleResolver } from './styles';
import type { StyleKeySpec, StylePath } from './styles';

/** One property of the selected block, as the properties panel shows it. */
export interface BlockFieldModel {
  readonly key: string;
  readonly tab: FieldTab;
  readonly control: FieldControl;
  readonly labelKey: string;
  readonly options: readonly FieldOption[];
  /** The value the block sets; undefined while it inherits. */
  readonly own: BlockPropValue | undefined;
  /** What the output uses: the block's value, else the global style, else the default. */
  readonly effective: BlockPropValue | undefined;
  /** The global style the value comes from while the block does not set it. */
  readonly inherits: StylePath | undefined;
  /** The field may take a value of its own on small screens. */
  readonly responsive: boolean;
  /** The screen this model shows. On mobile, `own` is the mobile value of a responsive field. */
  readonly device: BlockDevice;
  /** The block sets a mobile value for this field (shown on both screens). */
  readonly mobileOverride: boolean;
}

export interface GlobalStyleKeyModel {
  readonly group: string;
  readonly key: string;
  readonly labelKey: string;
  readonly control: StyleKeySpec['control'];
  readonly options: readonly FieldOption[];
  readonly value: string;
  readonly overridden: boolean;
}

export interface GlobalStyleGroupModel {
  readonly group: string;
  readonly labelKey: string;
  readonly keys: readonly GlobalStyleKeyModel[];
}

/**
 * Reads a block piece the way the panels show it: the fields of a block by its definition,
 * with the inherited and default values resolved, and the global styles of its kind. The
 * panels are generated from this, never written per block type.
 */
export class BlockInspector {
  constructor(private readonly registry: BlockDefinitionRegistry) {}

  /**
   * The fields of a block. On mobile a responsive field shows its mobile value, and while it
   * has none the value every screen uses, as what it inherits.
   */
  fields(
    document: BlockDocumentData,
    id: string,
    device: BlockDevice = 'desktop',
  ): readonly BlockFieldModel[] {
    const block = this.find(document.blocks, id);
    if (!block) return [];
    const styles = new StyleResolver(this.registry.styles, document.styles, document.kind);
    return this.registry
      .definition(block.type)
      .fields.filter((field) => !field.internal)
      .map((field) => {
        const responsive = this.registry.responsive(block.type, field.key, document.kind);
        const mobile = responsive ? block.mobile?.[field.key] : undefined;
        const base = this.field(field, block.props[field.key], styles);
        const model = { ...base, responsive, device, mobileOverride: mobile !== undefined };
        if (device !== 'mobile' || !responsive) return { ...model, device: 'desktop' as const };
        return { ...model, own: mobile, effective: mobile ?? base.effective };
      });
  }

  styles(document: Pick<BlockDocumentData, 'kind' | 'styles'>): readonly GlobalStyleGroupModel[] {
    const resolver = new StyleResolver(this.registry.styles, document.styles, document.kind);
    return this.registry.styles.groups
      .map((group) => ({
        group: group.group,
        labelKey: group.labelKey,
        keys: group.keys
          .filter((key) => !key.kinds || key.kinds.includes(document.kind))
          .map((key) => {
            const path: StylePath = `${group.group}.${key.key}`;
            return {
              group: group.group,
              key: key.key,
              labelKey: key.labelKey,
              control: key.control,
              options: key.options ?? [],
              value: resolver.value(path),
              overridden: resolver.overridden(path),
            };
          }),
      }))
      .filter((group) => group.keys.length > 0);
  }

  private field(
    field: BlockField,
    own: BlockPropValue | undefined,
    styles: StyleResolver,
  ): Omit<BlockFieldModel, 'responsive' | 'device' | 'mobileOverride'> {
    const effective =
      own ?? (field.inherits ? styles.value(field.inherits) : undefined) ?? field.defaultValue;
    return {
      key: field.key,
      tab: field.tab,
      control: field.control,
      labelKey: field.labelKey,
      options: field.options ?? [],
      own,
      effective,
      inherits: field.inherits,
    };
  }

  private find(
    blocks: BlockDocumentData['blocks'],
    id: string,
  ): BlockDocumentData['blocks'][number] | undefined {
    const stack = [...blocks];
    while (stack.length) {
      const block = stack.pop();
      if (!block) break;
      if (block.id === id) return block;
      stack.push(...(block.children ?? []));
    }
    return undefined;
  }
}
