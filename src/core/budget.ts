export class DocumentBudgetError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DocumentBudgetError';
  }
}

/** Bounds are checked before recursive schemas and parsers inspect untrusted input. */
export class DocumentBudget {
  // JSON also contains the canonical tree, provenance and an optional recovery buffer.
  // Its larger transfer ceiling accommodates escaped strings; source/tree budgets still apply.
  // Sized for real e-mails (300-400 KB) and landing pages (1 MB):
  // `nodes` counts elements, comments, doctypes and text which is not only white space.
  // Indentation between tags is bounded by `totalNodes` and by the source size instead.
  static readonly limits = Object.freeze({
    nodes: 50_000,
    totalNodes: 150_000,
    depth: 256,
    sourceBytes: 2_000_000,
    cssBytes: 500_000,
    jsonBytes: 64_000_000,
    attributesPerNode: 256,
    /** Ceiling of values typed or projected by the editor itself (links, rich text). */
    attributeLength: 16_384,
    /** Ceiling of one attribute of an imported document, e.g. an inline `data:` image. */
    documentAttributeLength: 2_000_000,
  });

  /** Strings of a JSON document: content, plus identifiers and keys of every node. */
  static readonly jsonStringBytes =
    DocumentBudget.limits.sourceBytes * 3 + DocumentBudget.limits.totalNodes * 160;

  /** UTF-8 length. Read by code unit: megabytes of source are measured on every change. */
  byteLength(value: string): number {
    let bytes = 0;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && this.lowSurrogate(value, index + 1)) {
        bytes += 4;
        index++;
      } else bytes += 3;
    }
    return bytes;
  }

  private lowSurrogate(value: string, index: number): boolean {
    const code = value.charCodeAt(index);
    return code >= 0xdc00 && code <= 0xdfff;
  }

  assertSource(html: string, css: string): void {
    if (this.byteLength(html) > DocumentBudget.limits.sourceBytes)
      throw new DocumentBudgetError('DOCUMENT_TOO_LARGE');
    if (this.byteLength(css) > DocumentBudget.limits.cssBytes)
      throw new DocumentBudgetError('CSS_TOO_LARGE');
  }

  assertInput(data: unknown): void {
    const visiting = new Set<object>();
    const stack: { value: unknown; depth: number; exit: boolean }[] = [
      { value: data, depth: 0, exit: false },
    ];
    let objects = 0;
    let bytes = 0;
    while (stack.length) {
      const frame = stack.pop();
      if (!frame) break;
      if (typeof frame.value === 'string') bytes += this.byteLength(frame.value);
      if (bytes > DocumentBudget.jsonStringBytes)
        throw new DocumentBudgetError('DOCUMENT_TOO_LARGE');
      if (typeof frame.value !== 'object' || frame.value === null) continue;
      if (frame.exit) {
        visiting.delete(frame.value);
        continue;
      }
      if (frame.depth > DocumentBudget.limits.depth * 4)
        throw new DocumentBudgetError('DOCUMENT_TOO_DEEP');
      if (++objects > DocumentBudget.limits.totalNodes * 4)
        throw new DocumentBudgetError('DOCUMENT_TOO_MANY_NODES');
      if (visiting.has(frame.value)) throw new DocumentBudgetError('CYCLIC_DOCUMENT');
      const prototype: unknown = Object.getPrototypeOf(frame.value);
      if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
        throw new DocumentBudgetError('INVALID_DOCUMENT_SCHEMA');
      visiting.add(frame.value);
      stack.push({ ...frame, exit: true });
      for (const [key, value] of Object.entries(frame.value)) {
        bytes += this.byteLength(key);
        stack.push({ value, depth: frame.depth + 1, exit: false });
      }
    }
    if (bytes > DocumentBudget.jsonStringBytes) throw new DocumentBudgetError('DOCUMENT_TOO_LARGE');
  }

  /** White space between tags does not count against the node ceiling. */
  countable(node: { readonly type: string; readonly value?: string }): boolean {
    return node.type !== 'text' || !!node.value?.trim();
  }
}
