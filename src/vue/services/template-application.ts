import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { EditorController } from '../controller';

export interface TemplateChoice {
  readonly id: string;
  readonly html: string;
  readonly trigger: HTMLElement;
}

interface PendingTemplate extends TemplateChoice {
  readonly owner: EditorController;
  readonly documentId: string;
  readonly revision: number;
  readonly editGeneration: number;
}

export interface TemplatePorts {
  controller(): EditorController;
  prepare(action: () => Promise<boolean>): Promise<void>;
  invalid(): void;
}

/**
 * Replacing the piece with a model, after the person confirmed it. It works from either mode:
 * from the HTML mode the pending source is left behind and the editor returns to the visual
 * mode, since the model replaces everything anyway.
 */
export class TemplateApplication {
  readonly pending: ShallowRef<PendingTemplate | undefined> = shallowRef();

  constructor(private readonly ports: TemplatePorts) {}

  choose(choice: TemplateChoice): void {
    const owner = this.ports.controller();
    const state = owner.state();
    this.pending.value = {
      ...choice,
      owner,
      documentId: state.document.id,
      revision: state.document.revision,
      editGeneration: state.editGeneration,
    };
  }

  close(): void {
    this.pending.value = undefined;
  }

  /** Applies the confirmed model; returns the element which should receive the focus back. */
  async apply(): Promise<HTMLElement | undefined> {
    const pending = this.pending.value;
    this.close();
    const owner = this.ports.controller();
    const state = owner.state();
    if (
      !pending ||
      pending.owner !== owner ||
      pending.documentId !== state.document.id ||
      pending.revision !== state.document.revision ||
      // In the HTML mode the pending source keeps changing and is discarded by the model anyway.
      (state.mode === 'visual' && pending.editGeneration !== state.editGeneration)
    ) {
      this.ports.invalid();
      return undefined;
    }
    await this.ports.prepare(async () => {
      if (owner.state().mode === 'html') {
        owner.discardDraft();
        if (!owner.setMode('visual')) return false;
      }
      return owner.applyTemplate(pending.id);
    });
    return this.ports.controller() === owner ? pending.trigger : undefined;
  }
}
