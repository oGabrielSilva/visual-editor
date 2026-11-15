/** Vendor boundary: mjml-browser exposes the same async API as MJML core. */
declare module 'mjml-browser' {
  import type { MJMLParsingOptions, MJMLParseResults } from 'mjml-core';
  export default function mjml2html(
    source: string,
    options?: MJMLParsingOptions,
  ): Promise<MJMLParseResults>;
}
