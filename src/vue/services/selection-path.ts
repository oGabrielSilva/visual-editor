export interface PathEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}

export interface CollapsedPath {
  readonly head: readonly PathEntry[];
  /** Levels folded into the ellipsis menu, outermost first. */
  readonly hidden: readonly PathEntry[];
  readonly tail: readonly PathEntry[];
}

/**
 * Fits the path of the selection in one line: the outermost level and the innermost ones stay,
 * the middle folds into one menu. It never asks for a scroll bar.
 */
export class SelectionPath {
  collapse(entries: readonly PathEntry[], visible: number): CollapsedPath {
    const limit = Math.max(2, Math.floor(visible));
    if (entries.length <= limit) return { head: entries, hidden: [], tail: [] };
    const tail = entries.slice(entries.length - (limit - 1));
    return {
      head: entries.slice(0, 1),
      hidden: entries.slice(1, entries.length - tail.length),
      tail,
    };
  }

  /** How many levels fit in `width` pixels, from an average width per level. */
  capacity(width: number, perLevel = 112): number {
    if (!Number.isFinite(width) || width <= 0) return 2;
    return Math.max(2, Math.floor(width / perLevel));
  }
}
