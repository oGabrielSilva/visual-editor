import type { DocumentNode } from '../core/document';

export interface MutableNode {
  id: string;
  type: DocumentNode['type'];
  tag?: string;
  value?: string;
  attrs?: Record<string, string>;
  children?: MutableNode[];
  metadata?: NonNullable<DocumentNode['metadata']>;
}

/** The unit a generated e-mail block is meant to be inserted as. */
export type EmailInsertionUnit = 'content' | 'section';

interface TreeNode<T> extends Omit<DocumentNode, 'children'> {
  readonly children?: readonly T[];
}

interface EmailColumn<T> {
  /** Presentation table owned by the column; its body holds one row per content element. */
  readonly table: T;
  readonly body: T;
  readonly rows: readonly T[];
}

export interface CompiledEmailBlock {
  /** False for plain snippets, which keep the generic insertion rules. */
  readonly compiled: boolean;
  /** Section-level sequence: sections and their Outlook conditional comments. */
  readonly units: readonly DocumentNode[];
  /** Undefined when a compiled section has a shape this planner does not know. */
  readonly columns: readonly EmailColumn<DocumentNode>[] | undefined;
}

export interface EmailInsertionPlan {
  readonly parent: MutableNode | undefined;
  readonly target: MutableNode[];
  readonly index: number;
  readonly nodes: readonly DocumentNode[];
}

type ConditionalKind = 'open' | 'close' | 'bridge' | 'inline' | 'other';

const CONDITIONAL_PREFIX = '[if mso | IE]>';
const CONDITIONAL_SUFFIX = '<![endif]';
const GHOST_CLOSE = '</td></tr></table>';
const TABLE_CONTEXT = new Set(['table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th']);
const ROW_GROUPS = new Set(['tbody', 'thead', 'tfoot']);
/** Parents which take section-level flow content; anything else passes it to an ancestor. */
const SECTION_HOSTS = new Set([
  'body',
  'td',
  'th',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'figure',
  'details',
]);
const PRESENTATION_TABLE: Readonly<Record<string, string>> = Object.freeze({
  border: '0',
  cellpadding: '0',
  cellspacing: '0',
  role: 'presentation',
  width: '100%',
});

/**
 * Chooses what a generated e-mail block contributes to a destination. Inside a column or
 * cell only content rows travel; at section level the section goes with its balanced pair of
 * Outlook comments. The preheader, the title and the article wrapper of the compiled block
 * never enter the document. Anything that cannot be placed safely is refused.
 */
export class EmailInsertionPlanner {
  constructor(
    private readonly id: () => string,
    private readonly hidden: (style: string) => boolean,
  ) {}

  block(body: readonly DocumentNode[]): CompiledEmailBlock {
    const visible = body.filter((node) => !this.blank(node));
    const preheaders = visible.filter((node, index) =>
      visible.slice(0, index + 1).every((candidate) => this.preheader(candidate)),
    );
    const rest = visible.slice(preheaders.length);
    const wrapper = rest.length === 1 && rest[0] && this.wrapper(rest[0]) ? rest[0] : undefined;
    const units = this.trim(
      wrapper ? (wrapper.children ?? []) : body.filter((node) => !preheaders.includes(node)),
    );
    const sections = units.filter((node) => node.type === 'element');
    const shapes = sections.map((section) => this.columns<DocumentNode>(section));
    const known = sections.length > 0 && shapes.every((shape) => shape !== undefined);
    const conditional = units.some((node) =>
      ['open', 'close', 'bridge'].includes(this.conditional(node) ?? ''),
    );
    return {
      compiled: !!wrapper || conditional || known,
      units,
      columns: known ? shapes.flatMap((shape) => shape ?? []) : undefined,
    };
  }

  place(
    roots: MutableNode[],
    parent: MutableNode | undefined,
    index: number | undefined,
    block: CompiledEmailBlock,
    requested?: EmailInsertionUnit,
  ): EmailInsertionPlan {
    const chain = parent ? this.chain(roots, parent.id) : [];
    if (parent && !chain.length) throw new Error('Missing parent');
    const inCell = chain.some((node) => TABLE_CONTEXT.has(node.tag ?? ''));
    const columns = block.columns;
    const unit = requested ?? (columns?.length === 1 ? 'content' : 'section');
    if (!inCell) return this.sectionLevel(roots, parent, index, block.units, true);
    if (!columns || unit === 'section') {
      // A whole section cannot live inside a cell: it follows the enclosing layout unit.
      let anchorIndex = chain.findIndex((node) => this.layoutUnit(node));
      if (anchorIndex < 0) throw new Error('Unsupported e-mail block destination');
      // A wrapper such as <center> takes no section: the block follows it in a real host.
      while (anchorIndex > 0 && !SECTION_HOSTS.has(chain[anchorIndex - 1]?.tag ?? ''))
        anchorIndex--;
      const anchor = chain[anchorIndex];
      if (!anchor) throw new Error('Unsupported e-mail block destination');
      const owner = chain[anchorIndex - 1];
      const siblings = owner ? (owner.children ??= []) : roots;
      return this.sectionLevel(roots, owner, siblings.indexOf(anchor) + 1, block.units, false);
    }
    if (!parent) throw new Error('Missing parent');
    const rows = columns.flatMap((column) => column.rows);
    const rowHost = this.rowHost(chain, parent);
    if (rowHost) return { ...rowHost, nodes: rows };
    const target = (parent.children ??= []);
    const position = this.position(index, target.length);
    if (ROW_GROUPS.has(parent.tag ?? '')) return { parent, target, index: position, nodes: rows };
    if (parent.tag === 'tr')
      return {
        parent,
        target,
        index: position,
        nodes: rows.flatMap((row) =>
          (row.children ?? []).filter((cell) => cell.type === 'element'),
        ),
      };
    if (parent.tag === 'table')
      return {
        parent,
        target,
        index: position,
        nodes: [{ id: this.id(), type: 'element', tag: 'tbody', children: rows }],
      };
    this.assertFlowDestination(parent);
    return { parent, target, index: position, nodes: columns.map((column) => column.table) };
  }

  /** A new image is born inside the content unit generated image blocks use. */
  placeImage(
    roots: MutableNode[],
    parent: MutableNode | undefined,
    index: number | undefined,
    image: MutableNode,
  ): EmailInsertionPlan {
    const chain = parent ? this.chain(roots, parent.id) : [];
    if (parent && !chain.length) throw new Error('Missing parent');
    const cell: MutableNode = {
      id: this.id(),
      type: 'element',
      tag: 'td',
      attrs: { align: 'center', style: 'padding:10px 25px' },
      children: [image],
    };
    const row: MutableNode = { id: this.id(), type: 'element', tag: 'tr', children: [cell] };
    const table = (): MutableNode => ({
      id: this.id(),
      type: 'element',
      tag: 'table',
      attrs: { ...PRESENTATION_TABLE },
      children: [{ id: this.id(), type: 'element', tag: 'tbody', children: [row] }],
    });
    if (parent && chain.some((node) => TABLE_CONTEXT.has(node.tag ?? ''))) {
      const rowHost = this.rowHost(chain, parent);
      if (rowHost) return { ...rowHost, nodes: [row] };
      const target = (parent.children ??= []);
      const position = this.position(index, target.length);
      if (ROW_GROUPS.has(parent.tag ?? ''))
        return { parent, target, index: position, nodes: [row] };
      if (parent.tag === 'tr') return { parent, target, index: position, nodes: [cell] };
      if (parent.tag === 'table')
        return {
          parent,
          target,
          index: position,
          nodes: [{ id: this.id(), type: 'element', tag: 'tbody', children: [row] }],
        };
      this.assertFlowDestination(parent);
      return { parent, target, index: position, nodes: [table()] };
    }
    const place = this.sectionLevel(roots, parent, index, [], true);
    // Prefer a column of the neighbouring section, so the image keeps the message width.
    const before = place.target
      .slice(0, place.index)
      .reverse()
      .find((node) => node.type === 'element');
    const after = place.target.slice(place.index).find((node) => node.type === 'element');
    const previous = before ? this.columns<MutableNode>(before)?.at(-1) : undefined;
    if (previous) {
      const target = (previous.body.children ??= []);
      return { parent: previous.body, target, index: target.length, nodes: [row] };
    }
    const next = after ? this.columns<MutableNode>(after)?.[0] : undefined;
    if (next)
      return { parent: next.body, target: (next.body.children ??= []), index: 0, nodes: [row] };
    return { ...place, nodes: [table()] };
  }

  /**
   * Where content rows go when the destination is part of a recognized section: after the
   * selected row of a column, or at the end of the last column when the section shell (its
   * row or the cell which holds the columns) was selected. A cell beside the selected row,
   * or flow content between the Outlook ghost cells, would break the column layout.
   */
  private rowHost(
    chain: readonly MutableNode[],
    parent: MutableNode,
  ): Omit<EmailInsertionPlan, 'nodes'> | undefined {
    if (parent.tag !== 'tr' && parent.tag !== 'td') return undefined;
    for (const section of chain) {
      const columns = this.columns<MutableNode>(section);
      if (!columns) continue;
      const column = columns.find((candidate) => candidate.rows.includes(parent));
      if (column) {
        const target = (column.body.children ??= []);
        return { parent: column.body, target, index: target.indexOf(parent) + 1 };
      }
      const shellRow = this.descend(section, ['table', 'tbody', 'tr']);
      const shellCell = shellRow && this.descend(shellRow, ['td']);
      const last = columns.at(-1);
      if (last && (parent === shellRow || parent === shellCell)) {
        const target = (last.body.children ??= []);
        return { parent: last.body, target, index: target.length };
      }
    }
    return undefined;
  }

  private sectionLevel(
    roots: MutableNode[],
    requestedParent: MutableNode | undefined,
    requestedIndex: number | undefined,
    units: readonly DocumentNode[],
    redirect: boolean,
  ): EmailInsertionPlan {
    this.assertBalanced(units);
    let parent = requestedParent;
    let index = requestedIndex;
    const body = parent ?? this.find(roots, 'body');
    if (redirect && (!parent || parent.tag === 'body')) {
      const siblings = body ? (body.children ??= []) : roots;
      const wrappers = siblings.filter((node) => this.wrapper(node));
      const wrapper = wrappers.length === 1 ? wrappers[0] : undefined;
      if (wrapper) {
        // New sections belong to the article which already holds the message.
        const length = (wrapper.children ??= []).length;
        index = index === undefined || index > siblings.indexOf(wrapper) ? length : 0;
        parent = wrapper;
      } else parent = body;
    }
    const target = parent ? (parent.children ??= []) : roots;
    let position = this.position(index, target.length);
    const previous = target
      .slice(0, position)
      .reverse()
      .find((node) => !this.blank(node));
    const next = target.slice(position).find((node) => !this.blank(node));
    // Never split a section from the comment which opens or closes its Outlook table.
    if (next && this.conditional(next) === 'close') position = target.indexOf(next) + 1;
    else if (previous && this.conditional(previous) === 'open') position = target.indexOf(previous);
    else if (units.length) {
      const bridge = [next, previous].find((node) => node && this.conditional(node) === 'bridge');
      if (bridge) position = this.splitBridge(target, bridge);
    }
    return { parent, target, index: position, nodes: units };
  }

  /**
   * Between two sections one comment closes a ghost table and opens the next. It becomes
   * its two halves, so a new section fits between them with a pair of its own.
   */
  private splitBridge(target: MutableNode[], bridge: MutableNode): number {
    const value = bridge.value ?? '';
    const opening = value.slice(CONDITIONAL_PREFIX.length + GHOST_CLOSE.length);
    const index = target.indexOf(bridge);
    target.splice(
      index,
      1,
      { ...bridge, value: `${CONDITIONAL_PREFIX}${GHOST_CLOSE}${CONDITIONAL_SUFFIX}` },
      { id: this.id(), type: 'comment', value: `${CONDITIONAL_PREFIX}${opening}` },
    );
    return index + 1;
  }

  private assertBalanced(units: readonly DocumentNode[]): void {
    let depth = 0;
    for (const node of units) {
      const kind = this.conditional(node);
      if (kind === undefined || kind === 'inline') continue;
      if (kind === 'other') throw new Error('Unsupported e-mail conditional');
      if (kind === 'open') depth++;
      else if (depth < 1) throw new Error('Unbalanced e-mail conditional');
      else if (kind === 'close') depth--;
    }
    if (depth !== 0) throw new Error('Unbalanced e-mail conditional');
  }

  /** Flow content next to Outlook ghost cells would land in the wrong table for one client. */
  private assertFlowDestination(parent: MutableNode): void {
    if (
      (parent.children ?? []).some((node) =>
        ['open', 'close', 'bridge', 'other'].includes(this.conditional(node) ?? ''),
      )
    )
      throw new Error('Unsupported e-mail block destination');
  }

  private columns<T extends TreeNode<T>>(section: T): readonly EmailColumn<T>[] | undefined {
    if (section.type !== 'element' || section.tag !== 'div') return undefined;
    const cell = this.descend(section, ['table', 'tbody', 'tr', 'td']);
    if (!cell) return undefined;
    const columns: EmailColumn<T>[] = [];
    for (const child of cell.children ?? []) {
      if (child.type === 'comment' || this.blank(child)) continue;
      if (child.type !== 'element' || child.tag !== 'div') return undefined;
      const table = this.descend(child, ['table']);
      const body = table && this.descend(table, ['tbody']);
      if (!table || !body) return undefined;
      const rows = (body.children ?? []).filter((row) => !this.blank(row));
      if (rows.some((row) => row.type !== 'element' || row.tag !== 'tr')) return undefined;
      columns.push({ table, body, rows });
    }
    return columns.length ? columns : undefined;
  }

  private descend<T extends TreeNode<T>>(node: T, tags: readonly string[]): T | undefined {
    let current = node;
    for (const tag of tags) {
      const children = (current.children ?? []).filter((child) => !this.blank(child));
      const child = children[0];
      if (
        children.length !== 1 ||
        !child ||
        child.type !== 'element' ||
        child.tag !== tag ||
        (tag === 'table' && child.attrs?.role !== 'presentation')
      )
        return undefined;
      current = child;
    }
    return current;
  }

  private conditional(node: TreeNode<unknown>): ConditionalKind | undefined {
    const value = node.type === 'comment' ? (node.value ?? '') : '';
    if (!value.startsWith(CONDITIONAL_PREFIX) || !value.endsWith(CONDITIONAL_SUFFIX))
      return undefined;
    const markup = value.slice(CONDITIONAL_PREFIX.length, -CONDITIONAL_SUFFIX.length);
    if (markup === GHOST_CLOSE) return 'close';
    if (markup.startsWith(`${GHOST_CLOSE}<table`))
      return markup.endsWith('</table>') ? 'other' : 'bridge';
    if (!markup.startsWith('<table')) return 'other';
    // A table opened and closed by the same comment (an Outlook divider) changes no nesting.
    return markup.endsWith('</table>') ? 'inline' : 'open';
  }

  private layoutUnit(node: MutableNode): boolean {
    if (node.tag === 'table') return true;
    const elements = (node.children ?? []).filter((child) => child.type === 'element');
    return node.tag === 'div' && elements.length === 1 && elements[0]?.tag === 'table';
  }

  private wrapper(node: TreeNode<unknown>): boolean {
    return (
      node.type === 'element' &&
      node.tag === 'div' &&
      node.attrs?.role === 'article' &&
      node.attrs['aria-roledescription'] === 'email'
    );
  }

  private preheader(node: DocumentNode): boolean {
    return (
      node.type === 'element' &&
      node.tag === 'div' &&
      (node.children ?? []).every((child) => child.type === 'text') &&
      this.hidden(node.attrs?.style ?? '')
    );
  }

  private blank(node: TreeNode<unknown>): boolean {
    return node.type === 'text' && !node.value?.trim();
  }

  private trim(nodes: readonly DocumentNode[]): readonly DocumentNode[] {
    const first = nodes.findIndex((node) => !this.blank(node));
    if (first < 0) return [];
    const trailing = [...nodes].reverse().findIndex((node) => !this.blank(node));
    return nodes.slice(first, nodes.length - trailing);
  }

  private position(index: number | undefined, length: number): number {
    if (index === undefined) return length;
    if (!Number.isInteger(index) || index < 0 || index > length)
      throw new Error('Invalid insertion index');
    return index;
  }

  private find(nodes: MutableNode[], tag: string): MutableNode | undefined {
    for (const node of nodes) {
      if (node.tag === tag) return node;
      const found = this.find(node.children ?? [], tag);
      if (found) return found;
    }
    return undefined;
  }

  /** Ancestors of the node, outermost first and ending with the node itself. */
  private chain(nodes: MutableNode[], id: string): MutableNode[] {
    for (const node of nodes) {
      if (node.id === id) return [node];
      const nested = this.chain(node.children ?? [], id);
      if (nested.length) return [node, ...nested];
    }
    return [];
  }
}
