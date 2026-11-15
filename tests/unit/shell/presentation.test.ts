import { describe, expect, it } from 'vitest';
import { BlockPalette, searchKey } from '../../../src/vue/services/block-palette';
import { DiagnosticGroups } from '../../../src/vue/services/diagnostic-groups';
import { SelectionPath } from '../../../src/vue/services/selection-path';
import { StructureTree } from '../../../src/vue/services/structure-tree';
import { TreeDragSession } from '../../../src/vue/services/tree-drag';
import { VariableCatalog } from '../../../src/vue/variables';
import { EditorLocale } from '../../../src/vue/locale';
import { editor, regionId } from './support';

const text = (key: string): string => new EditorLocale().text(key);

describe('BlockPalette', () => {
  const palette = new BlockPalette(text);
  const types = ['section', 'columns', 'heading', 'text', 'image', 'button', 'divider', 'spacer'];

  it('groups blocks by purpose in a fixed order, each with icon and label', () => {
    const groups = palette.groups(types);
    expect(groups.map((group) => group.label)).toEqual([
      'Estrutura',
      'Texto',
      'Mídia',
      'Ações',
      'Outros',
    ]);
    expect(
      groups.flatMap((group) => group.blocks).every((block) => block.icon && block.label),
    ).toBe(true);
    expect(groups.at(-1)?.blocks.map((block) => block.type)).toEqual(['divider', 'spacer']);
  });

  it('searches without accents or case and drops the groups without a match', () => {
    expect(searchKey('  Título ')).toBe('titulo');
    const groups = palette.groups(types, 'TITU');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.blocks.map((block) => block.type)).toEqual(['heading']);
    expect(palette.groups(types, 'zzz')).toEqual([]);
  });
});

describe('DiagnosticGroups', () => {
  it('keeps information apart from warnings and names a set of notices for dismissal', () => {
    const service = new DiagnosticGroups(text);
    const groups = service.group([
      {
        code: 'SCRIPT_PRESERVED',
        messageKey: 'diagnostics.SCRIPT_PRESERVED',
        severity: 'info',
        count: 3,
      },
      { code: 'SCRIPT_REMOVED', messageKey: 'diagnostics.SCRIPT_REMOVED', severity: 'warning' },
      { code: 'DOCUMENT_TOO_DEEP', messageKey: 'diagnostics.DOCUMENT_TOO_DEEP', severity: 'error' },
    ]);
    expect(groups.map((group) => group.severity)).toEqual(['error', 'warning', 'info']);
    expect(groups[2]).toMatchObject({ count: 3 });
    expect(groups[2]?.message).toContain('Scripts da página foram mantidos');
    const warnings = groups.filter((group) => group.severity === 'warning');
    expect(service.signature(warnings)).toBe(service.signature(warnings));
    expect(service.signature(warnings)).not.toBe(service.signature(groups));
  });

  it('shows a repeated notice once with its count, errors first', () => {
    const groups = new DiagnosticGroups(text).group([
      { code: 'A', messageKey: 'diagnostic.unsafe', severity: 'warning' },
      { code: 'B', messageKey: 'diagnostic.unsafe', severity: 'warning' },
      { code: 'A', messageKey: 'diagnostic.unsafe', severity: 'warning', count: 3 },
      { code: 'C', messageKey: 'diagnostic.invalid', severity: 'error' },
    ]);
    expect(groups.map((group) => [group.severity, group.count])).toEqual([
      ['error', 1],
      ['warning', 5],
    ]);
    expect(new Set(groups.map((group) => group.message)).size).toBe(groups.length);
  });
});

describe('SelectionPath', () => {
  const path = new SelectionPath();
  const entries = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, label: id, icon: '' }));

  it('keeps the outermost and the innermost levels and folds the middle', () => {
    expect(path.collapse(entries, 10).hidden).toEqual([]);
    const collapsed = path.collapse(entries, 3);
    expect(collapsed.head.map((entry) => entry.id)).toEqual(['a']);
    expect(collapsed.hidden.map((entry) => entry.id)).toEqual(['b', 'c', 'd']);
    expect(collapsed.tail.map((entry) => entry.id)).toEqual(['e', 'f']);
    expect(path.collapse(entries, 0).tail.map((entry) => entry.id)).toEqual(['f']);
  });

  it('derives how many levels fit from the width it was given', () => {
    expect(path.capacity(0)).toBe(2);
    expect(path.capacity(1120)).toBe(10);
    expect(path.capacity(Number.NaN)).toBe(2);
  });
});

describe('StructureTree', () => {
  const instance = editor(
    '<section data-editor-block="section"><div><h2 data-editor-block="heading">Um</h2><p>Dois</p></div></section><p>Três</p>',
  );
  const tree = new StructureTree(text);
  const nodes = tree.build(instance.controller.canvasRegions(), instance.controller.entries());

  it('builds the real hierarchy, with a friendly name and an excerpt for each block', () => {
    expect(nodes.map((node) => node.label)).toEqual(['Seção', 'Texto']);
    const heading = tree.find(nodes, regionId(instance, 'h2'));
    expect(heading).toMatchObject({ label: 'Título', detail: 'Um' });
    expect(tree.count(nodes)).toBe(instance.controller.canvasRegions().length);
    expect(tree.path(nodes, regionId(instance, 'h2'))[0]).toBe(regionId(instance, 'section'));
    expect(tree.path(nodes, regionId(instance, 'section'))).toEqual([]);
  });

  it('opens shallow levels by default and never a leaf', () => {
    const expanded = tree.defaultExpanded(nodes);
    expect(expanded).toContain(regionId(instance, 'section'));
    expect(expanded).not.toContain(regionId(instance, 'h2'));
    expect(tree.defaultExpanded(nodes, 0)).toEqual([]);
  });

  it('only proposes drop placements the document declared valid', () => {
    const targets = [{ targetId: 'x', placements: ['before', 'inside'] as const }];
    expect(tree.placement(targets, 'x', 0.1, true)).toBe('before');
    expect(tree.placement(targets, 'x', 0.5, true)).toBe('inside');
    expect(tree.placement(targets, 'x', 0.9, false)).toBeUndefined();
    expect(tree.placement(targets, 'other', 0.5, true)).toBeUndefined();
  });
});

describe('TreeDragSession', () => {
  const pointer = (x: number, y: number, pointerId = 1) => ({
    pointerId,
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: true,
  });

  it('becomes a drag only after the threshold and drops on a target other than itself', () => {
    const drag = new TreeDragSession();
    expect(drag.start('a', pointer(0, 0))).toBe(true);
    expect(drag.update(pointer(2, 2), { id: 'b', placement: 'after' })).toBe(false);
    expect(drag.update(pointer(0, 12), { id: 'a', placement: 'after' })).toBe(true);
    expect(drag.finish(pointer(0, 12))).toBeUndefined();
    drag.start('a', pointer(0, 0));
    drag.update(pointer(0, 12), { id: 'b', placement: 'inside' });
    expect(drag.finish(pointer(0, 12, 2))).toBeUndefined();
    expect(drag.finish(pointer(0, 12))).toEqual({ source: 'a', target: 'b', placement: 'inside' });
    expect(drag.dragging).toBe(false);
  });
});

describe('VariableCatalog', () => {
  const catalog = new VariableCatalog([
    { key: 'contact.name', label: 'Nome', purpose: 'text', group: 'Contato' },
    { key: 'company.name', label: 'Empresa', purpose: 'text' },
    { key: 'profileUrl', label: 'Perfil', purpose: 'url', group: 'Links' },
    { key: 'bad key}}', label: 'Inválida', purpose: 'text' },
  ]);

  it('groups by purpose and heading, and resolves only known keys to a token', () => {
    expect(catalog.groups('text', 'Variáveis').map((group) => group.label)).toEqual([
      'Contato',
      'Variáveis',
    ]);
    expect(catalog.token('contact.name', 'text')).toBe('{{contact.name}}');
    expect(catalog.token('contact.name', 'url')).toBeUndefined();
    expect(catalog.token('bad key}}', 'text')).toBeUndefined();
  });
});
