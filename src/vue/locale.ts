import ptBR from './locales/pt-BR.json';

export type EditorMessages = Readonly<Record<string, string>>;

export class EditorLocale {
  constructor(private readonly messages: EditorMessages = ptBR) {}

  keys(): readonly string[] {
    return Object.freeze(Object.keys(ptBR));
  }

  text(key: string): string {
    const direct = this.messages[key] ?? ptBR[key as keyof typeof ptBR];
    if (direct !== undefined) return direct;
    if (!key.startsWith('diagnostics.')) return ptBR['feedback.unknown'];
    const code = key.slice('diagnostics.'.length);
    const fallback =
      code === 'saveFailed'
        ? 'feedback.unknown'
        : code === 'kindMismatch' || code === 'DOCUMENT_KIND_MISMATCH'
          ? 'diagnostic.kindMismatch'
          : code.includes('TOO_LARGE') || code.includes('TOO_DEEP')
            ? 'diagnostic.tooLarge'
            : code.startsWith('FORBIDDEN_') || code.startsWith('UNSAFE_')
              ? 'diagnostic.unsafe'
              : 'diagnostic.invalid';
    return this.messages[fallback] ?? ptBR[fallback];
  }
}
