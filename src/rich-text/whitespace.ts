import { DOMParser } from '@tiptap/pm/model';
import type { ParseOptions, Schema, Slice } from '@tiptap/pm/model';

/** Keeps clipboard parsing on the schema's parser while preserving authored spacing. */
export class RichTextWhitespaceParser extends DOMParser {
  constructor(schema: Schema) {
    super(schema, DOMParser.fromSchema(schema).rules);
  }

  override parseSlice(dom: Node, options: ParseOptions = {}): Slice {
    return super.parseSlice(dom, { ...options, preserveWhitespace: 'full' });
  }
}
