export const RICH_TEXT_FORMATS = ['bold', 'italic', 'underline', 'strike', 'link'] as const;
export type RichTextFormat = (typeof RICH_TEXT_FORMATS)[number];
export type RichTextDecorationLine = 'underline' | 'line-through';
export const RICH_TEXT_ORIGIN_ATTRIBUTE = 'data-editor-rich-origin';
export const RICH_TEXT_REMOVED_ATTRIBUTE = 'data-editor-rich-removed';

const formats: Readonly<Record<string, RichTextFormat>> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  s: 'strike',
  a: 'link',
};
const resets: Readonly<Record<RichTextFormat, Readonly<Record<string, string>>>> = {
  bold: { 'font-weight': 'normal' },
  italic: { 'font-style': 'normal' },
  underline: {},
  strike: {},
  link: {},
};
const linkAttributes = [
  'href',
  'target',
  'rel',
  'ping',
  'download',
  'hreflang',
  'referrerpolicy',
  'type',
] as const;

/** Canonical semantic-mark removal transitions and their fixed visual resets. */
export class RichTextFormatPolicy {
  formatForTag(tag: string | undefined): RichTextFormat | undefined {
    return tag && Object.hasOwn(formats, tag) ? formats[tag] : undefined;
  }

  isFormat(value: unknown): value is RichTextFormat {
    return typeof value === 'string' && (RICH_TEXT_FORMATS as readonly string[]).includes(value);
  }

  canRemove(
    originalTag: string | undefined,
    replacementTag: string | undefined,
    format: unknown,
  ): boolean {
    return (
      this.isFormat(format) &&
      replacementTag === 'span' &&
      this.formatForTag(originalTag) === format
    );
  }

  resets(format: RichTextFormat): Readonly<Record<string, string>> {
    return { ...resets[format] };
  }

  decorationFor(format: RichTextFormat): RichTextDecorationLine | undefined {
    return format === 'underline' ? 'underline' : format === 'strike' ? 'line-through' : undefined;
  }

  removedAttributes(format: RichTextFormat): readonly string[] {
    return format === 'link' ? [...linkAttributes] : [];
  }
}
