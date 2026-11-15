/**
 * What the host, the renderers, the message policy and the runtime of the frame agree on about the
 * piece on screen. It has no DOM and no dependency, so every side imports the same definition.
 */

/** Every attribute the editor adds to the copy shown in the frame starts with this. */
export const RESERVED_ATTRIBUTE_PREFIX = 'data-visual-editor-';
/** Marks a selectable block with the id of its node. */
export const NODE_ATTRIBUTE = 'data-visual-editor-node';
/** Marks an element of an editable text which keeps attributes of its own. */
export const TEXT_ORIGIN_ATTRIBUTE = 'data-visual-editor-text-origin';
/** Marks the element whose text may be edited in place. */
export const EDIT_NODE_ATTRIBUTE = 'data-visual-editor-edit-node';
/** Set by the runtime on the selected block. */
export const SELECTED_ATTRIBUTE = 'data-visual-editor-selected';
/** Set by the runtime on its own layer of controls. */
export const CONTROLS_ATTRIBUTE = 'data-visual-editor-controls';

export function isReservedAttribute(name: string): boolean {
  return name.toLowerCase().startsWith(RESERVED_ATTRIBUTE_PREFIX);
}

/** What the action bar, the context menu and the keyboard may ask about one block. */
export const CANVAS_BLOCK_ACTIONS = ['duplicate', 'remove', 'up', 'down', 'html', 'image'] as const;

export type CanvasBlockAction = (typeof CANVAS_BLOCK_ACTIONS)[number];

/** Widest image a resize gesture may ask for, in CSS pixels. */
export const CANVAS_IMAGE_WIDTH_LIMIT = 4_000;

/** Longest color value of the host theme which may reach the style of the controls. */
export const THEME_COLOR_LENGTH = 80;
const THEME_COLOR = /^[a-z0-9#(),.%/ -]+$/i;

/** A plain CSS color value: no url, no quotes, no semicolon, nothing which could end a rule. */
export function isThemeColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= THEME_COLOR_LENGTH &&
    THEME_COLOR.test(value)
  );
}

/** Largest corner radius of the controls, in pixels. */
export const THEME_RADIUS_LIMIT = 24;

/** Elements which exist in every document and are never a block of the piece. */
const INFRASTRUCTURE: ReadonlySet<string> = new Set([
  'html',
  'head',
  'body',
  'style',
  'meta',
  'title',
]);

export function isInfrastructureTag(tag: string): boolean {
  return INFRASTRUCTURE.has(tag.toLowerCase());
}
