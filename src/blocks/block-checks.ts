import type { Block } from '../core/block-document';
import { DocumentBudget } from '../core/budget';
import type { BlockDocumentView } from './block-type';

/** What the review before sending or publishing points out. */
export type BlockCheckCode =
  | 'PIECE_EMPTY'
  | 'LINK_EMPTY'
  | 'BUTTON_WITHOUT_LINK'
  | 'BUTTON_WITHOUT_TEXT'
  | 'IMAGE_WITHOUT_SOURCE'
  | 'IMAGE_WITHOUT_ALT'
  | 'HIDDEN_ON_EVERY_SCREEN'
  | 'EMAIL_NEAR_CLIP'
  | 'EMAIL_CLIPPED';

export interface BlockCheck {
  readonly code: BlockCheckCode;
  /** `error`: the reader meets something broken; `warning`: worth a look before sending. */
  readonly severity: 'error' | 'warning';
  /** The block to show; absent for a finding about the whole piece. */
  readonly blockId?: string;
  /** Size of the e-mail in kilobytes, for the size findings. */
  readonly kilobytes?: number;
}

/** Gmail shows only the first 102 KB of the HTML of a message and hides the rest behind a link. */
export const GMAIL_CLIP_BYTES = 102 * 1024;
/**
 * Below the cut, but close: the host still adds its own markup (footer, tracking) to what the
 * editor generates.
 */
export const GMAIL_NEAR_CLIP_BYTES = 90 * 1024;

const ANCHOR = /<a\b([^>]*)>/gi;
const HREF = /\bhref\s*=\s*"([^"]*)"/i;

/**
 * The review of a block piece before it goes out: links that lead nowhere, images without an
 * address or a description, buttons without text or link, blocks hidden on every screen and,
 * for an e-mail whose final HTML is given, a size Gmail would cut. It reads the piece, never
 * changes it, and works the same in the editor and in the host.
 */
export class BlockChecker {
  check(document: BlockDocumentView, finalHtml?: string): readonly BlockCheck[] {
    const checks: BlockCheck[] = [];
    if (!document.blocks.length) checks.push({ code: 'PIECE_EMPTY', severity: 'warning' });
    const stack: Block[] = [...document.blocks].reverse();
    while (stack.length) {
      const block = stack.pop();
      if (!block) break;
      this.block(block, checks);
      stack.push(...[...(block.children ?? [])].reverse());
    }
    if (document.kind === 'email' && finalHtml !== undefined) {
      const bytes = new DocumentBudget().byteLength(finalHtml);
      const kilobytes = Math.ceil(bytes / 1024);
      if (bytes > GMAIL_CLIP_BYTES)
        checks.push({ code: 'EMAIL_CLIPPED', severity: 'error', kilobytes });
      else if (bytes > GMAIL_NEAR_CLIP_BYTES)
        checks.push({ code: 'EMAIL_NEAR_CLIP', severity: 'warning', kilobytes });
    }
    return checks;
  }

  private block(block: Block, checks: BlockCheck[]): void {
    const props = block.props;
    const blockId = block.id;
    if (props.hideOnDesktop === true && props.hideOnMobile === true)
      checks.push({ code: 'HIDDEN_ON_EVERY_SCREEN', severity: 'warning', blockId });
    if (block.type === 'button') {
      if (!this.filled(props.text))
        checks.push({ code: 'BUTTON_WITHOUT_TEXT', severity: 'error', blockId });
      if (!this.link(props.href))
        checks.push({ code: 'BUTTON_WITHOUT_LINK', severity: 'error', blockId });
    }
    if (block.type === 'image') {
      if (!this.filled(props.url))
        checks.push({ code: 'IMAGE_WITHOUT_SOURCE', severity: 'warning', blockId });
      else if (!this.filled(props.alt))
        checks.push({ code: 'IMAGE_WITHOUT_ALT', severity: 'warning', blockId });
    }
    for (const key of ['text', 'html'] as const) {
      const markup = props[key];
      if (typeof markup === 'string' && this.emptyAnchor(markup)) {
        checks.push({ code: 'LINK_EMPTY', severity: 'error', blockId });
        break;
      }
    }
  }

  private filled(value: unknown): boolean {
    return typeof value === 'string' && value.replace(/<[^>]*>|&nbsp;/g, '').trim() !== '';
  }

  /** An address that leads somewhere: not empty, not only `#`. */
  private link(value: unknown): boolean {
    return typeof value === 'string' && value.trim() !== '' && value.trim() !== '#';
  }

  /** A link of the text whose address is missing, empty or only `#`. */
  private emptyAnchor(markup: string): boolean {
    for (const match of markup.matchAll(ANCHOR)) {
      const href = HREF.exec(match[1] ?? '')?.[1];
      if (href === undefined || !this.link(href)) return true;
    }
    return false;
  }
}
