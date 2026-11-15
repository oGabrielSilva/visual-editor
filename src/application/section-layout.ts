import { EditorDocument } from '../core/document';
import type { DocumentNode, EditorDocumentData, SourceInput } from '../core/document';
import { SectionLayoutPolicy } from '../core/section-layout';
import type {
  SectionLayoutContext,
  SectionLayoutPatch,
  SectionLayoutProjection,
  SectionLayoutSettings,
} from '../core/section-layout';
import { ContentService } from './content-service';

export interface SectionScaffoldPort {
  create(settings: SectionLayoutSettings, original: SectionLayoutProjection): Promise<SourceInput>;
  supports(projection: SectionLayoutProjection): boolean;
}
export interface SectionIdentityPort {
  next(): string;
}

/** Changes a supported section, retaining content identities and untouched document regions. */
export class SectionLayoutService {
  private readonly policy = new SectionLayoutPolicy();
  constructor(
    private readonly content: ContentService,
    private readonly identities: SectionIdentityPort,
    private readonly scaffold?: SectionScaffoldPort,
  ) {}
  context(document: EditorDocumentData, id: string): SectionLayoutContext | undefined {
    const context = this.policy.context(document, id);
    if (!context) return undefined;
    const projection = this.policy.projection(document, id);
    if (document.kind === 'email' && (!projection || !this.scaffold?.supports(projection)))
      return { ...context, editable: false, reason: 'unsupported-structure' };
    return context;
  }
  async update(
    document: EditorDocumentData,
    id: string,
    patch: SectionLayoutPatch,
  ): Promise<EditorDocument> {
    const context = this.context(document, id);
    const projection = this.policy.projection(document, id);
    if (!context?.editable || !projection)
      throw new Error(context?.reason ?? 'unsupported-structure');
    const settings = this.policy.settings(context, patch);
    for (const column of projection.columns.slice(settings.ratios.length)) {
      const reason = this.policy.removalReason(column, document.kind);
      if (reason) throw new Error(reason);
    }
    const ids = new Set(this.all(document.nodes).map((node) => node.id));
    let section: DocumentNode;
    let extraCss = '';
    if (document.kind === 'page') {
      const columns = projection.columns.slice(0, settings.ratios.length);
      while (columns.length < settings.ratios.length)
        columns.push({
          id: this.fresh(ids),
          type: 'element',
          tag: 'div',
          attrs: { 'data-editor-layout-column': 'true' },
          children: [],
        });
      const retained = new Set(columns.map((column) => column.id));
      const children = (projection.section.children ?? []).filter(
        (node) => node.type !== 'element' || retained.has(node.id),
      );
      children.push(
        ...columns.filter((column) => !projection.columns.some((old) => old.id === column.id)),
      );
      section = {
        ...projection.section,
        attrs: {
          ...projection.section.attrs,
          ...this.policy.attributes(settings),
          style: this.content.withoutStyles(projection.section.attrs?.style ?? '', [
            'display',
            'grid-template-columns',
            'grid-template',
            'grid',
            'flex-direction',
            'flex-flow',
          ]),
        },
        children,
      };
    } else {
      if (!this.scaffold) throw new Error('unavailable');
      const source = await this.scaffold.create(settings, projection);
      const imported = this.content.inspect(source, 'email');
      if (!imported.document) throw new Error('unsupported-structure');
      const generated = this.all(imported.document.nodes).find((node) =>
        this.policy.hasClass(node, 'editor-layout-section'),
      );
      const shell = generated && this.policy.projection(imported.document, generated.id);
      if (!shell || !this.scaffold.supports(shell)) throw new Error('unsupported-structure');
      const columnMap = new Map(shell.columns.map((column, index) => [column.id, index]));
      const shellMap = new Map(
        (shell.shell ?? []).map((node, index) => [node.id, projection.shell?.[index]]),
      );
      const transplant = (node: DocumentNode): DocumentNode => {
        if (node.type !== 'element') return { ...node, id: this.fresh(ids) };
        const index = columnMap.get(node.id);
        if (index !== undefined) {
          const old = projection.columns[index];
          if (old)
            return {
              ...old,
              attrs: {
                ...old.attrs,
                class: [
                  ...(old.attrs?.class ?? '')
                    .split(/\s+/)
                    .filter((value) => value && !value.startsWith('mj-column-per-')),
                  'editor-layout-column',
                ]
                  .filter((value, position, values) => values.indexOf(value) === position)
                  .join(' '),
                style: this.content.withoutStyles(old.attrs?.style ?? '', [
                  'width',
                  'max-width',
                  'display',
                ]),
              },
            };
        }
        const old = shellMap.get(node.id);
        const attrs: Record<string, string> = old ? { ...old.attrs } : { ...node.attrs };
        if (index !== undefined) {
          attrs.class = (attrs.class ?? '')
            .split(/\s+/)
            .filter((value) => value && !value.startsWith('mj-column-per-'))
            .join(' ');
          attrs.style = this.content.withoutStyles(attrs.style ?? '', [
            'width',
            'max-width',
            'display',
          ]);
        }
        if (node.id === shell.contentParent?.id)
          attrs.style = this.content.withoutStyles(attrs.style ?? '', ['direction']);
        return {
          ...node,
          id: old?.id ?? this.fresh(ids),
          attrs,
          children: (node.children ?? []).map(transplant),
        };
      };
      section = transplant(shell.section);
      section = { ...section, attrs: { ...section.attrs, ...this.policy.attributes(settings) } };
      extraCss = imported.document.css;
    }
    const css = this.content.addDefaultStyles(document.css, [
      extraCss,
      this.styles(settings, document.kind),
    ]);
    const nodes = this.replace(document.nodes, projection.section.id, section);
    return this.content.document(
      EditorDocument.from(document).withChanges({ nodes, css }).snapshot(),
    );
  }
  private styles(settings: SectionLayoutSettings, kind: 'email' | 'page'): string {
    const key = `[data-editor-layout="columns"][data-editor-layout-ratios="${settings.ratios.join('-')}"][data-editor-layout-stacking="${settings.stacking}"][data-editor-layout-breakpoint="${settings.breakpoint}"]`;
    const host = kind === 'page' ? key : `${key}>table>tbody>tr>td`;
    const children = `${host}>${kind === 'page' ? '*' : '.editor-layout-column'}`;
    const total = settings.ratios.reduce((sum, weight) => sum + weight, 0);
    const desktop =
      kind === 'page'
        ? `${host}{display:grid!important;grid-template-columns:${settings.ratios.map((weight) => `minmax(0,${weight}fr)`).join(' ')}!important}`
        : `${host}{direction:ltr!important}${settings.ratios.map((weight, index) => `${children}:nth-of-type(${index + 1}){display:inline-block!important;width:${Math.round((weight / total) * 1000000) / 10000}%!important;vertical-align:top}`).join('')}`;
    const stack =
      settings.stacking === 'none'
        ? ''
        : `@media(max-width:${settings.breakpoint}px){${host}{display:flex!important;flex-direction:${settings.stacking === 'reverse' ? 'column-reverse' : 'column'}!important}${children}{width:100%!important;max-width:100%!important}}`;
    return `${desktop}${children}{min-width:0;box-sizing:border-box}${stack}`;
  }
  private fresh(ids: Set<string>): string {
    for (let attempt = 0; attempt < 16; attempt++) {
      const id = this.identities.next();
      if (id && !ids.has(id)) {
        ids.add(id);
        return id;
      }
    }
    throw new Error('IDENTITY_COLLISION');
  }
  private all(nodes: readonly DocumentNode[]): readonly DocumentNode[] {
    return nodes.flatMap((node) => [node, ...this.all(node.children ?? [])]);
  }
  private replace(
    nodes: readonly DocumentNode[],
    id: string,
    replacement: DocumentNode,
  ): readonly DocumentNode[] {
    return nodes.map((node) =>
      node.id === id
        ? replacement
        : node.children
          ? { ...node, children: this.replace(node.children, id, replacement) }
          : node,
    );
  }
}
