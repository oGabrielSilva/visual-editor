export interface DiagnosticLike {
  readonly code: string;
  readonly messageKey: string;
  readonly severity?: string;
  readonly count?: number;
}

export interface DiagnosticGroup {
  readonly key: string;
  readonly code: string;
  readonly messageKey: string;
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly count: number;
}

/**
 * Shows each notice once. Diagnostics which say the same thing are one line with a count, whether
 * the count came with them or they simply repeat.
 */
export class DiagnosticGroups {
  constructor(private readonly text: (key: string) => string) {}

  group(diagnostics: readonly DiagnosticLike[]): readonly DiagnosticGroup[] {
    const groups = new Map<string, DiagnosticGroup>();
    for (const diagnostic of diagnostics) {
      const message = this.text(diagnostic.messageKey);
      const severity =
        diagnostic.severity === 'error' || diagnostic.severity === 'info'
          ? diagnostic.severity
          : 'warning';
      // The same sentence is the same notice for the reader, whatever internal code produced it.
      const key = `${severity}\u0000${message}`;
      const count =
        typeof diagnostic.count === 'number' && Number.isSafeInteger(diagnostic.count)
          ? Math.max(1, diagnostic.count)
          : 1;
      const current = groups.get(key);
      groups.set(
        key,
        current
          ? { ...current, count: current.count + count }
          : {
              key,
              code: diagnostic.code,
              messageKey: diagnostic.messageKey,
              message,
              severity,
              count,
            },
      );
    }
    const rank = { error: 0, warning: 1, info: 2 } as const;
    return [...groups.values()].sort((left, right) => rank[left.severity] - rank[right.severity]);
  }

  /** A stable name for a set of notices, to remember that the person dismissed it. */
  signature(groups: readonly DiagnosticGroup[]): string {
    return groups.map((group) => `${group.key}\u0000${group.count}`).join('\u0001');
  }
}
