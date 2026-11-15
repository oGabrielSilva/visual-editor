/**
 * MJML written by the block codec, with the exact raw regions (`mj-raw`) it emitted. A raw
 * region is accepted by the compilation only through this type, only inside `mj-column`, and
 * only when it is one of `fragments` and passes `CompilationGuard.rawFragment`: one table row
 * whose single cell holds markup the e-mail rules keep as it is. MJML that arrives as a string
 * (`compile`) never has a raw region.
 */
export class GeneratedMjml {
  readonly source: string;
  readonly fragments: readonly string[];

  constructor(source: string, fragments: readonly string[] = []) {
    if (typeof source !== 'string' || !fragments.every((entry) => typeof entry === 'string'))
      throw new TypeError('INVALID_GENERATED_MJML');
    this.source = source;
    this.fragments = Object.freeze([...fragments]);
    Object.freeze(this);
  }
}

/** Compilers which accept generated MJML. Both bundled compilers implement it. */
export interface GeneratedMjmlCompilerPort {
  compileGenerated(mjml: GeneratedMjml): Promise<string>;
}

/** What a compilation worker receives: external MJML, or generated MJML with its regions. */
export type CompileRequest = string | { readonly source: string; readonly fragments: string[] };

export function readCompileRequest(
  request: unknown,
): { source: string; fragments?: readonly string[] } | undefined {
  if (typeof request === 'string') return { source: request };
  if (!request || typeof request !== 'object') return undefined;
  const source: unknown = Object.getOwnPropertyDescriptor(request, 'source')?.value;
  const fragments: unknown = Object.getOwnPropertyDescriptor(request, 'fragments')?.value;
  if (
    typeof source !== 'string' ||
    !Array.isArray(fragments) ||
    !fragments.every((entry): entry is string => typeof entry === 'string')
  )
    return undefined;
  return { source, fragments };
}
