import { computed, inject, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue';
import type { BlockDocumentData } from '../core/block-document';
import type { BlockEditorState } from '../application/block-session';
import type { BlockEditorController } from './block-controller';
import { EditorLocale } from './locale';
import type { EditorMessages } from './locale';
import type { EditorImagePicker } from './services/image-requests';
import type { PreviewWidth } from './workbench';
import type { BlockCheck } from '../blocks/block-checks';
import { SAVED_BLOCK_LIMITS, acceptedSavedBlocks } from './services/saved-blocks';
import type { EditorSavedBlock, EditorSavedBlocks } from './services/saved-blocks';

/** What the editing area of a block piece offers while it is mounted. */
export interface BlockCanvasApi {
  /** Concludes the text being edited in the piece; false when it was refused. */
  flush(): Promise<boolean>;
  edit(id: string): void;
  canHistory(direction: 'undo' | 'redo'): boolean;
  history(direction: 'undo' | 'redo'): boolean;
  insertText(value: string): boolean;
}

export interface BlockWorkbenchOptions {
  controller(): BlockEditorController;
  messages(): EditorMessages | undefined;
  imagePicker(): EditorImagePicker | undefined;
  /** The library of saved blocks of the host; optional. */
  savedBlocks?(): EditorSavedBlocks | undefined;
  saved(document: BlockDocumentData): void;
  failed(code: string): void;
}

/** Everything the components of one mounted block editor share; nothing here is global. */
export interface BlockWorkbench {
  readonly state: ShallowRef<BlockEditorState>;
  readonly locale: ComputedRef<EditorLocale>;
  readonly feedback: Ref<string>;
  readonly busy: Ref<boolean>;
  readonly width: Ref<PreviewWidth>;
  /** The editing frame shows an approximation of a dark mode of the reader. */
  readonly dark: Ref<boolean>;
  /** The findings of the last review; undefined until one is asked for. */
  readonly review: ShallowRef<readonly BlockCheck[] | undefined>;
  readonly reviewing: Ref<boolean>;
  /** Reviews the piece now; once asked for, every later revision is reviewed again. */
  runReview(): Promise<void>;
  /** The blocks saved in the library of the host, of the kind of the piece; empty without a library. */
  readonly savedBlocks: ShallowRef<readonly EditorSavedBlock[]>;
  readonly hasSavedBlocks: ComputedRef<boolean>;
  readonly canRemoveSavedBlocks: ComputedRef<boolean>;
  loadSavedBlocks(): Promise<void>;
  /** Saves the block under a name; false when the host refused it. */
  saveBlock(id: string, name: string): Promise<boolean>;
  insertSavedBlock(entry: EditorSavedBlock): Promise<boolean>;
  removeSavedBlock(entry: EditorSavedBlock): Promise<boolean>;
  readonly canvas: ShallowRef<BlockCanvasApi | undefined>;
  readonly hasImagePicker: ComputedRef<boolean>;
  controller(): BlockEditorController;
  t(key: string): string;
  /**
   * The one door of a change: the text being edited is concluded first, then the command runs
   * and its outcome is said in the status line (`success` empty: nothing is said).
   */
  run(action: (controller: BlockEditorController) => boolean, success?: string): Promise<boolean>;
  history(direction: 'undo' | 'redo'): void;
  canHistory(direction: 'undo' | 'redo'): boolean;
  save(): Promise<void>;
  /** Asks the host library for an image and puts it in the block, as one step. */
  chooseImage(id: string): Promise<void>;
  dispose(): void;
}

export const BLOCK_WORKBENCH: InjectionKey<BlockWorkbench> = Symbol('visual-editor-blocks');

export function useBlockWorkbench(): BlockWorkbench {
  const workbench = inject(BLOCK_WORKBENCH);
  if (!workbench) throw new Error('BLOCK_WORKBENCH_MISSING');
  return workbench;
}

export function createBlockWorkbench(options: BlockWorkbenchOptions): BlockWorkbench {
  const state = shallowRef(options.controller().state());
  const locale = computed(() => new EditorLocale(options.messages()));
  const feedback = ref('');
  const busy = ref(false);
  const width = ref<PreviewWidth>('desktop');
  const dark = ref(false);
  const savedBlocks = shallowRef<readonly EditorSavedBlock[]>([]);
  const library = (): EditorSavedBlocks | undefined => options.savedBlocks?.();
  const loadSavedBlocks = async (): Promise<void> => {
    const host = library();
    const owner = options.controller();
    if (!host) {
      savedBlocks.value = [];
      return;
    }
    try {
      const kind = owner.kind();
      const entries = await host.list(kind);
      if (options.controller() === owner) savedBlocks.value = acceptedSavedBlocks(entries, kind);
    } catch {
      feedback.value = t('savedBlocks.loadFailed');
    }
  };
  const saveBlock = async (id: string, name: string): Promise<boolean> => {
    const host = library();
    const owner = options.controller();
    const trimmed = name.trim();
    const block = owner.savable(id);
    if (!host || !block || !trimmed || trimmed.length > SAVED_BLOCK_LIMITS.name) return false;
    try {
      await host.save({ name: trimmed, kind: owner.kind(), block });
    } catch {
      feedback.value = t('savedBlocks.saveFailed');
      return false;
    }
    feedback.value = t('savedBlocks.saved');
    await loadSavedBlocks();
    return true;
  };
  const insertSavedBlock = (entry: EditorSavedBlock): Promise<boolean> =>
    run((controller) => controller.insertSaved(entry.block));
  const removeSavedBlock = async (entry: EditorSavedBlock): Promise<boolean> => {
    const host = library();
    if (!host?.remove) return false;
    try {
      await host.remove(entry.id);
    } catch {
      feedback.value = t('savedBlocks.removeFailed');
      return false;
    }
    feedback.value = t('savedBlocks.removed');
    await loadSavedBlocks();
    return true;
  };
  const review = shallowRef<readonly BlockCheck[]>();
  const reviewing = ref(false);
  let reviewJob = 0;
  let reviewTimer: ReturnType<typeof setTimeout> | undefined;
  const runReview = async (): Promise<void> => {
    clearTimeout(reviewTimer);
    const current = ++reviewJob;
    const owner = options.controller();
    reviewing.value = true;
    try {
      const findings = await owner.review();
      if (current === reviewJob && options.controller() === owner) review.value = findings;
    } catch {
      // A compiler busy with a newer revision: the next revision reviews again.
    } finally {
      if (current === reviewJob) reviewing.value = false;
    }
  };
  // The e-mail is compiled for its size: wait for the author to pause before reviewing again.
  const stopReview = watch(
    () => state.value.document.revision,
    () => {
      if (review.value === undefined) return;
      clearTimeout(reviewTimer);
      reviewTimer = setTimeout(() => void runReview(), 800);
    },
  );
  const canvas = shallowRef<BlockCanvasApi>();
  const t = (key: string): string => locale.value.text(key);
  const flush = async (): Promise<boolean> => !canvas.value || (await canvas.value.flush());

  const run: BlockWorkbench['run'] = async (action, success = 'feedback.applied') => {
    const owner = options.controller();
    if (!(await flush()) || options.controller() !== owner) return false;
    let applied: boolean;
    try {
      applied = action(owner);
    } catch {
      applied = false;
    }
    feedback.value = applied ? (success ? t(success) : '') : t('feedback.invalid');
    if (!applied) options.failed('feedback.invalid');
    return applied;
  };
  const canHistory = (direction: 'undo' | 'redo'): boolean =>
    !state.value.readOnly &&
    ((direction === 'undo' ? state.value.canUndo : state.value.canRedo) ||
      !!canvas.value?.canHistory(direction));
  const history = (direction: 'undo' | 'redo'): void => {
    if (state.value.readOnly) return;
    // The text being edited has its own steps; they come before the steps of the piece.
    if (canvas.value?.history(direction)) return;
    void run((controller) => controller[direction]());
  };
  const save = async (): Promise<void> => {
    if (busy.value || state.value.readOnly) return;
    const owner = options.controller();
    busy.value = true;
    try {
      if (!(await flush()) || options.controller() !== owner) return;
      // The piece the store received: a change made while it was saved is not in it.
      const saved = await owner.saveDocument();
      if (options.controller() !== owner) return;
      feedback.value = t(saved ? 'feedback.saved' : 'feedback.invalid');
      if (saved) options.saved(saved);
      else options.failed('feedback.invalid');
    } finally {
      if (options.controller() === owner) busy.value = false;
    }
  };
  const chooseImage = async (id: string): Promise<void> => {
    const picker = options.imagePicker();
    const owner = options.controller();
    const field = (key: string): string => {
      const value = owner.fields(id).find((entry) => entry.key === key)?.own;
      return typeof value === 'string' ? value : '';
    };
    if (!picker || state.value.readOnly || !(await flush())) return;
    let choice: Awaited<ReturnType<EditorImagePicker['pickImage']>>;
    try {
      choice = await picker.pickImage({
        nodeId: id,
        kind: owner.kind(),
        current: { url: field('url'), alt: field('alt') },
      });
    } catch {
      choice = undefined;
    }
    if (!choice || options.controller() !== owner) return;
    const { url, alt, id: assetId } = choice;
    await run((controller) =>
      controller.replaceImage(id, {
        url,
        ...(alt !== undefined ? { alt } : {}),
        ...(assetId !== undefined ? { assetId } : {}),
      }),
    );
  };

  let unsubscribe: (() => void) | undefined;
  const subscribe = (controller: BlockEditorController): void => {
    unsubscribe?.();
    unsubscribe = controller.subscribe((value) => {
      state.value = value;
    });
  };
  subscribe(options.controller());
  const stop = watch(
    options.controller,
    (controller) => {
      feedback.value = '';
      busy.value = false;
      subscribe(controller);
    },
    { flush: 'sync' },
  );

  return {
    state,
    locale,
    feedback,
    busy,
    width,
    dark,
    review,
    reviewing,
    runReview,
    savedBlocks,
    hasSavedBlocks: computed(() => !!options.savedBlocks?.()),
    canRemoveSavedBlocks: computed(() => !!options.savedBlocks?.()?.remove),
    loadSavedBlocks,
    saveBlock,
    insertSavedBlock,
    removeSavedBlock,
    canvas,
    hasImagePicker: computed(() => !!options.imagePicker()),
    controller: options.controller,
    t,
    run,
    history,
    canHistory,
    save,
    chooseImage,
    dispose: () => {
      stop();
      stopReview();
      clearTimeout(reviewTimer);
      reviewJob++;
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
