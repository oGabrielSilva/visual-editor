export type UrlPurpose = 'link' | 'image';

export interface UrlPolicyOptions {
  readonly exactUrlPlaceholders?: readonly string[];
}

/** URI protocol decisions live here; callers must pass decoded HTML/CSS values. */
export class UrlPolicy {
  readonly #placeholders: ReadonlySet<string>;

  constructor(options: UrlPolicyOptions = {}) {
    const placeholders = options.exactUrlPlaceholders ?? ['{{unsubscribe_url}}', '{{view_url}}'];
    if (
      placeholders.length > 64 ||
      placeholders.some(
        (value) => value.length > 200 || !/^\{\{[a-zA-Z][a-zA-Z0-9_.]*\}\}$/.test(value),
      )
    )
      throw new RangeError('INVALID_URL_PLACEHOLDER_CONFIG');
    this.#placeholders = new Set(placeholders);
  }

  isSafe(input: string, purpose: UrlPurpose = 'link'): boolean {
    // Checked before trimming: these are never part of an honest URL and some are skipped
    // or read as separators by URL parsers, wherever they sit in the value.
    if ([...input].some((character) => this.invisible(character.codePointAt(0) ?? 0))) return false;
    const value = input.trim();
    if (!value) return true;
    if (this.#placeholders.has(value)) return purpose === 'link';
    if (value.includes('{{') && !value.startsWith('https://') && !value.startsWith('http://'))
      return false;
    // Controls may be ignored by browser URL parsers and disguise a protocol.
    if (
      [...value].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      return false;
    if (!this.spacesOnlyAfterScheme(value)) return false;
    if (value.startsWith('//') || value.startsWith('\\')) return false;
    try {
      const parsed = new URL(value, 'https://editor.invalid/');
      if (parsed.username || parsed.password) return false;
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return true;
      if (purpose === 'link' && (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:'))
        return true;
      return purpose === 'image' && parsed.protocol === 'cid:';
    } catch {
      return false;
    }
  }

  /**
   * Whether a document URL would run code where it is followed: `javascript:`, `vbscript:`
   * or a `data:` document. Unlike `isSafe`, which decides what the editor itself may write,
   * this only classifies imported content; merge tags and unknown schemes are not active.
   */
  isActive(input: string): boolean {
    // Browsers drop tabs and line breaks anywhere and controls or spaces before the scheme.
    const value = [...input]
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 32 && code !== 127;
      })
      .join('')
      .toLowerCase();
    if (['javascript:', 'vbscript:', 'livescript:'].some((scheme) => value.startsWith(scheme)))
      return true;
    if (!value.startsWith('data:')) return false;
    const type = value.slice('data:'.length).split(/[;,]/, 1)[0] ?? '';
    return ['text/html', 'application/xhtml+xml', 'text/xml', 'application/xml'].includes(type);
  }

  /** Unicode separators, zero-width marks and direction controls (NEL, NBSP, ZWSP, BOM...). */
  private invisible(code: number): boolean {
    return (
      code === 0x85 ||
      code === 0xa0 ||
      code === 0x1680 ||
      (code >= 0x2000 && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202f) ||
      (code >= 0x205f && code <= 0x2064) ||
      code === 0x3000 ||
      code === 0xfeff
    );
  }

  /**
   * A space never precedes or sits inside a scheme or authority. It is tolerated only in the
   * path or query of an explicit http(s) URL and after the colon of mailto and tel.
   */
  private spacesOnlyAfterScheme(value: string): boolean {
    const first = value.indexOf(' ');
    if (first < 0) return true;
    const lower = value.toLowerCase();
    if (lower.startsWith('mailto:')) return first >= 'mailto:'.length;
    if (lower.startsWith('tel:')) return first >= 'tel:'.length;
    const scheme = ['https://', 'http://'].find((prefix) => lower.startsWith(prefix));
    if (!scheme) return false;
    const rest = value.slice(scheme.length);
    const boundaries = ['/', '?'].map((mark) => rest.indexOf(mark)).filter((index) => index >= 0);
    // Browsers read a backslash as a path separator in special schemes: keep it unambiguous.
    if (!boundaries.length || rest.includes('\\')) return false;
    const pathStart = scheme.length + Math.min(...boundaries);
    const fragment = value.indexOf('#');
    if (fragment >= 0 && (fragment < pathStart || value.lastIndexOf(' ') > fragment)) return false;
    return first > pathStart;
  }
}
