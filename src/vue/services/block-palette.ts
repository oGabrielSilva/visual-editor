import { BLOCK_CATEGORIES, BlockPresentation } from './block-presentation';
import type { BlockCategory } from './block-presentation';

export interface PaletteBlock {
  readonly type: string;
  readonly label: string;
  readonly icon: string;
}

export interface PaletteGroup {
  readonly category: BlockCategory;
  readonly label: string;
  readonly blocks: readonly PaletteBlock[];
}

/** Folds accents and case, so "titulo" finds "Título". */
export function searchKey(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** The blocks a person can add, grouped by purpose and filtered by what they typed. */
export class BlockPalette {
  private readonly presentation = new BlockPresentation();

  constructor(private readonly text: (key: string) => string) {}

  blocks(types: readonly string[]): readonly PaletteBlock[] {
    return types.map((type) => ({
      type,
      label: this.text(`blocks.${type}`),
      icon: this.presentation.icon(type),
    }));
  }

  groups(types: readonly string[], query = ''): readonly PaletteGroup[] {
    const term = searchKey(query);
    const blocks = this.blocks(types).filter(
      (block) => !term || searchKey(block.label).includes(term),
    );
    return BLOCK_CATEGORIES.map((category) => ({
      category,
      label: this.text(`palette.${category}`),
      blocks: blocks.filter((block) => this.presentation.category(block.type) === category),
    })).filter((group) => group.blocks.length);
  }
}
