/** A value the host fills in when the piece is sent or published: a name, a link, a date. */
export interface EditorVariable {
  readonly key: string;
  readonly label: string;
  readonly purpose: 'text' | 'url';
  /** Optional heading under which the variable is listed: "Contato", "Empresa". */
  readonly group?: string;
}

export interface VariableGroup {
  readonly label: string;
  readonly variables: readonly EditorVariable[];
}

const KEY = /^[a-zA-Z0-9._]{1,200}$/;

/** Groups the catalog of the host for one purpose and resolves a key to its token. */
export class VariableCatalog {
  constructor(private readonly variables: readonly EditorVariable[]) {}

  for(purpose: 'text' | 'url'): readonly EditorVariable[] {
    return this.variables.filter(
      (variable) => variable.purpose === purpose && KEY.test(variable.key),
    );
  }

  groups(purpose: 'text' | 'url', fallback: string): readonly VariableGroup[] {
    const groups = new Map<string, EditorVariable[]>();
    for (const variable of this.for(purpose)) {
      const label = variable.group?.trim() || fallback;
      groups.set(label, [...(groups.get(label) ?? []), variable]);
    }
    return [...groups].map(([label, variables]) => ({ label, variables }));
  }

  /** The text which stands for the variable in the piece, or undefined for an unknown key. */
  token(key: string, purpose: 'text' | 'url'): string | undefined {
    return this.for(purpose).some((variable) => variable.key === key) ? `{{${key}}}` : undefined;
  }
}
