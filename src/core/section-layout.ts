import * as v from 'valibot';
import type { DocumentKind, DocumentNode, EditorDocumentData } from './document';

export const SECTION_LAYOUT_LIMITS = Object.freeze({ columns: 4, weight: 12 });
export const SECTION_STACKING = ['normal', 'reverse', 'none'] as const;
export const SECTION_BREAKPOINTS = [480, 640, 768] as const;
export const SECTION_LAYOUT_PRESETS = [
  { id: 'single', ratios: [1], titleKey: 'properties.oneColumn' },
  { id: 'equal2', ratios: [1, 1], titleKey: 'properties.twoColumns' },
  { id: 'wideLeft', ratios: [2, 1], titleKey: 'properties.widerLeft' },
  { id: 'wideRight', ratios: [1, 2], titleKey: 'properties.widerRight' },
  { id: 'equal3', ratios: [1, 1, 1], titleKey: 'properties.threeColumns' },
  { id: 'equal4', ratios: [1, 1, 1, 1], titleKey: 'properties.fourColumns' },
] as const;
export type SectionStacking = (typeof SECTION_STACKING)[number];
export type SectionBreakpoint = (typeof SECTION_BREAKPOINTS)[number];
export type SectionLayoutReason =
  | 'unsupported-structure'
  | 'invalid-settings'
  | 'column-not-empty'
  | 'identity-bearing-column'
  | 'readonly'
  | 'unavailable';
export interface SectionLayoutSettings {
  readonly ratios: readonly number[];
  readonly stacking: SectionStacking;
  readonly breakpoint: SectionBreakpoint;
}
export interface SectionLayoutPatch {
  readonly ratios?: readonly number[];
  readonly stacking?: SectionStacking;
  readonly breakpoint?: SectionBreakpoint;
}
export interface SectionLayoutContext extends SectionLayoutSettings {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly columnIds: readonly string[];
  readonly removableColumnIds: readonly string[];
  readonly editable: boolean;
  readonly reason?: SectionLayoutReason;
}
export interface SectionLayoutProjection {
  readonly section: DocumentNode;
  readonly columns: readonly DocumentNode[];
  readonly contentParent?: DocumentNode;
  readonly shell?: readonly DocumentNode[];
}
export const SectionLayoutSettingsSchema = v.strictObject({
  ratios: v.pipe(
    v.array(
      v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(SECTION_LAYOUT_LIMITS.weight)),
    ),
    v.minLength(1),
    v.maxLength(SECTION_LAYOUT_LIMITS.columns),
  ),
  stacking: v.picklist(SECTION_STACKING),
  breakpoint: v.picklist(SECTION_BREAKPOINTS),
});
export const SectionLayoutPatchSchema = v.strictObject({
  ratios: v.exactOptional(SectionLayoutSettingsSchema.entries.ratios),
  stacking: v.exactOptional(SectionLayoutSettingsSchema.entries.stacking),
  breakpoint: v.exactOptional(SectionLayoutSettingsSchema.entries.breakpoint),
});

/** Structural projection only: an imported marker never grants a mutation by itself. */
export class SectionLayoutPolicy {
  hasClass(node: DocumentNode, name: string): boolean {
    return (node.attrs?.class ?? '').split(/\s+/).includes(name);
  }
  projection(document: EditorDocumentData, id: string): SectionLayoutProjection | undefined {
    const path = this.path(document.nodes, id);
    if (!path) return undefined;
    for (const section of [...path].reverse()) {
      if (document.kind === 'page') {
        if (
          section.type !== 'element' ||
          !['section', 'div'].includes(section.tag ?? '') ||
          !(
            this.hasClass(section, 'columns') ||
            ['columns', 'section'].includes(section.attrs?.['data-editor-block'] ?? '') ||
            section.attrs?.['data-editor-layout']
          )
        )
          continue;
        const columns = this.elements(section);
        if (
          columns.length < 1 ||
          columns.length > SECTION_LAYOUT_LIMITS.columns ||
          !columns.every((column) =>
            ['div', 'article', 'section', 'aside'].includes(column.tag ?? ''),
          ) ||
          (section.children ?? []).some((child) => child.type === 'text' && !!child.value?.trim())
        )
          continue;
        return { section, columns, contentParent: section };
      }
      if (
        section.type !== 'element' ||
        section.tag !== 'div' ||
        !this.hasClass(section, 'editor-layout-section')
      )
        continue;
      const table = this.onlyElement(section, 'table');
      const tbody = table && this.onlyElement(table, 'tbody');
      const tr = tbody && this.onlyElement(tbody, 'tr');
      const td = tr && this.onlyElement(tr, 'td');
      if (!table || !tbody || !tr || !td) continue;
      const columns = this.elements(td);
      if (
        columns.length < 1 ||
        columns.length > SECTION_LAYOUT_LIMITS.columns ||
        !columns.every(
          (column) =>
            column.tag === 'div' &&
            this.hasClass(column, 'editor-layout-column') &&
            !!this.columnBody(column),
        ) ||
        [section, table, tbody, tr, td].some((node) =>
          (node.children ?? []).some((child) => child.type === 'text' && !!child.value?.trim()),
        )
      )
        continue;
      return { section, columns, contentParent: td, shell: [section, table, tbody, tr, td] };
    }
    return undefined;
  }
  columnBody(column: DocumentNode): DocumentNode | undefined {
    const table = this.onlyElement(column, 'table');
    return table && table.attrs?.role === 'presentation'
      ? this.onlyElement(table, 'tbody')
      : undefined;
  }
  context(document: EditorDocumentData, id: string): SectionLayoutContext | undefined {
    const projection = this.projection(document, id);
    if (!projection) return undefined;
    const { section, columns } = projection;
    const rawRatios = section.attrs?.['data-editor-layout-ratios'];
    const candidate = {
      ratios: rawRatios ? rawRatios.split('-').map(Number) : columns.map(() => 1),
      stacking: section.attrs?.['data-editor-layout-stacking'] ?? 'normal',
      breakpoint: Number(section.attrs?.['data-editor-layout-breakpoint'] ?? 640),
    };
    const parsed = v.safeParse(SectionLayoutSettingsSchema, candidate);
    const valid = parsed.success && parsed.output.ratios.length === columns.length;
    const settings = valid
      ? parsed.output
      : { ratios: columns.map(() => 1), stacking: 'normal' as const, breakpoint: 640 as const };
    return {
      ...settings,
      id: section.id,
      kind: document.kind,
      columnIds: columns.map((column) => column.id),
      removableColumnIds: columns
        .filter((column) => !this.removalReason(column, document.kind))
        .map((column) => column.id),
      editable: valid,
      ...(!valid ? { reason: 'invalid-settings' as const } : {}),
    };
  }
  removalReason(column: DocumentNode, kind: DocumentKind): SectionLayoutReason | undefined {
    const body = kind === 'email' ? this.columnBody(column) : column;
    if (!body) return 'unsupported-structure';
    if (
      (body.children ?? []).some(
        (node) =>
          node.type === 'element' ||
          node.type === 'comment' ||
          (node.type === 'text' && !!node.value?.trim()),
      )
    )
      return 'column-not-empty';
    const wrappers = kind === 'email' ? [column, ...this.elements(column), body] : [column];
    if (wrappers.some((node) => node.attrs?.id || node.attrs?.name))
      return 'identity-bearing-column';
    return undefined;
  }
  settings(current: SectionLayoutContext, patch: SectionLayoutPatch): SectionLayoutSettings {
    const value = v.parse(SectionLayoutPatchSchema, patch);
    return v.parse(SectionLayoutSettingsSchema, {
      ratios: value.ratios ?? current.ratios,
      stacking: value.stacking ?? current.stacking,
      breakpoint: value.breakpoint ?? current.breakpoint,
    });
  }
  attributes(settings: SectionLayoutSettings): Readonly<Record<string, string>> {
    return {
      'data-editor-layout': 'columns',
      'data-editor-layout-ratios': settings.ratios.join('-'),
      'data-editor-layout-stacking': settings.stacking,
      'data-editor-layout-breakpoint': String(settings.breakpoint),
    };
  }
  elements(node: DocumentNode): readonly DocumentNode[] {
    return (node.children ?? []).filter((child) => child.type === 'element');
  }
  private onlyElement(node: DocumentNode, tag: string): DocumentNode | undefined {
    const children = this.elements(node);
    return children.length === 1 && children[0]?.tag === tag ? children[0] : undefined;
  }
  private path(nodes: readonly DocumentNode[], id: string): readonly DocumentNode[] | undefined {
    for (const node of nodes) {
      if (node.id === id) return [node];
      const path = this.path(node.children ?? [], id);
      if (path) return [node, ...path];
    }
    return undefined;
  }
}
