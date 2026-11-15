export interface EditorThemeOptions {
  readonly accent?: string;
  readonly surface?: string;
  readonly background?: string;
  readonly text?: string;
  readonly muted?: string;
  readonly border?: string;
  readonly radius?: number;
  readonly fontFamily?: string;
}

const COLORS: readonly (readonly [keyof EditorThemeOptions, string, readonly string[]])[] = [
  ['accent', '--editor-accent', ['--ui-primary']],
  ['surface', '--editor-surface', ['--ui-bg', '--ui-text-inverted']],
  ['background', '--editor-background', ['--ui-bg-muted']],
  ['text', '--editor-text', ['--ui-text', '--ui-text-highlighted', '--ui-text-toned']],
  ['muted', '--editor-muted', ['--ui-text-muted', '--ui-text-dimmed']],
  ['border', '--editor-border', ['--ui-border']],
];

/**
 * Optional overrides for a host which is not themed by Nuxt UI variables. The editor has no brand
 * of its own: without options it defines nothing and inherits the theme of the host. Each option
 * given sets the matching theme variable for this editor only.
 */
export class EditorTheme {
  private readonly tokens: Readonly<Record<string, string>>;

  constructor(options: EditorThemeOptions = {}) {
    const tokens: Record<string, string> = {};
    for (const [option, alias, variables] of COLORS) {
      const value = options[option];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value))
        throw new Error('theme.invalid_color');
      for (const name of [alias, ...variables]) tokens[name] = value;
    }
    if (options.radius !== undefined) {
      if (!Number.isFinite(options.radius) || options.radius < 0 || options.radius > 24)
        throw new Error('theme.invalid_radius');
      tokens['--editor-radius'] = `${options.radius}px`;
      tokens['--ui-radius'] = `${options.radius}px`;
    }
    if (options.fontFamily !== undefined) {
      if (!/^[\w\s,'"-]+$/.test(options.fontFamily) || options.fontFamily.length > 100)
        throw new Error('theme.invalid_font');
      tokens['--editor-font'] = options.fontFamily;
    }
    this.tokens = Object.freeze(tokens);
  }

  variables(): Readonly<Record<string, string>> {
    return this.tokens;
  }
}
