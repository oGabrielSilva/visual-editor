import { defaultTreeAdapter, html, parse, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import * as v from 'valibot';
import type { DocumentKind, SourceInput } from '../core/document';
import {
  EDIT_NODE_ATTRIBUTE,
  NODE_ATTRIBUTE,
  SELECTED_ATTRIBUTE,
  THEME_COLOR_LENGTH,
  THEME_RADIUS_LIMIT,
  isThemeColor,
} from '../core/canvas-contract';
import { TEXT_FONT_FAMILIES } from '../security/text-presentation';
import { sha256Base64 } from '../security/sha256';
import { CanvasBridgeScript } from './canvas-bridge';
import type { CanvasBridgeLabels, CanvasBridgeRegion, CanvasBridgeTheme } from './canvas-bridge';
import { documentParts } from './markup-tree';
import type { MarkupElement } from './markup-tree';
import type { HtmlAssemblyPort } from './preview-document';

export interface SelectionPreview {
  readonly html: string;
  /**
   * The secret of the message protocol of this window. It only exists inside the text of the
   * runtime script, never in an attribute, and has no part in the CSP, which authorizes that
   * script by the digest of its text. The name is the one the protocol always used.
   */
  readonly nonce: string;
  readonly revision: number;
  readonly nodeIds: readonly string[];
  readonly regions: readonly CanvasBridgeRegion[];
  readonly readOnly: boolean;
  /** Test mode: only then does the host accept fidelity reports from the frame. */
  readonly diagnostics: boolean;
}

/** Options every preview of the editing frame takes, whatever document it shows. */
export interface PreviewFrameOptions {
  readonly readOnly?: boolean;
  readonly labels?: CanvasBridgeLabels;
  readonly title?: string;
  readonly lang?: string;
  /** Test mode of the frame runtime; never enabled by a document. */
  readonly diagnostics?: boolean;
  /** Colors of the host shell for the controls drawn over the piece. */
  readonly theme?: CanvasBridgeTheme;
  /** False: the host opens no block menu, so the frame never asks for one. */
  readonly menu?: false;
  /** Friendly names of the variables of the host by key (at most 500, names up to 200). */
  readonly variables?: Readonly<Record<string, string>>;
}

const VARIABLE_KEY = /^[a-zA-Z0-9._]{1,200}$/;

/** The variable names the frame may show: valid keys and plain names only. */
function previewVariables(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value).filter(
    ([key, label]) => VARIABLE_KEY.test(key) && typeof label === 'string' && label.length <= 200,
  );
  return entries.length ? Object.fromEntries(entries.slice(0, 500)) : undefined;
}

/** What the editing frame asks of the renderer of its document: a new window or a revision. */
export interface SelectionPreviewSource<
  D extends { readonly id: string; readonly revision: number },
> {
  build(document: D, selectionLabel: string, options?: PreviewFrameOptions): SelectionPreview;
  update(
    document: D,
    selectionLabel: string,
    current: Pick<SelectionPreview, 'nonce'>,
    options?: PreviewFrameOptions,
  ): SelectionPreview;
}

/**
 * One document bound to its renderer, as the editing frame takes it: the frame only knows the
 * identity of what it shows and asks for a new window or the next revision. A new renderer
 * means a new window.
 */
export interface FramePreviewSource {
  readonly id: string;
  readonly revision: number;
  readonly renderer: object;
  build(selectionLabel: string, options?: PreviewFrameOptions): SelectionPreview;
  update(
    selectionLabel: string,
    current: Pick<SelectionPreview, 'nonce'>,
    options?: PreviewFrameOptions,
  ): SelectionPreview;
}

export function framePreview<D extends { readonly id: string; readonly revision: number }>(
  renderer: SelectionPreviewSource<D>,
  document: D,
): FramePreviewSource {
  return Object.freeze({
    id: document.id,
    revision: document.revision,
    renderer,
    build: (selectionLabel: string, options?: PreviewFrameOptions) =>
      renderer.build(document, selectionLabel, options),
    update: (
      selectionLabel: string,
      current: Pick<SelectionPreview, 'nonce'>,
      options?: PreviewFrameOptions,
    ) => renderer.update(document, selectionLabel, current, options),
  });
}

const themeColor = v.exactOptional(
  v.pipe(
    v.string(),
    v.maxLength(THEME_COLOR_LENGTH),
    v.check((value) => isThemeColor(value)),
  ),
);
/** Only plain color values and a bounded radius ever reach the style of the controls. */
export const previewThemeSchema = v.strictObject({
  accent: themeColor,
  contrast: themeColor,
  surface: themeColor,
  text: themeColor,
  border: themeColor,
  radius: v.exactOptional(
    v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(THEME_RADIUS_LIMIT)),
  ),
});

/** The style of the selection outline; the runtime only supplies the accent color. */
const SELECTION_STYLE = `[${NODE_ATTRIBUTE}]:focus-visible,[${SELECTED_ATTRIBUTE}="true"]{outline:2px solid var(--visual-editor-accent,#0d9488);outline-offset:3px}[${NODE_ATTRIBUTE}]{cursor:pointer}[${EDIT_NODE_ATTRIBUTE}]{cursor:text}`;

/** The page is made of frames: it has no body to edit in the piece, only its source. */
export const PREVIEW_FRAMESET = 'PREVIEW_FRAMESET';

/** Normalizes optional DOM metadata; strict public options are validated separately. */
export function normalizePreviewLanguage(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 100) return undefined;
  try {
    return new Intl.Locale(candidate).toString();
  } catch {
    return undefined;
  }
}

const previewMetadataSchema = v.strictObject({
  title: v.exactOptional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))),
  lang: v.exactOptional(
    v.pipe(
      v.string(),
      v.trim(),
      v.minLength(1),
      v.maxLength(100),
      v.check((value) => normalizePreviewLanguage(value) !== undefined),
    ),
  ),
});

/** An opened frame document: the parsed tree and the parts the renderers mark. */
export interface OpenedPreview {
  readonly parsed: DefaultTreeAdapterMap['document'];
  readonly head: MarkupElement;
  readonly body: MarkupElement;
  readonly hostLanguage: string;
  readonly labels: CanvasBridgeLabels;
  readonly theme: CanvasBridgeTheme | undefined;
}

/**
 * The parts of an editing-frame document every renderer shares: the assembled copy with its
 * CSP, the language and title, the selection style and the single runtime script authorized by
 * the digest of its text. What marks the blocks is the renderer's own.
 */
export class PreviewFrameDocument {
  readonly #bridge = new CanvasBridgeScript();

  constructor(private readonly assembler: HtmlAssemblyPort) {}

  open(
    source: SourceInput,
    kind: DocumentKind,
    selectionLabel: string,
    options: PreviewFrameOptions,
  ): OpenedPreview {
    if (selectionLabel.length > 200) throw new Error('PREVIEW_LABEL_LIMIT');
    const metadata = v.parse(previewMetadataSchema, {
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.lang !== undefined ? { lang: options.lang } : {}),
    });
    const hostLanguage = normalizePreviewLanguage(metadata.lang) ?? 'und';
    const labels = options.labels ?? this.uniformLabels(selectionLabel);
    const theme = options.theme ? v.parse(previewThemeSchema, options.theme) : undefined;
    if (Object.values(labels).some((label) => typeof label !== 'string' || label.length > 200))
      throw new Error('PREVIEW_LABEL_LIMIT');
    const parsed = parse(this.assembler.build(source, kind, true));
    const { root, head, body, frameset } = documentParts(parsed);
    if (root && head && !body && frameset) throw new Error(PREVIEW_FRAMESET);
    if (!root || !head || !body) throw new Error('INVALID_PREVIEW_DOCUMENT');
    const existingLanguage = normalizePreviewLanguage(
      root.attrs.find((attribute) => attribute.name === 'lang')?.value,
    );
    root.attrs = root.attrs.filter((attribute) => attribute.name !== 'lang');
    root.attrs.push({ name: 'lang', value: existingLanguage ?? hostLanguage });
    const existingTitle = head.childNodes.find(
      (node): node is MarkupElement => 'tagName' in node && node.tagName === 'title',
    );
    const titleText = existingTitle?.childNodes
      .flatMap((node) => ('value' in node && node.nodeName === '#text' ? [node.value] : []))
      .join('')
      .trim();
    if (!titleText) {
      const title = existingTitle ?? defaultTreeAdapter.createElement('title', html.NS.HTML, []);
      title.childNodes = [];
      const fallbackTitle = metadata.title ?? selectionLabel.trim();
      if (!fallbackTitle) throw new Error('PREVIEW_TITLE_REQUIRED');
      defaultTreeAdapter.insertText(title, fallbackTitle);
      if (!existingTitle) defaultTreeAdapter.appendChild(head, title);
    }
    return { parsed, head, body, hostLanguage, labels, theme };
  }

  /** Adds the selection style and, for a new window, the runtime; serializes the result. */
  close(
    opened: OpenedPreview,
    preview: {
      readonly revision: number;
      readonly regions: readonly CanvasBridgeRegion[];
      readonly nodeIds: readonly string[];
      readonly token: string;
      readonly executable: boolean;
    },
    options: PreviewFrameOptions,
  ): SelectionPreview {
    const { parsed, head, body } = opened;
    const directive = head.childNodes.find(
      (node): node is MarkupElement =>
        'tagName' in node &&
        node.tagName === 'meta' &&
        node.attrs.some(
          (attribute) =>
            attribute.name === 'http-equiv' && attribute.value === 'Content-Security-Policy',
        ),
    );
    const csp = directive?.attrs.find((attribute) => attribute.name === 'content');
    if (!csp) throw new Error('MISSING_PREVIEW_CSP');
    const style = defaultTreeAdapter.createElement('style', html.NS.HTML, []);
    defaultTreeAdapter.insertText(style, SELECTION_STYLE);
    defaultTreeAdapter.appendChild(head, style);
    // The one script is authorized by the digest of its exact text. A nonce in the policy would
    // sit in an attribute, which a style sheet of the document can read out character by
    // character; the secret of the protocol exists only inside the text of the script.
    let scriptSource = "'none'";
    if (preview.executable) {
      const names = previewVariables(options.variables);
      const variables = names ? { variables: names } : {};
      const code = this.#bridge.source({
        nonce: preview.token,
        revision: preview.revision,
        regions: preview.regions,
        readOnly: options.readOnly ?? false,
        labels: opened.labels,
        ...(opened.theme ? { theme: opened.theme } : {}),
        lang: opened.hostLanguage,
        fonts: TEXT_FONT_FAMILIES,
        ...(options.diagnostics ? { diagnostics: true } : {}),
        ...(options.menu === false ? { menu: false as const } : {}),
        ...variables,
      });
      const bridge = defaultTreeAdapter.createElement('script', html.NS.HTML, []);
      defaultTreeAdapter.insertText(bridge, code);
      defaultTreeAdapter.appendChild(body, bridge);
      scriptSource = `'sha256-${sha256Base64(code)}'`;
    }
    csp.value += `; script-src ${scriptSource}`;
    const output = serialize(parsed);
    if (new TextEncoder().encode(output).length > 8_000_000)
      throw new Error('PREVIEW_OUTPUT_LIMIT');
    return Object.freeze({
      html: output,
      nonce: preview.token,
      revision: preview.revision,
      nodeIds: Object.freeze([...preview.nodeIds]),
      regions: Object.freeze([...preview.regions]),
      readOnly: options.readOnly ?? false,
      diagnostics: options.diagnostics ?? false,
    });
  }

  private uniformLabels(selectionLabel: string): CanvasBridgeLabels {
    return Object.freeze({
      edit: selectionLabel,
      move: selectionLabel,
      up: selectionLabel,
      down: selectionLabel,
      duplicate: selectionLabel,
      remove: selectionLabel,
      before: selectionLabel,
      after: selectionLabel,
      inside: selectionLabel,
      parent: selectionLabel,
      html: selectionLabel,
      image: selectionLabel,
      add: selectionLabel,
      resize: selectionLabel,
      resizeHint: selectionLabel,
      replace: selectionLabel,
      embed: selectionLabel,
    });
  }
}
