import type { Block, BlockPropValue } from '../core/block-document';
import type { BlockField, BlockTypeDefinition, OutputMode } from './block-type';
import { HIDE_DESKTOP_CLASS, HIDE_MOBILE_CLASS, blockClass, mobileClass } from './render-context';

/** Which device classes a piece uses, so the generators write only the rules it needs. */
export interface DeviceUsage {
  hideDesktop: boolean;
  hideMobile: boolean;
}

/**
 * How a block hidden on the screen being edited looks in the editing frame: still there, so it
 * can be selected, but faded and outlined. The published piece hides it.
 */
const FADED = 'opacity:.35;outline:2px dashed #94a3b8;outline-offset:-2px';

/**
 * A CSS value written from a block value. The values were already checked by their field
 * (lengths, colors, choices); this refuses anything that could close the declaration anyway.
 */
export function cssValue(field: BlockField, value: BlockPropValue): string | undefined {
  const mapped = field.css?.map ? field.css.map[String(value)] : String(value);
  if (mapped === undefined || mapped === '' || /[;{}<>\\]|\/\*/.test(mapped)) return undefined;
  return mapped;
}

/**
 * The device rules of a block piece: values of small screens and blocks hidden on one screen.
 * Pages write them as CSS on the classes of the blocks; e-mails as `mj-style`, where hiding on
 * large screens is inlined (Outlook for Windows reads no media rule) and every small-screen
 * rule sits in a media rule with `!important`, which wins over the inline styles of MJML.
 */
export class BlockDeviceStyles {
  constructor(private readonly breakpoint: number) {}

  usage(block: Block, usage: DeviceUsage): void {
    if (block.props.hideOnDesktop === true) usage.hideDesktop = true;
    if (block.props.hideOnMobile === true) usage.hideMobile = true;
  }

  /** Mobile rules of the cell `.ve-m-<id>` of an e-mail block; empty when it has none. */
  emailRules(block: Block, definition: BlockTypeDefinition): readonly string[] {
    const rules: string[] = [];
    for (const [key, value] of Object.entries(block.mobile ?? {})) {
      const rule = definition.mobileEmail?.[key];
      const field = definition.fields.find((entry) => entry.key === key);
      if (!rule || !field?.responsive) continue;
      const css = cssValue(field, value);
      const properties = rule.properties ?? (field.css ? [field.css.property] : []);
      if (css === undefined || !properties.length) continue;
      const declarations = properties.map((property) => `${property}:${css}!important`).join(';');
      const selectors = rule.selectors.map((suffix) => `.${mobileClass(block)}${suffix}`).join(',');
      rules.push(`${selectors}{${declarations}}`);
    }
    return rules;
  }

  /** Mobile rules of `.ve-b-<id>` (and its inner element) of a page block. */
  pageRules(block: Block, definition: BlockTypeDefinition): readonly string[] {
    const self: string[] = [];
    const inner: string[] = [];
    for (const [key, value] of Object.entries(block.mobile ?? {})) {
      const field = definition.fields.find((entry) => entry.key === key);
      if (!field?.responsive || !field.css) continue;
      const css = cssValue(field, value);
      if (css === undefined) continue;
      (field.css.target === 'inner' ? inner : self).push(`${field.css.property}:${css}`);
    }
    const selector = `.${blockClass(block)}`;
    return [
      ...(self.length ? [`${selector}{${self.join(';')}}`] : []),
      ...(inner.length && definition.innerSelector
        ? [`${selector} ${definition.innerSelector}{${inner.join(';')}}`]
        : []),
    ];
  }

  /** The `mj-style` elements of an e-mail; empty when the piece has no device rule. */
  emailHead(mode: OutputMode, usage: DeviceUsage, mobile: readonly string[]): string {
    const small = `@media only screen and (max-width:${this.breakpoint}px)`;
    const large = `@media only screen and (min-width:${this.breakpoint + 1}px)`;
    const desktop = `.${HIDE_DESKTOP_CLASS}`;
    const phone = `.${HIDE_MOBILE_CLASS}`;
    let inline = '';
    const rules: string[] = [];
    if (mode === 'preview') {
      if (usage.hideDesktop) rules.push(`${large}{${desktop}{${FADED}}}`);
      if (usage.hideMobile || mobile.length)
        rules.push(`${small}{${usage.hideMobile ? `${phone}{${FADED}}` : ''}${mobile.join('')}}`);
    } else {
      if (usage.hideDesktop)
        inline = `<mj-style inline="inline">${desktop}{display:none;mso-hide:all;max-height:0;overflow:hidden}</mj-style>`;
      const shown = usage.hideDesktop
        ? `div${desktop}{display:block!important;max-height:none!important;overflow:visible!important}` +
          `td${desktop}{display:table-cell!important;max-height:none!important;overflow:visible!important}`
        : '';
      const hidden = usage.hideMobile
        ? `${phone}{display:none!important;mso-hide:all!important}`
        : '';
      if (shown || hidden || mobile.length)
        rules.push(`${small}{${hidden}${shown}${mobile.join('')}}`);
    }
    return `${inline}${rules.length ? `<mj-style>${rules.join('')}</mj-style>` : ''}`;
  }

  /** The device CSS of a page: visibility on each screen and the mobile rules. */
  pageCss(mode: OutputMode, usage: DeviceUsage, mobile: readonly string[]): string {
    const small = `@media (max-width:${this.breakpoint}px)`;
    const large = `@media (min-width:${this.breakpoint + 1}px)`;
    const hide = mode === 'preview' ? FADED : 'display:none!important';
    return (
      (usage.hideDesktop ? `${large}{.${HIDE_DESKTOP_CLASS}{${hide}}}` : '') +
      (usage.hideMobile || mobile.length
        ? `${small}{${mobile.join('')}${usage.hideMobile ? `.${HIDE_MOBILE_CLASS}{${hide}}` : ''}}`
        : '')
    );
  }
}
