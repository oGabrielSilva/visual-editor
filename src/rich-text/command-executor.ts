import type { Editor } from '@tiptap/core';
import type { Mark as ProseMirrorMark } from '@tiptap/pm/model';
import {
  RICH_TEXT_LIMITS,
  RICH_TEXT_STYLES,
  RICH_TEXT_TOGGLES,
  emptyRichTextState,
} from './commands';
import type {
  RichTextCommandName,
  RichTextCommandState,
  RichTextStyleName,
  RichTextStyleState,
  RichTextToggleName,
} from './commands';
import { RichTextFormatting } from './formatting';

export interface RichTextRange {
  readonly from: number;
  readonly to: number;
}

/** Resolves the value a text run shows when the person gave it no style of their own. */
export type RichTextInheritedStyle = (
  marks: readonly ProseMirrorMark[],
  position: number,
) => Partial<Record<RichTextStyleName, string>>;

/** Applies the closed command vocabulary to an editor; values are validated by the caller. */
export class RichTextCommandExecutor {
  /**
   * @param focus Whether a command also takes the keyboard. The editor inside the preview
   * frame never does: its commands come from controls which must keep the focus they have.
   */
  constructor(
    private readonly formatting = new RichTextFormatting(),
    private readonly focus = true,
  ) {}

  run(
    editor: Editor,
    command: RichTextCommandName,
    value: string | null = null,
    range?: RichTextRange,
  ): boolean {
    if (editor.isDestroyed || !editor.isEditable) return false;
    const styled = () => {
      const chain = editor.chain();
      return range ? chain.setTextSelection(this.clamp(editor, range)) : chain;
    };
    const focused = () =>
      this.focus ? editor.chain().focus(undefined, { scrollIntoView: false }) : editor.chain();
    switch (command) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
        return this.formatting.toggle(editor, command, this.focus);
      case 'superscript':
      case 'subscript':
        return focused().toggleMark(command).run();
      case 'bulletList':
        return !!editor.schema.nodes.bulletList && focused().toggleBulletList().run();
      case 'orderedList':
        return !!editor.schema.nodes.orderedList && focused().toggleOrderedList().run();
      case 'color':
        return value === null ? styled().unsetColor().run() : styled().setColor(value).run();
      case 'backgroundColor':
        return value === null
          ? styled().unsetBackgroundColor().run()
          : styled().setBackgroundColor(value).run();
      case 'fontFamily':
        return value === null
          ? styled().unsetFontFamily().run()
          : styled().setFontFamily(value).run();
      case 'fontSize':
        return value === null ? styled().unsetFontSize().run() : styled().setFontSize(value).run();
      case 'lineHeight':
        return value === null
          ? styled().unsetLineHeight().run()
          : styled().setLineHeight(value).run();
      case 'clearFormatting': {
        for (const format of ['bold', 'italic', 'underline', 'strike'] as const)
          if (editor.isActive(format)) this.formatting.toggle(editor, format, this.focus);
        return focused()
          .unsetMark('textStyle')
          .unsetMark('superscript')
          .unsetMark('subscript')
          .run();
      }
      case 'setLink':
        return (
          !!editor.schema.marks.link &&
          value !== null &&
          focused()
            .extendMarkRange('link')
            .setLink({ href: value })
            .command(({ tr }) => this.formatting.restore(tr, 'link'))
            .run()
        );
      case 'unsetLink':
        return !!editor.schema.marks.link && this.formatting.removeLink(editor, this.focus);
      case 'insertText': {
        if (!value || value.length > RICH_TEXT_LIMITS.insertedText) return false;
        const target = this.clamp(editor, range ?? editor.state.selection);
        return focused().insertContentAt(target, { type: 'text', text: value }).run();
      }
      case 'undo':
        return editor.commands.undo();
      case 'redo':
        return editor.commands.redo();
      case 'finish':
      case 'cancel':
        return false;
    }
  }

  private clamp(editor: Editor, range: RichTextRange): RichTextRange {
    const start = editor.state.doc.type.inlineContent ? 0 : 1;
    const maximum = Math.max(start, editor.state.doc.content.size - start);
    const from = Math.min(Math.max(start, range.from), maximum);
    return { from, to: Math.min(Math.max(from, range.to), maximum) };
  }
}

/** Reads what the controls show: active formats, the styles of the selection and history. */
export class RichTextStateReader {
  read(
    editor: Editor,
    ready: boolean,
    normalize: (style: RichTextStyleName, value: string) => string = (_style, value) => value,
    inherited: RichTextInheritedStyle = () => ({}),
  ): RichTextCommandState {
    if (editor.isDestroyed) return emptyRichTextState();
    const { from, to, empty } = editor.state.selection;
    const runs: { marks: readonly ProseMirrorMark[]; position: number }[] = [];
    if (empty)
      runs.push({
        marks: editor.state.storedMarks ?? editor.state.selection.$from.marks(),
        position: from,
      });
    else
      editor.state.doc.nodesBetween(from, to, (node, position) => {
        if (node.isText && runs.length < 200)
          runs.push({ marks: node.marks, position: Math.max(from, position) });
      });
    const styles = emptyRichTextState().styles as Record<RichTextStyleName, RichTextStyleState>;
    for (const style of RICH_TEXT_STYLES) {
      const values = runs.map((run) => {
        const explicit: unknown = run.marks.find((mark) => mark.type.name === 'textStyle')?.attrs[
          style
        ];
        if (typeof explicit === 'string' && explicit)
          return { value: normalize(style, explicit), own: true };
        const fallback = inherited(run.marks, run.position)[style];
        return { value: fallback ? normalize(style, fallback) : '', own: false };
      });
      const mixed = new Set(values.map((entry) => entry.value)).size > 1;
      styles[style] = {
        value: mixed ? '' : (values[0]?.value ?? '').slice(0, RICH_TEXT_LIMITS.styleValue),
        own: values.some((entry) => entry.own),
        mixed,
      };
    }
    const marks: RichTextToggleName[] = RICH_TEXT_TOGGLES.filter(
      (name) =>
        (!!editor.schema.marks[name] || !!editor.schema.nodes[name]) && editor.isActive(name),
    );
    const link = !!editor.schema.marks.link && editor.isActive('link');
    const href: unknown = link ? editor.getAttributes('link').href : '';
    return {
      ready,
      marks,
      styles,
      link,
      href: typeof href === 'string' ? href.slice(0, RICH_TEXT_LIMITS.commandValue) : '',
      empty: editor.isEmpty,
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    };
  }
}
