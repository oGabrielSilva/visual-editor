import { Tokenizer } from 'parse5';
import type { Token } from 'parse5';
import type { SectionScaffoldPort } from '../application/section-layout';
import type { SectionLayoutProjection, SectionLayoutSettings } from '../core/section-layout';
import type { DocumentNode, SourceInput } from '../core/document';
import type { CssDocumentCodec } from '../codecs/css';
import { MjmlEmailRenderer } from './email-renderer';

/** Generates only an empty MJML layout shell. Existing column HTML is transplanted by application. */
export class MjmlSectionScaffold implements SectionScaffoldPort {
  constructor(
    private readonly renderer: MjmlEmailRenderer,
    private readonly styles: Pick<CssDocumentCodec, 'inspect' | 'readDeclarations'>,
  ) {}
  create(settings: SectionLayoutSettings, original: SectionLayoutProjection): Promise<SourceInput> {
    const geometry = this.geometry(original);
    if (!geometry) throw new Error('unsupported-structure');
    const total = settings.ratios.reduce((sum, value) => sum + value, 0);
    const columns = settings.ratios
      .map(
        (weight) =>
          `<mj-column css-class="editor-layout-column" width="${Math.round((weight / total) * 1000000) / 10000}%"></mj-column>`,
      )
      .join('');
    return this.renderer.createSource(
      `<mjml><mj-head><mj-breakpoint width="${settings.breakpoint + 1}px" /></mj-head><mj-body width="600px"><mj-section css-class="editor-layout-section" padding="${geometry.padding}">${columns}</mj-section></mj-body></mjml>`,
    );
  }
  supports(projection: SectionLayoutProjection): boolean {
    if (
      projection.section.type !== 'element' ||
      projection.section.tag !== 'div' ||
      !projection.shell ||
      projection.shell.length !== 5 ||
      !this.geometry(projection)
    )
      return false;
    return (
      projection.shell.every((node) =>
        (node.children ?? []).every(
          (child) => child.type !== 'comment' || this.layoutComment(child),
        ),
      ) &&
      projection.columns.every((column) =>
        (column.children ?? []).every((child) => child.type !== 'text' || !child.value?.trim()),
      )
    );
  }
  private geometry(projection: SectionLayoutProjection): { padding: string } | undefined {
    const root = this.styles.inspect(projection.section.attrs?.style ?? '', 'declarationList');
    const inner = this.styles.inspect(
      projection.contentParent?.attrs?.style ?? '',
      'declarationList',
    );
    if (root.diagnostics.length || inner.diagnostics.length) return undefined;
    const rootDeclarations = this.styles.readDeclarations(projection.section.attrs?.style ?? '');
    const innerDeclarations = this.styles.readDeclarations(
      projection.contentParent?.attrs?.style ?? '',
    );
    const padding = innerDeclarations.padding ?? '20px 0';
    if (
      root.diagnostics.length ||
      inner.diagnostics.length ||
      rootDeclarations['max-width'] !== '600px' ||
      Object.keys(innerDeclarations).some(
        (property) => property.startsWith('padding-') || property.startsWith('border'),
      ) ||
      !/^(?:[0-9]+(?:\.[0-9]+)?(?:px)?)(?:\s+[0-9]+(?:\.[0-9]+)?(?:px)?){0,3}$/.test(padding) ||
      padding.split(/\s+/).some((value) => parseFloat(value) > 200)
    )
      return undefined;
    return { padding };
  }
  private layoutComment(node: DocumentNode): boolean {
    const value = (node.value ?? '').trim();
    const start = value.indexOf(']>');
    const end = value.toLowerCase().lastIndexOf('<![endif]');
    if (
      start < 0 ||
      end < start ||
      !['[if mso | IE', '[if mso', '[if IE'].includes(value.slice(0, start))
    )
      return false;
    let valid = true;
    // Conditional fragments deliberately contain unmatched table boundaries. Tokenization
    // retains every attribute, unlike HTML fragment tree building which can drop a table opener.
    const tokenizer = new Tokenizer(
      {},
      {
        onStartTag: (token) => {
          if (!this.layoutTag(token)) valid = false;
        },
        onEndTag: (token) => {
          if (!['table', 'tbody', 'tr', 'td'].includes(token.tagName) || token.attrs.length)
            valid = false;
        },
        onCharacter: (token) => {
          if (token.chars.trim()) valid = false;
        },
        onWhitespaceCharacter: () => undefined,
        onNullCharacter: () => {
          valid = false;
        },
        onComment: () => {
          valid = false;
        },
        onDoctype: () => {
          valid = false;
        },
        onParseError: () => {
          valid = false;
        },
        onEof: () => undefined,
      },
    );
    tokenizer.write(value.slice(start + 2, end), true);
    return valid;
  }
  private layoutTag(token: Token.TagToken): boolean {
    if (!['table', 'tbody', 'tr', 'td'].includes(token.tagName)) return false;
    const fixedValues: Readonly<Record<string, string>> = {
      role: 'presentation',
      border: '0',
      cellpadding: '0',
      cellspacing: '0',
      align: 'center',
    };
    for (const attr of token.attrs) {
      if (Object.hasOwn(fixedValues, attr.name)) {
        if (token.tagName !== 'table' || attr.value !== fixedValues[attr.name]) return false;
        continue;
      }
      if (attr.name === 'width') {
        if (
          !['table', 'td'].includes(token.tagName) ||
          !/^[0-9]+(?:\.[0-9]+)?(?:px)?$/.test(attr.value) ||
          parseFloat(attr.value) <= 0 ||
          parseFloat(attr.value) > 600
        )
          return false;
        continue;
      }
      if (attr.name === 'class') {
        if (
          token.tagName !== 'td' ||
          attr.value
            .split(/\s+/)
            .some(
              (name) =>
                !['editor-layout-column-outlook', 'editor-layout-section-outlook'].includes(name),
            )
        )
          return false;
        continue;
      }
      if (attr.name !== 'style') return false;
      const inspected = this.styles.inspect(attr.value, 'declarationList');
      if (
        inspected.diagnostics.length ||
        Object.keys(inspected.declarations).some(
          (property) => !['vertical-align', 'width'].includes(property),
        )
      )
        return false;
    }
    return true;
  }
}
