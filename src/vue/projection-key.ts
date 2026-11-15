import type { EditorViewState } from './controller';

type ProjectionState = Pick<EditorViewState, 'document' | 'selectedNodeId' | 'readOnly' | 'mode'>;

/** Invalidates derived document views only after a committed document change. */
export const documentProjectionKey = (state: Pick<ProjectionState, 'document'>): string =>
  JSON.stringify([state.document.id, state.document.revision, state.document.kind]);

/** Pending text updates do not change the selected canonical node or its capabilities. */
export const selectionProjectionKey = (state: ProjectionState): string =>
  JSON.stringify([documentProjectionKey(state), state.selectedNodeId, state.readOnly, state.mode]);
