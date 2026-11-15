import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EditorLocale } from '../../../src/vue/locale';

function sources(path: string): readonly string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory()
      ? sources(child)
      : /\.(ts|vue)$/.test(child)
        ? [readFileSync(child, 'utf8')]
        : [];
  });
}

describe('editor translation contract', () => {
  it('has a translation for every literal presentation and template key', () => {
    const locale = new EditorLocale();
    const keys = new Set(locale.keys());
    const files = [
      ...sources(fileURLToPath(new URL('../../../src/vue', import.meta.url))),
      ...sources(fileURLToPath(new URL('../../../src/templates', import.meta.url))),
    ];
    const missing = files
      .flatMap((source) =>
        [
          ...source.matchAll(
            /['"]((?:editor|actions|properties|blocks|templates|feedback|diagnostic)\.[\w-]+)['"]/g,
          ),
        ].map((match) => match[1]),
      )
      .filter((key) => !keys.has(key ?? ''));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('translates diagnostic families and honors explicitly supplied diagnostics', () => {
    const locale = new EditorLocale(
      Object.fromEntries(new EditorLocale().keys().map((key) => [key, `translated:${key}`])),
    );
    expect(locale.text('diagnostics.FORBIDDEN_HTML_TAG')).toBe('translated:diagnostic.unsafe');
    expect(locale.text('diagnostics.UNSAFE_CSS_URL')).toBe('translated:diagnostic.unsafe');
    expect(locale.text('diagnostics.INVALID_DOCUMENT_SCHEMA')).toBe(
      'translated:diagnostic.invalid',
    );
    expect(locale.text('diagnostics.futureValidationFailure')).toBe(
      'translated:diagnostic.invalid',
    );
    expect(locale.text('diagnostics.FUTURE_TOO_LARGE')).toBe('translated:diagnostic.tooLarge');
    expect(locale.text('diagnostics.FUTURE_TOO_DEEP')).toBe('translated:diagnostic.tooLarge');
    expect(locale.text('diagnostics.kindMismatch')).toBe('translated:diagnostic.kindMismatch');
    expect(locale.text('diagnostics.DOCUMENT_KIND_MISMATCH')).toBe(
      'translated:diagnostic.kindMismatch',
    );
    expect(locale.text('diagnostics.saveFailed')).toBe('translated:feedback.unknown');
    expect(
      new EditorLocale({ 'diagnostics.FORBIDDEN_HTML_TAG': 'Host-specific guidance' }).text(
        'diagnostics.FORBIDDEN_HTML_TAG',
      ),
    ).toBe('Host-specific guidance');
  });
});
