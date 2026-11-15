import * as v from 'valibot';
import type { SelectionPreview } from '../renderers/selection-preview';
import { DocumentBudget } from '../core/budget';
import { TextPresentationStyleSchema } from './text-presentation';
import { RICH_TEXT_LIMITS, RICH_TEXT_TOGGLES } from '../rich-text/commands';
import { CANVAS_BLOCK_ACTIONS, CANVAS_IMAGE_WIDTH_LIMIT } from '../core/canvas-contract';

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
const revision = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(Number.MAX_SAFE_INTEGER),
);
const sequence = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(Number.MAX_SAFE_INTEGER),
);
const coordinate = v.pipe(v.number(), v.finite(), v.minValue(-100_000), v.maxValue(100_000));
const dimension = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100_000));
const scroll = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1_000_000));
const boundsSchema = v.strictObject({
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
});
const viewportSchema = v.strictObject({ x: scroll, y: scroll });
const imageDimension = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(CANVAS_IMAGE_WIDTH_LIMIT),
);
// The projection is text for the session to parse; it is never rendered by the host.
/** One block of text is far smaller than a document; refused before any costly validation. */
export const TEXT_PROJECTION_BYTES = 262_144;
const projection = v.pipe(v.string(), v.maxLength(TEXT_PROJECTION_BYTES));
const styleState = v.strictObject({
  value: v.pipe(v.string(), v.maxLength(RICH_TEXT_LIMITS.styleValue)),
  own: v.boolean(),
  mixed: v.boolean(),
});
const textStateSchema = v.strictObject({
  marks: v.pipe(v.array(v.picklist(RICH_TEXT_TOGGLES)), v.maxLength(RICH_TEXT_TOGGLES.length)),
  styles: v.strictObject({
    color: styleState,
    backgroundColor: styleState,
    fontFamily: styleState,
    fontSize: styleState,
    lineHeight: styleState,
  }),
  link: v.boolean(),
  href: v.pipe(v.string(), v.maxLength(RICH_TEXT_LIMITS.commandValue)),
  empty: v.boolean(),
  canUndo: v.boolean(),
  canRedo: v.boolean(),
  rect: boundsSchema,
});
const base = { nonce: v.pipe(v.string(), v.minLength(1), v.maxLength(100)), revision };
const intent = { ...base, sequence };
const placement = v.picklist(['before', 'after', 'inside']);
const selectionSchema = v.strictObject({
  type: v.literal('selection'),
  ...base,
  nodeId: identifier,
});
const canvasSchema = v.variant('type', [
  // `challenge` answers the question the host asks after each load of the frame.
  v.strictObject({
    type: v.literal('ready'),
    ...intent,
    challenge: v.exactOptional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{16,64}$/))),
  }),
  v.strictObject({ type: v.literal('viewport'), ...intent, viewport: viewportSchema }),
  v.strictObject({ type: v.literal('viewport-restored'), ...intent, viewport: viewportSchema }),
  v.strictObject({
    type: v.literal('geometry'),
    ...intent,
    nodeId: identifier,
    bounds: boundsSchema,
    viewport: viewportSchema,
  }),
  v.strictObject({ type: v.literal('morph-failed'), ...intent }),
  v.strictObject({
    type: v.literal('appearance'),
    ...intent,
    nodeId: identifier,
    style: TextPresentationStyleSchema,
  }),
  v.strictObject({ type: v.literal('text-unsupported'), ...intent, nodeId: identifier }),
  v.strictObject({ type: v.literal('text-toolbar'), ...intent, nodeId: identifier }),
  v.strictObject({ type: v.literal('text-begin'), ...intent, nodeId: identifier }),
  v.strictObject({
    type: v.literal('text-draft'),
    ...intent,
    nodeId: identifier,
    html: projection,
  }),
  v.strictObject({
    type: v.literal('text-commit'),
    ...intent,
    nodeId: identifier,
    html: projection,
  }),
  v.strictObject({ type: v.literal('text-cancel'), ...intent, nodeId: identifier }),
  v.strictObject({
    type: v.literal('text-state'),
    ...intent,
    nodeId: identifier,
    ...textStateSchema.entries,
  }),
  v.strictObject({
    type: v.literal('history'),
    ...intent,
    direction: v.picklist(['undo', 'redo']),
  }),
  v.strictObject({
    type: v.literal('text-fidelity'),
    ...intent,
    changed: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000)),
  }),
  v.strictObject({
    type: v.literal('move'),
    ...intent,
    sourceId: identifier,
    targetId: identifier,
    placement,
  }),
  v.strictObject({
    type: v.literal('action'),
    ...intent,
    nodeId: identifier,
    action: v.picklist(CANVAS_BLOCK_ACTIONS),
  }),
  v.strictObject({ type: v.literal('insertion'), ...intent, targetId: identifier, placement }),
  // A block dropped on a piece which has no block yet: the host appends it to the content.
  v.strictObject({ type: v.literal('insertion-end'), ...intent }),
  // The "+" of a block: the host opens its block picker next to these bounds.
  v.strictObject({
    type: v.literal('insert-request'),
    ...intent,
    nodeId: identifier,
    bounds: boundsSchema,
    // Asked with Alt + Enter: the keyboard returns to the piece when the picker closes.
    keyboard: v.exactOptional(v.literal(true)),
  }),
  // The secondary button on a block: the host opens its own menu at this point of the frame.
  v.strictObject({
    type: v.literal('context-menu'),
    ...intent,
    nodeId: identifier,
    x: dimension,
    y: dimension,
    // Asked with the menu key or Shift + F10: the host gives the keyboard to the first item.
    keyboard: v.exactOptional(v.literal(true)),
  }),
  // A file dragged from the system straight over the frame: no data, the host raises its layer.
  v.strictObject({ type: v.literal('file-drag'), ...intent }),
  // An image file dropped over an image of the piece: the host replaces that image with it.
  v.strictObject({ type: v.literal('image-drop'), ...intent, nodeId: identifier }),
  // A shortcut of the shell pressed while the frame holds the keyboard.
  v.strictObject({ type: v.literal('shortcut'), ...intent, command: v.picklist(['save']) }),
  v.strictObject({
    type: v.literal('image-resize'),
    ...intent,
    nodeId: identifier,
    width: imageDimension,
    height: imageDimension,
  }),
]);

export type CanvasBounds = v.InferOutput<typeof boundsSchema>;
export type CanvasViewport = v.InferOutput<typeof viewportSchema>;
export type CanvasEvent = v.InferOutput<typeof canvasSchema>;
export type CanvasTextState = v.InferOutput<typeof textStateSchema>;

type MessageClass = 'telemetry' | 'control' | 'intent' | 'mutation' | 'draft' | 'shortcut';

/** What the host knows and the frame cannot be trusted to say. */
export interface PreviewHostState {
  /** The block selected in the host; a block is only changed from the piece while selected. */
  readonly selectedNodeId?: string | undefined;
  /** The block selected before it, for a second at most after the selection moved. */
  readonly recentNodeId?: string | undefined;
}

/**
 * Messages accepted per second, by class. Measurements repeat every frame and may be dropped;
 * they never spend the allowance of handshakes or of what the person asked for. Mutations are
 * intents too and keep their own lower ceiling.
 */
export const PREVIEW_MESSAGE_BUDGETS: Readonly<Record<MessageClass, number>> = Object.freeze({
  telemetry: 600,
  control: 60,
  intent: 120,
  mutation: 30,
  // Typing: the frame coalesces drafts to twenty a second.
  draft: 25,
  // Saving reaches the store of the host: a key held down is one request, not a flood.
  shortcut: 1,
});

/** Authenticates the bridge and accepts only bounded intents against the current capabilities. */
export class PreviewMessagePolicy {
  #nonce: string | undefined;
  #sequence = 0;
  #text: string | undefined;
  #windowStart = 0;
  #spent: Record<MessageClass, number> = PreviewMessagePolicy.unspent();
  private readonly budget = new DocumentBudget();

  constructor(private readonly clock: () => number = () => performance.now()) {}

  private static unspent(): Record<MessageClass, number> {
    return { telemetry: 0, control: 0, intent: 0, mutation: 0, draft: 0, shortcut: 0 };
  }

  private withinBudget(kind: MessageClass): boolean {
    const now = this.clock();
    if (!Number.isFinite(now)) return false;
    if (now < this.#windowStart || now - this.#windowStart >= 1_000) {
      this.#windowStart = now;
      this.#spent = PreviewMessagePolicy.unspent();
    }
    const classes: readonly MessageClass[] = kind === 'mutation' ? ['intent', 'mutation'] : [kind];
    if (classes.some((entry) => this.#spent[entry] >= PREVIEW_MESSAGE_BUDGETS[entry])) return false;
    for (const entry of classes) this.#spent[entry] += 1;
    return true;
  }

  private classify(type: CanvasEvent['type']): MessageClass {
    if (
      type === 'geometry' ||
      type === 'viewport' ||
      type === 'text-state' ||
      type === 'text-fidelity' ||
      type === 'appearance'
    )
      return 'telemetry';
    if (type === 'text-draft') return 'draft';
    if (type === 'ready' || type === 'viewport-restored' || type === 'morph-failed')
      return 'control';
    // A draft or the start and end of an edition change no revision: they are plain intents.
    if (
      type === 'text-begin' ||
      type === 'text-cancel' ||
      type === 'text-unsupported' ||
      type === 'text-toolbar' ||
      type === 'insert-request' ||
      type === 'context-menu' ||
      type === 'file-drag'
    )
      return 'intent';
    if (type === 'shortcut') return 'shortcut';
    return 'mutation';
  }

  selection(
    data: unknown,
    source: unknown,
    expectedSource: unknown,
    preview: SelectionPreview,
  ): string | undefined {
    if (!expectedSource || source !== expectedSource) return undefined;
    const result = v.safeParse(selectionSchema, data);
    if (
      !result.success ||
      result.output.nonce !== preview.nonce ||
      result.output.revision !== preview.revision ||
      !preview.nodeIds.includes(result.output.nodeId)
    )
      return undefined;
    return this.withinBudget('intent') ? result.output.nodeId : undefined;
  }

  canvas(
    data: unknown,
    source: unknown,
    expectedSource: unknown,
    preview: SelectionPreview,
    host: PreviewHostState = {},
  ): CanvasEvent | undefined {
    if (!expectedSource || source !== expectedSource) return undefined;
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 16)
      return undefined;
    const result = v.safeParse(canvasSchema, data);
    if (!result.success) return undefined;
    const event = result.output;
    if (event.nonce !== preview.nonce || event.revision !== preview.revision) return undefined;
    if (this.#nonce !== preview.nonce) {
      this.#nonce = preview.nonce;
      this.#sequence = 0;
      this.#text = undefined;
    }
    if (event.sequence <= this.#sequence || event.sequence - this.#sequence > 10_000)
      return undefined;
    const region = (id: string) => preview.regions.find((candidate) => candidate.id === id);
    switch (event.type) {
      case 'ready':
      case 'viewport':
      case 'viewport-restored':
      case 'morph-failed':
        break;
      case 'geometry':
      case 'appearance':
        if (!region(event.nodeId)) return undefined;
        break;
      case 'text-begin':
      case 'text-cancel':
      case 'text-unsupported':
        if (preview.readOnly || !region(event.nodeId)?.editable) return undefined;
        break;
      case 'text-state':
      case 'text-toolbar':
        if (preview.readOnly || this.#text !== event.nodeId) return undefined;
        break;
      case 'text-draft':
      case 'text-commit':
        // Only the transaction opened by text-begin for this very node may carry its text.
        if (
          preview.readOnly ||
          this.#text !== event.nodeId ||
          !region(event.nodeId)?.editable ||
          this.budget.byteLength(event.html) > TEXT_PROJECTION_BYTES
        )
          return undefined;
        break;
      case 'history':
        if (preview.readOnly) return undefined;
        break;
      case 'text-fidelity':
        if (preview.readOnly || !preview.diagnostics) return undefined;
        break;
      case 'action':
        // Every action changes the block or opens a change to it: only the selected one.
        if (
          preview.readOnly ||
          event.nodeId !== host.selectedNodeId ||
          !region(event.nodeId) ||
          (event.action === 'image' && region(event.nodeId)?.media !== 'image')
        )
          return undefined;
        break;
      case 'insert-request':
      case 'context-menu':
        // Only for the block the host has selected: the frame selects it first.
        if (preview.readOnly || !region(event.nodeId) || event.nodeId !== host.selectedNodeId)
          return undefined;
        break;
      case 'file-drag':
        break;
      case 'image-drop':
        if (preview.readOnly || region(event.nodeId)?.media !== 'image') return undefined;
        break;
      case 'image-resize':
        // The block selected, or the one selected a moment ago: a size the keys left is sent
        // when the selection moves away from the image.
        if (
          preview.readOnly ||
          (event.nodeId !== host.selectedNodeId && event.nodeId !== host.recentNodeId) ||
          region(event.nodeId)?.media !== 'image'
        )
          return undefined;
        break;
      case 'shortcut':
      case 'insertion-end':
        if (preview.readOnly) return undefined;
        break;
      case 'move':
        if (
          preview.readOnly ||
          event.sourceId === event.targetId ||
          !region(event.sourceId) ||
          !region(event.targetId) ||
          (event.placement === 'inside' && !region(event.targetId)?.container)
        )
          return undefined;
        break;
      case 'insertion':
        if (
          preview.readOnly ||
          !region(event.targetId) ||
          (event.placement === 'inside' && !region(event.targetId)?.container)
        )
          return undefined;
        break;
    }
    if (!this.withinBudget(this.classify(event.type))) return undefined;
    this.#sequence = event.sequence;
    if (event.type === 'text-begin') this.#text = event.nodeId;
    else if (event.type === 'text-commit' || event.type === 'text-cancel') this.#text = undefined;
    return event;
  }
}
