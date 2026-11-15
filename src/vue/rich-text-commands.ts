import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import { RICH_TEXT_LIMITS, emptyRichTextState } from '../rich-text/commands';
import type {
  RichTextCommandName,
  RichTextCommandState,
  RichTextCommands,
} from '../rich-text/commands';
import { TEXT_FONT_FAMILIES, TEXT_STYLE_LIMITS } from '../security/text-presentation';
import type { UrlPolicy } from '../security/url-policy';
import { ColorStyleValue } from './components/ui/color-style-value';
import { NumericStyleValue } from './components/ui/numeric-style-value';

/**
 * Validates the value of a formatting command in the host, before any editor receives it: the
 * same color, font, measure and link rules for the panel editor and for the preview frame.
 */
export class RichTextCommandValues {
  private readonly colors = new ColorStyleValue();
  private readonly fontSize = new NumericStyleValue(['px'], 1, TEXT_STYLE_LIMITS.fontSizePx);
  private readonly lineHeight = new NumericStyleValue(
    ['', 'px'],
    1,
    TEXT_STYLE_LIMITS.lineHeightPx,
    {
      '': TEXT_STYLE_LIMITS.lineHeightRatio,
    },
  );

  constructor(private readonly urls: () => UrlPolicy) {}

  /** Returns undefined for a refused value; `null` asks to clear the style. */
  resolve(
    command: RichTextCommandName,
    input: string | null | undefined,
  ): { readonly value: string | null } | undefined {
    const style = input === null || input === undefined || input === 'inherit' ? undefined : input;
    switch (command) {
      case 'color':
      case 'backgroundColor': {
        if (style === undefined) return { value: null };
        const color = this.colors.normalize(style);
        return color ? { value: color } : undefined;
      }
      case 'fontFamily':
        if (style === undefined) return { value: null };
        return (TEXT_FONT_FAMILIES as readonly string[]).includes(style)
          ? { value: style }
          : undefined;
      case 'fontSize':
        if (style === undefined) return { value: null };
        return this.fontSize.parse(style) ? { value: style.trim() } : undefined;
      case 'lineHeight':
        if (style === undefined) return { value: null };
        return this.lineHeight.parse(style) ? { value: style.trim() } : undefined;
      case 'setLink': {
        const value = input?.trim();
        return value &&
          value.length <= RICH_TEXT_LIMITS.commandValue &&
          this.urls().isSafe(value, 'link')
          ? { value }
          : undefined;
      }
      case 'insertText':
        return input && input.length <= RICH_TEXT_LIMITS.insertedText
          ? { value: input }
          : undefined;
      default:
        return input === null || input === undefined ? { value: null } : undefined;
    }
  }
}

/** Formatting commands for the editor inside the preview frame, sent as typed messages. */
export class RemoteRichTextCommands implements RichTextCommands {
  readonly #state: ShallowRef<RichTextCommandState> = shallowRef(emptyRichTextState());
  private readonly colors = new ColorStyleValue();

  constructor(
    private readonly values: RichTextCommandValues,
    private readonly post: (command: RichTextCommandName, value: string | null) => void,
  ) {}

  get state(): RichTextCommandState {
    return this.#state.value;
  }

  /** Telemetry from the frame, already validated by the message policy. */
  update(state: RichTextCommandState | undefined): void {
    if (!state) {
      this.#state.value = emptyRichTextState();
      return;
    }
    // The frame reports computed colors; the controls speak the notation of the host.
    const color = (value: string): string => this.colors.normalize(value) ?? '';
    this.#state.value = {
      ...state,
      styles: {
        ...state.styles,
        color: { ...state.styles.color, value: color(state.styles.color.value) },
        backgroundColor: {
          ...state.styles.backgroundColor,
          value: color(state.styles.backgroundColor.value),
        },
      },
    };
  }

  run(command: RichTextCommandName, value?: string | null): boolean {
    // Leaving the text is always possible, even before the frame reported a caret.
    if (!this.#state.value.ready && command !== 'finish' && command !== 'cancel') return false;
    const resolved = this.values.resolve(command, value);
    if (!resolved) return false;
    this.post(command, resolved.value);
    return true;
  }
}
