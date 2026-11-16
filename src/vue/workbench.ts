import { computed, inject, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue';
import type { EditorDocumentData, SourceInput } from '../core/document';
import type { SelectionPreviewRenderer } from '../renderers/selection-preview';
import type { CanvasTextStyle } from '../security/text-presentation';
import type { EditorController, EditorViewState } from './controller';
import { EditorLocale } from './locale';
import type { EditorMessages } from './locale';
import { BlockCommandService } from './services/block-commands';
import { ImageRequestService } from './services/image-requests';
import type { EditorImagePicker } from './services/image-requests';
import { LiveChangeGroup } from './services/live-change';
import { PropertyCommandService } from './services/property-commands';
import { ShortcutService } from './services/shortcuts';
import { TemplateApplication } from './services/template-application';
import type { EditorVariable } from './variables';

/** What the editing area offers to the rest of the shell while it is mounted. */
export interface CanvasApi {
  flush(): Promise<boolean>;
  cancel(): void;
  edit(id: string): void;
  editingId(): string | undefined;
  /** A drag from the palette or of a file is in course. */
  gesture(): boolean;
  canHistory(direction: 'undo' | 'redo'): boolean;
  history(direction: 'undo' | 'redo'): boolean;
  insertText(value: string): boolean;
  hover(id: string | undefined): void;
  startPalette(type: string, event: PointerEvent): void;
  paletteDragged(): boolean;
}

/** The second text editor, in the properties panel, shares history and variables with the shell. */
export interface PanelTextApi {
  canHistory(direction: 'undo' | 'redo'): boolean;
  history(direction: 'undo' | 'redo'): boolean;
  insertText(value: string): boolean;
}

export interface EffectiveText {
  readonly documentId: string;
  readonly revision: number;
  readonly targetId: string;
  readonly style: CanvasTextStyle;
}

export type PreviewWidth = 'desktop' | 'tablet' | 'mobile';

export interface WorkbenchOptions {
  controller(): EditorController;
  renderer(): SelectionPreviewRenderer | undefined;
  messages(): EditorMessages | undefined;
  variables(): readonly EditorVariable[];
  imagePicker(): EditorImagePicker | undefined;
  /** The older image contract, when the host enabled it. */
  requestImage(): ((nodeId: string | undefined) => void) | undefined;
  saved(payload: { document: EditorDocumentData; source: SourceInput }): void;
  failed(code: string): void;
}

/**
 * Everything one mounted editor shares between its components: the state of its session and the
 * services which act on it. One per editor; nothing here is global.
 */
export interface EditorWorkbench {
  readonly state: ShallowRef<EditorViewState>;
  readonly locale: ComputedRef<EditorLocale>;
  readonly feedback: Ref<string>;
  readonly busy: Ref<boolean>;
  /** A save in flight: only the save button waits for it; editing goes on meanwhile. */
  readonly saving: Ref<boolean>;
  readonly width: Ref<PreviewWidth>;
  readonly canvas: ShallowRef<CanvasApi | undefined>;
  readonly panelText: ShallowRef<PanelTextApi | undefined>;
  readonly inlineEditingId: Ref<string | undefined>;
  readonly effectiveText: ShallowRef<EffectiveText | undefined>;
  readonly commands: BlockCommandService;
  readonly properties: PropertyCommandService;
  readonly images: ImageRequestService;
  readonly shortcuts: ShortcutService;
  readonly live: LiveChangeGroup;
  readonly templates: TemplateApplication;
  controller(): EditorController;
  renderer(): SelectionPreviewRenderer | undefined;
  variables(): readonly EditorVariable[];
  t(key: string): string;
  /** Concludes a text being edited in the piece before anything else acts on the document. */
  flush(): Promise<boolean>;
  act(action: () => boolean | void | Promise<boolean | void>, success?: string): Promise<void>;
  prepare(action: () => Promise<boolean>): Promise<void>;
  select(id: string): Promise<void>;
  history(direction: 'undo' | 'redo'): void;
  /** A step of the document itself, when the text being edited has none of its own left. */
  documentHistory(direction: 'undo' | 'redo', success?: string): void;
  canHistory(direction: 'undo' | 'redo'): boolean;
  setMode(mode: 'visual' | 'html'): Promise<void>;
  save(): Promise<void>;
  insertVariable(key: string): boolean;
  report(code: string): void;
  dispose(): void;
}

const WORKBENCH: InjectionKey<EditorWorkbench> = Symbol('visual-editor-workbench');

export { WORKBENCH };

export function useWorkbench(): EditorWorkbench {
  const workbench = inject(WORKBENCH);
  if (!workbench) throw new Error('EDITOR_WORKBENCH_MISSING');
  return workbench;
}

const KNOWN_FAILURES = ['feedback.largeFile', 'feedback.invalid'];

export function createWorkbench(options: WorkbenchOptions): EditorWorkbench {
  const state = shallowRef(options.controller().state());
  const locale = computed(() => new EditorLocale(options.messages()));
  const feedback = ref('');
  const busy = ref(false);
  const saving = ref(false);
  const width = ref<PreviewWidth>('desktop');
  const canvas = shallowRef<CanvasApi>();
  const panelText = shallowRef<PanelTextApi>();
  const inlineEditingId = ref<string>();
  const effectiveText = shallowRef<EffectiveText>();
  const t = (key: string): string => locale.value.text(key);
  const flush = async (): Promise<boolean> => !canvas.value || (await canvas.value.flush());
  const report = (code: string): void => {
    feedback.value = t(code);
    options.failed(code);
  };
  const notify = (outcome: 'applied' | 'copied' | 'invalid'): void => {
    if (outcome === 'invalid') report('feedback.invalid');
    else feedback.value = t(outcome === 'copied' ? 'feedback.copied' : 'feedback.applied');
  };

  const act: EditorWorkbench['act'] = async (action, success) => {
    const owner = options.controller();
    try {
      if (!(await flush()) || options.controller() !== owner) return;
      const result = await action();
      if (options.controller() !== owner) return;
      feedback.value = result === false ? t('feedback.invalid') : success ? t(success) : '';
    } catch (error: unknown) {
      if (options.controller() !== owner) return;
      report(
        error instanceof Error && KNOWN_FAILURES.includes(error.message)
          ? error.message
          : 'feedback.unknown',
      );
    }
  };
  const prepare: EditorWorkbench['prepare'] = async (action) => {
    if (busy.value || state.value.readOnly) return;
    const owner = options.controller();
    busy.value = true;
    await act(action, 'feedback.applied');
    if (options.controller() === owner) busy.value = false;
  };

  const images = new ImageRequestService({
    controller: options.controller,
    picker: options.imagePicker,
    legacyRequest: options.requestImage,
    flush,
    notify,
    replaceElementSource: (id, html) =>
      options.renderer()?.replaceElementSource(state.value.document, id, html),
  });
  const commands = new BlockCommandService({
    controller: options.controller,
    flush,
    editText: (id) => canvas.value?.edit(id),
    replaceImage: (id) => void images.choose(id),
    elementSource: (id) => options.renderer()?.elementSource(state.value.document, id),
    replaceElementSource: (id, html) =>
      options.renderer()?.replaceElementSource(state.value.document, id, html),
    notify,
  });
  const live = new LiveChangeGroup(options.controller);
  const properties = new PropertyCommandService(options.controller);

  const canHistory = (direction: 'undo' | 'redo'): boolean =>
    !state.value.readOnly &&
    ((direction === 'undo' ? state.value.canUndo : state.value.canRedo) ||
      !!canvas.value?.canHistory(direction) ||
      !!panelText.value?.canHistory(direction));
  const documentHistory = (direction: 'undo' | 'redo', success?: string): void => {
    if (state.value.readOnly) return;
    live.close();
    void act(
      () => (direction === 'undo' ? options.controller().undo() : options.controller().redo()),
      success,
    );
  };
  const history = (direction: 'undo' | 'redo'): void => {
    if (state.value.readOnly) return;
    live.close();
    // The text being edited has its own steps; they come before the steps of the document.
    if (canvas.value?.history(direction) || panelText.value?.history(direction)) return;
    documentHistory(direction);
  };
  const save = async (): Promise<void> => {
    if (saving.value || busy.value || state.value.readOnly) return;
    const owner = options.controller();
    saving.value = true;
    try {
      await act(async () => {
        const persistence = owner.session.save();
        const persisted = {
          document: owner.session.snapshot(),
          source: owner.session.exportSource(),
        };
        const saved = await persistence;
        if (options.controller() !== owner) return false;
        if (saved) options.saved(persisted);
        else options.failed('feedback.invalid');
        return saved;
      }, 'feedback.saved');
    } finally {
      if (options.controller() === owner) saving.value = false;
    }
  };
  const shortcuts = new ShortcutService({
    readOnly: () => state.value.readOnly,
    mode: () => state.value.mode,
    busy: () => !!inlineEditingId.value || !!canvas.value?.gesture(),
    hasSelection: () => !!state.value.selectedNodeId,
    history,
    save: () => void save(),
    unsaved: () => state.value.dirty || !!inlineEditingId.value,
    block: (command) => void commands.run(command),
    insert: () => {
      const id = state.value.selectedNodeId;
      // The keyboard returns where it was when the picker closes.
      const origin = globalThis.document?.activeElement;
      if (id)
        commands.requestInsertion({
          targetId: id,
          placement: 'after',
          keyboard: true,
          // After the picker closes and its primitive puts the keyboard on its own trigger.
          returnFocus: () =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const active = globalThis.document?.activeElement;
                const free =
                  !active ||
                  active === globalThis.document.body ||
                  active.classList.contains('editor-menu-anchor') ||
                  !!active.closest('[role="menu"]');
                if (free && origin instanceof HTMLElement && origin.isConnected)
                  origin.focus({ preventScroll: true });
              }),
            ),
        });
    },
  });

  const templates = new TemplateApplication({
    controller: options.controller,
    prepare,
    invalid: () => {
      feedback.value = t('feedback.invalid');
    },
  });

  let unsubscribe: (() => void) | undefined;
  const subscribe = (controller: EditorController): void => {
    unsubscribe?.();
    state.value = controller.state();
    unsubscribe = controller.subscribe((value) => {
      state.value = value;
    });
  };
  subscribe(options.controller());
  const stopOwner = watch(
    options.controller,
    (controller) => {
      inlineEditingId.value = undefined;
      effectiveText.value = undefined;
      feedback.value = '';
      busy.value = false;
      saving.value = false;
      commands.invalidate();
      images.cancel();
      templates.close();
      live.close();
      subscribe(controller);
    },
    { flush: 'sync' },
  );
  // A question asked about one revision is not answered against another.
  const stopRevision = watch(
    [
      () => state.value.document.id,
      () => state.value.document.revision,
      () => state.value.readOnly,
    ],
    () => {
      commands.cancelRemoval();
      if (state.value.readOnly) commands.invalidate();
    },
  );

  return {
    state,
    locale,
    feedback,
    busy,
    saving,
    width,
    canvas,
    panelText,
    inlineEditingId,
    effectiveText,
    commands,
    properties,
    images,
    shortcuts,
    live,
    templates,
    controller: options.controller,
    renderer: options.renderer,
    variables: options.variables,
    t,
    flush,
    act,
    prepare,
    report,
    canHistory,
    history,
    documentHistory,
    save,
    select: async (id) => {
      const owner = options.controller();
      if (!(await flush()) || options.controller() !== owner) return;
      owner.select(id);
    },
    setMode: (mode) => act(() => options.controller().setMode(mode)),
    insertVariable: (key) => {
      if (
        state.value.readOnly ||
        !/^[a-zA-Z0-9._]{1,200}$/.test(key) ||
        !options.variables().some((variable) => variable.key === key && variable.purpose === 'text')
      )
        return false;
      const token = `{{${key}}}`;
      return canvas.value?.insertText(token) || panelText.value?.insertText(token) || false;
    },
    dispose: () => {
      stopOwner();
      stopRevision();
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
