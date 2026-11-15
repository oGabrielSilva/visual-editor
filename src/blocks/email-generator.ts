import type { Block } from '../core/block-document';
import { escapeHtml } from '../core/html-escape';
import { GeneratedMjml } from '../compilation/generated-mjml';
import { SecureIdentifier } from '../security/identity';
import type { BlockDocumentView, BlockTypeCatalog, OutputMode } from './block-type';
import { EmailRenderContext } from './render-context';
import type { MjmlTarget } from './styles';
import { StyleResolver } from './styles';
import { columnWeight } from './types/layout';
import { BlockDeviceStyles } from './device-styles';
import type { DeviceUsage } from './device-styles';

/** Columns sit side by side above this width and stack below it, as in the e-mail models. */
export const EMAIL_BREAKPOINT = '641px';
/** Largest width that counts as a small screen: one below the breakpoint. */
const SMALL_SCREEN = 640;

interface EmailRun {
  readonly mode: OutputMode;
  readonly styles: StyleResolver;
  readonly fragments: string[];
  readonly token: string;
  readonly usage: DeviceUsage;
  readonly mobile: string[];
}

/**
 * Writes the MJML of a block e-mail. The global styles become `<mj-attributes>` (and named
 * `mj-class` for headings and footers), so a style is written once and MJML spreads it over
 * every element it generates (cell, link, Outlook markup). A block writes only the values it
 * overrides. Columns are real `mj-column`. In preview every component also carries
 * `css-class="ve-p-<token>-<id>"`, with a token drawn for the rendering, which the preview
 * marker turns into the canvas attributes.
 */
export class BlockMjmlGenerator {
  readonly #devices = new BlockDeviceStyles(SMALL_SCREEN);

  constructor(private readonly registry: BlockTypeCatalog) {}

  toMjml(
    document: BlockDocumentView,
    mode: OutputMode,
    token: string = new SecureIdentifier().next(),
  ): GeneratedMjml {
    if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('INVALID_PREVIEW_TOKEN');
    if (document.kind !== 'email') throw new Error('BLOCK_GENERATOR_KIND_MISMATCH');
    const styles = new StyleResolver(this.registry.styles, document.styles, 'email');
    const run: EmailRun = {
      mode,
      styles,
      fragments: [],
      token,
      usage: { hideDesktop: false, hideMobile: false },
      mobile: [],
    };
    const body = document.blocks.map((block) => this.block(block, run)).join('');
    const source =
      `<mjml lang="${escapeHtml(document.meta.lang)}">` +
      `<mj-head><mj-breakpoint width="${EMAIL_BREAKPOINT}" />` +
      `<mj-attributes>${this.attributes(styles)}</mj-attributes>` +
      `<mj-style>a { color: ${styles.value('body.linkColor')}; }</mj-style>` +
      `${this.#devices.emailHead(mode, run.usage, run.mobile)}</mj-head>` +
      `<mj-body background-color="${escapeHtml(styles.value('body.background'))}" width="${escapeHtml(styles.value('body.width'))}">` +
      `${body}</mj-body></mjml>`;
    return new GeneratedMjml(source, run.fragments);
  }

  private block(block: Block, run: EmailRun, columnWidth?: string): string {
    const definition = this.registry.definition(block.type);
    if (!definition.email) throw new Error('BLOCK_NOT_IN_EMAIL');
    const children = block.children ?? [];
    const widths = block.type === 'section' ? this.widths(children) : [];
    this.#devices.usage(block, run.usage);
    const mobile = this.#devices.emailRules(block, definition);
    run.mobile.push(...mobile);
    const context = new EmailRenderContext(
      block,
      definition,
      run.mode,
      run.styles,
      (reverse) => {
        const markup = children.map((child, index) => this.block(child, run, widths[index]));
        return (reverse ? markup.reverse() : markup).join('');
      },
      run.fragments,
      run.token,
      columnWidth,
      mobile.length > 0,
    );
    return definition.email(context);
  }

  /** Shares of the columns of a section, in percent with at most two decimals. */
  private widths(columns: readonly Block[]): readonly string[] {
    const weights = columns.map(columnWeight);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => `${Number(((weight / total) * 100).toFixed(2))}%`);
  }

  private attributes(styles: StyleResolver): string {
    const groups = new Map<string, { target: MjmlTarget; pairs: [string, string][] }>();
    for (const path of this.registry.styles.paths()) {
      const [group = '', key = ''] = path.split('.');
      for (const target of this.registry.styles.key(group, key)?.mjml ?? []) {
        const id = `${target.element}|${target.mjClass ?? ''}`;
        const entry = groups.get(id) ?? { target, pairs: [] };
        entry.pairs.push([target.attribute, styles.value(path)]);
        groups.set(id, entry);
      }
    }
    return [...groups.values()]
      .map(({ target, pairs }) => {
        const attributes = pairs.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('');
        return target.mjClass
          ? `<mj-class name="${target.mjClass}"${attributes} />`
          : `<${target.element}${attributes} />`;
      })
      .join('');
  }
}
