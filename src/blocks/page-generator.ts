import type { Block } from '../core/block-document';
import type { SourceInput } from '../core/document';
import { escapeHtml } from '../core/html-escape';
import type { BlockDocumentView, BlockTypeCatalog, OutputMode } from './block-type';
import { PageRenderContext, blockClass } from './render-context';
import { StyleResolver } from './styles';
import type { StylePath } from './styles';
import { BlockDeviceStyles } from './device-styles';
import type { DeviceUsage } from './device-styles';

/** Width below which the columns of a section stack, as in the e-mail breakpoint. */
export const PAGE_BREAKPOINT = 640;

/** CSS variable of a global style: `body.textColor` is `--ve-body-text-color`. */
export function styleVariable(path: StylePath): string {
  return `--ve-${path.replace('.', '-').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

const v = (path: StylePath): string => `var(${styleVariable(path)})`;

/** Rules every generated page shares; the values come from the variables of `:root`. */
const BASE_CSS = [
  `body{margin:0;background:${v('body.background')}}`,
  `.ve-page{background:${v('body.background')};font-family:${v('body.fontFamily')};color:${v('body.textColor')};font-size:${v('body.fontSize')};line-height:${v('body.lineHeight')}}`,
  '.ve-page *,.ve-page *::before,.ve-page *::after{box-sizing:border-box}',
  `.ve-page a{color:${v('body.linkColor')}}`,
  `.ve-section{max-width:${v('body.width')};margin:0 auto;background-color:${v('body.contentBackground')};padding:${v('section.padding')}}`,
  `.ve-columns{display:grid;grid-template-columns:minmax(0,1fr);column-gap:${v('section.columnGap')}}`,
  '.ve-column{min-width:0;padding:0;align-self:start}',
  '.ve-block{padding:10px 25px}',
  '.ve-text>:first-child,.ve-footer>:first-child{margin-top:0}',
  '.ve-text>:last-child,.ve-footer>:last-child{margin-bottom:0}',
  `.ve-heading{margin:0;font-family:${v('heading.fontFamily')};color:${v('heading.color')};font-size:${v('heading.fontSize')};font-weight:${v('heading.fontWeight')};line-height:${v('heading.lineHeight')}}`,
  `.ve-footer{color:${v('footer.color')};font-size:${v('footer.fontSize')}}`,
  '.ve-image{text-align:center}',
  '.ve-image img{display:inline-block;max-width:100%;height:auto;border:0}',
  '.ve-image-empty{min-height:120px;background:#e8eef0}',
  '.ve-button-row{text-align:center}',
  `.ve-page .ve-button{display:inline-block;background-color:${v('button.background')};color:${v('button.color')};border-radius:${v('button.radius')};font-size:${v('button.fontSize')};font-weight:${v('button.fontWeight')};padding:${v('button.padding')};line-height:1.2;text-decoration:none}`,
  `.ve-divider hr{margin:0;border:0;border-top:${v('divider.width')} solid ${v('divider.color')}}`,
  '.ve-spacer{height:20px}',
  '.ve-html{padding:0}',
].join('');
const MOBILE_CSS = `@media (max-width:${PAGE_BREAKPOINT}px){.ve-section>.ve-columns{grid-template-columns:minmax(0,1fr)}}`;

/**
 * Writes the HTML and CSS of a block page, synchronously. The global styles become the
 * variables of `:root`; a block that overrides a value gets a rule on its own class
 * `.ve-b-<id>`. Sections are grids of real columns that stack on small screens. In preview the
 * selectable and editable elements carry the canvas attributes; the published page does not.
 */
interface PageRun {
  readonly mode: OutputMode;
  readonly styles: StyleResolver;
  readonly rules: string[];
  readonly overrides: string[];
  readonly mobile: string[];
  readonly usage: DeviceUsage;
}

export class BlockPageGenerator {
  readonly #devices = new BlockDeviceStyles(PAGE_BREAKPOINT);

  constructor(private readonly registry: BlockTypeCatalog) {}

  toHtml(document: BlockDocumentView, mode: OutputMode): SourceInput {
    if (document.kind !== 'page') throw new Error('BLOCK_GENERATOR_KIND_MISMATCH');
    const styles = new StyleResolver(this.registry.styles, document.styles, 'page');
    const run: PageRun = {
      mode,
      styles,
      rules: [],
      overrides: [],
      mobile: [],
      usage: { hideDesktop: false, hideMobile: false },
    };
    const content = document.blocks.map((block) => this.block(block, run)).join('');
    const variables = this.registry.styles
      .paths()
      .filter((path) => {
        const [group = '', key = ''] = path.split('.');
        const kinds = this.registry.styles.key(group, key)?.kinds;
        return !kinds || kinds.includes('page');
      })
      .map((path) => `${styleVariable(path)}:${styles.value(path)}`)
      .join(';');
    return {
      html: `<main class="ve-page" lang="${escapeHtml(document.meta.lang)}">${content}</main>`,
      css: `:root{${variables}}${BASE_CSS}${run.rules.join('')}${run.overrides.join('')}${MOBILE_CSS}${this.#devices.pageCss(mode, run.usage, run.mobile)}`,
    };
  }

  private block(block: Block, run: PageRun): string {
    const definition = this.registry.definition(block.type);
    run.overrides.push(...this.overrides(block));
    this.#devices.usage(block, run.usage);
    run.mobile.push(...this.#devices.pageRules(block, definition));
    const context = new PageRenderContext(
      block,
      definition,
      run.mode,
      run.styles,
      (reverse) => {
        const markup = (block.children ?? []).map((child) => this.block(child, run));
        return (reverse ? markup.reverse() : markup).join('');
      },
      run.rules,
      run.mobile,
    );
    return definition.page(context);
  }

  /** `.ve-b-<id>{...}` and `.ve-b-<id> <inner>{...}` for the values the block overrides. */
  private overrides(block: Block): readonly string[] {
    const definition = this.registry.definition(block.type);
    const self: string[] = [];
    const inner: string[] = [];
    for (const field of definition.fields) {
      const own = block.props[field.key];
      if (!field.css || own === undefined) continue;
      const value = field.css.map ? field.css.map[String(own)] : String(own);
      if (value === undefined) continue;
      (field.css.target === 'inner' ? inner : self).push(`${field.css.property}:${value}`);
    }
    const selector = `.${blockClass(block)}`;
    return [
      ...(self.length ? [`${selector}{${self.join(';')}}`] : []),
      ...(inner.length && definition.innerSelector
        ? [`${selector} ${definition.innerSelector}{${inner.join(';')}}`]
        : []),
    ];
  }
}
