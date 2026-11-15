import { describe, expect, it } from 'vitest';
import { BlockCommandService } from '../../../src/vue/services/block-commands';
import type { BlockCommandPorts } from '../../../src/vue/services/block-commands';
import { blockMenuItems } from '../../../src/vue/services/block-menu';
import { LiveChangeGroup } from '../../../src/vue/services/live-change';
import { editor, regionId } from './support';

const setup = (html?: string, overrides: Partial<BlockCommandPorts> = {}) => {
  const instance = editor(html);
  const events: string[] = [];
  const ports: BlockCommandPorts = {
    controller: () => instance.controller,
    flush: async () => true,
    editText: (id) => events.push(`edit:${id}`),
    replaceImage: (id) => events.push(`image:${id}`),
    elementSource: (id) =>
      instance.selectionRenderer.elementSource(instance.controller.state().document, id),
    replaceElementSource: (id, source) =>
      instance.selectionRenderer.replaceElementSource(
        instance.controller.state().document,
        id,
        source,
      ),
    notify: (outcome) => events.push(outcome),
    ...overrides,
  };
  return { instance, events, commands: new BlockCommandService(ports) };
};
const html = (instance: ReturnType<typeof editor>): string =>
  instance.controller.state().source.html;

describe('BlockCommandService: one door for every block command', () => {
  it('offers the commands which make sense for the block and marks what is possible', () => {
    const { instance, commands } = setup();
    const paragraph = commands.items(regionId(instance, 'p'));
    expect(paragraph.map((item) => item.name)).toEqual([
      'editText',
      'selectParent',
      'insertBefore',
      'insertAfter',
      'duplicate',
      'moveUp',
      'moveDown',
      'editHtml',
      'copy',
      'paste',
      'remove',
    ]);
    expect(paragraph.find((item) => item.name === 'paste')?.enabled).toBe(false);
    expect(paragraph.find((item) => item.name === 'selectParent')?.enabled).toBe(true);
    const image = commands.items(regionId(instance, 'img')).map((item) => item.name);
    expect(image).toContain('replaceImage');
    expect(image).not.toContain('editText');
    const section = commands.items(regionId(instance, 'section'));
    expect(section.map((item) => item.name)).toContain('insertInside');
    expect(section.find((item) => item.name === 'selectParent')?.enabled).toBe(false);
    const menu = blockMenuItems(paragraph, (key) => key);
    expect(menu.find((entry) => entry.id === 'remove')).toMatchObject({ danger: true });
    expect(menu.find((entry) => entry.id === 'paste')).toMatchObject({ disabled: true });
  });

  it('moves, duplicates and selects the parent through the controller', async () => {
    const { instance, commands, events } = setup();
    const second = regionId(instance, 'p', 1);
    expect(await commands.run('moveUp', second)).toBe(true);
    expect(html(instance).indexOf('Segundo')).toBeLessThan(html(instance).indexOf('Primeiro'));
    expect(await commands.run('duplicate', regionId(instance, 'h2'))).toBe(true);
    expect(html(instance).match(/Título/g)).toHaveLength(2);
    instance.controller.select(regionId(instance, 'p'));
    expect(await commands.run('selectParent')).toBe(true);
    expect(instance.controller.state().selectedNodeId).toBe(regionId(instance, 'section'));
    expect(events.filter((event) => event === 'applied')).toHaveLength(2);
  });

  it('removes only after the confirmation, and never against another revision', async () => {
    const { instance, commands } = setup();
    const paragraph = regionId(instance, 'p');
    await commands.run('remove', paragraph);
    expect(commands.removal.value?.id).toBe(paragraph);
    expect(html(instance)).toContain('Primeiro');
    // The document changed while the question was open: the answer no longer applies.
    instance.controller.select(paragraph);
    instance.controller.updateStyle('color', '#112233');
    expect(await commands.confirmRemoval()).toBe(false);
    expect(html(instance)).toContain('Primeiro');
    await commands.run('remove', paragraph);
    expect(await commands.confirmRemoval()).toBe(true);
    expect(html(instance)).not.toContain('Primeiro');
    expect(commands.removal.value).toBeUndefined();
    expect(instance.controller.undo()).toBe(true);
    expect(html(instance)).toContain('Primeiro');
  });

  it('selects the block next to a removed one and gives the keyboard back to the piece', async () => {
    const { instance, commands } = setup();
    const first = regionId(instance, 'p', 0);
    const second = regionId(instance, 'p', 1);
    let returned = 0;
    await commands.run('remove', second, undefined, { returnFocus: () => (returned += 1) });
    expect(returned).toBe(0);
    expect(await commands.confirmRemoval()).toBe(true);
    expect(instance.controller.state().selectedNodeId).toBe(first);
    expect(returned).toBe(1);
  });

  it('hands the keyboard origin of a menu on to the picker it opens', async () => {
    const { instance, commands } = setup();
    const back = () => undefined;
    await commands.run('insertBefore', regionId(instance, 'p'), undefined, {
      keyboard: true,
      returnFocus: back,
    });
    expect(commands.insertion.value).toMatchObject({
      placement: 'before',
      keyboard: true,
      returnFocus: back,
    });
  });

  it('does not reopen a menu or the picker asked by the piece right after a dismissal', () => {
    let now = 0;
    const instance = editor();
    const commands = new BlockCommandService(
      {
        controller: () => instance.controller,
        flush: async () => true,
        editText: () => undefined,
        replaceImage: () => undefined,
        elementSource: () => undefined,
        replaceElementSource: () => undefined,
        notify: () => undefined,
      },
      () => now,
    );
    const id = regionId(instance, 'p');
    const anchor = { x: 1, y: 1, width: 1, height: 1 };
    commands.dismissed();
    now = 999;
    commands.openMenu(id, anchor, { fromPiece: true });
    commands.requestInsertion({ targetId: id, placement: 'after' }, true);
    expect(commands.menu.value).toBeUndefined();
    expect(commands.insertion.value).toBeUndefined();
    // The shell itself (the tree, a panel) is never held back.
    commands.openMenu(id, anchor);
    expect(commands.menu.value?.targetId).toBe(id);
    commands.closeMenu();
    now = 1_000;
    commands.openMenu(id, anchor, { fromPiece: true, keyboard: true });
    expect(commands.menu.value).toMatchObject({ targetId: id, keyboard: true });
  });

  it('copies a block and pastes it after another one as one history step', async () => {
    const { instance, commands, events } = setup();
    await commands.run('copy', regionId(instance, 'h2'));
    expect(commands.clipboard.value).toContain('Título');
    expect(events).toContain('copied');
    const revision = instance.controller.state().document.revision;
    expect(await commands.run('paste', regionId(instance, 'p', 1))).toBe(true);
    const source = html(instance);
    expect(source.match(/Título/g)).toHaveLength(2);
    expect(source.lastIndexOf('Título')).toBeGreaterThan(source.indexOf('Segundo'));
    expect(instance.controller.state().document.revision).toBe(revision + 1);
  });

  it('edits one element as HTML in a single step and leaves the rest of the source untouched', async () => {
    const { instance, commands } = setup(
      '<main>\n  <h1 class="a">Um</h1>\n  <p   data-x="1">Dois</p>\n</main>',
    );
    const before = html(instance);
    await commands.run('editHtml', regionId(instance, 'h1'));
    expect(commands.sourceEdit.value?.html).toBe('<h1 class="a">Um</h1>');
    const revision = instance.controller.state().document.revision;
    expect(await commands.applySource('<h2 class="b">Outro <em>texto</em></h2>')).toBe(true);
    expect(commands.sourceEdit.value).toBeUndefined();
    expect(html(instance)).toBe(
      before.replace('<h1 class="a">Um</h1>', '<h2 class="b">Outro <em>texto</em></h2>'),
    );
    expect(instance.controller.state().document.revision).toBe(revision + 1);
    expect(instance.controller.undo()).toBe(true);
    expect(html(instance)).toBe(before);
  });

  it('waits for the text being edited and refuses when it cannot be concluded', async () => {
    const { instance, commands, events } = setup(undefined, { flush: async () => false });
    expect(await commands.run('duplicate', regionId(instance, 'h2'))).toBe(false);
    expect(await commands.insert('heading')).toBe(false);
    expect(events).toEqual([]);
    expect(html(instance).match(/Título/g)).toHaveLength(1);
  });

  it('inserts a palette block at a destination, after the selection or at the end', async () => {
    const { instance, commands } = setup();
    expect(
      await commands.insert('heading', { targetId: regionId(instance, 'p'), placement: 'before' }),
    ).toBe(true);
    expect(html(instance).indexOf('Seu próximo título')).toBeLessThan(
      html(instance).indexOf('Primeiro'),
    );
    expect(await commands.insert('divider', 'end')).toBe(true);
    // The end of the content is the end of the single root section, not a place outside it.
    expect(html(instance).lastIndexOf('<hr')).toBeGreaterThan(html(instance).indexOf('<img'));
    expect(await commands.insert('not-a-block')).toBe(false);
  });

  it('does nothing in a read-only document except copying and selecting', async () => {
    const { instance, commands } = setup();
    const paragraph = regionId(instance, 'p');
    instance.session.setReadOnly(true);
    expect(await commands.run('duplicate', paragraph)).toBe(false);
    expect(await commands.run('remove', paragraph)).toBe(false);
    expect(commands.removal.value).toBeUndefined();
    expect(await commands.run('copy', paragraph)).toBe(true);
    expect(commands.items(paragraph).find((item) => item.name === 'remove')?.enabled).toBe(false);
  });
});

describe('LiveChangeGroup: a run of changes to one field is one history step', () => {
  it('replaces its own previous step and leaves one undo for the whole run', () => {
    const instance = editor();
    const live = new LiveChangeGroup(() => instance.controller);
    const id = regionId(instance, 'p');
    instance.controller.select(id);
    const before = html(instance);
    for (const value of ['1px', '12px', '120px'])
      expect(live.apply(`${id}:width`, () => instance.controller.updateStyle('width', value))).toBe(
        true,
      );
    expect(html(instance)).toContain('width:120px');
    expect(instance.controller.undo()).toBe(true);
    expect(html(instance)).toBe(before);
    expect(instance.controller.state().canUndo).toBe(false);
  });

  it('keeps the last accepted value when a later one is refused', () => {
    const instance = editor();
    const live = new LiveChangeGroup(() => instance.controller);
    const id = regionId(instance, 'p');
    instance.controller.select(id);
    expect(
      live.apply(`${id}:color`, () => instance.controller.updateStyle('color', '#112233')),
    ).toBe(true);
    expect(
      live.apply(`${id}:color`, () =>
        instance.controller.updateStyle('color', 'url(javascript:1)'),
      ),
    ).toBe(false);
    expect(html(instance)).toContain('#112233');
    expect(
      live.apply(`${id}:color`, () => instance.controller.updateStyle('color', '#445566')),
    ).toBe(true);
    expect(html(instance)).toContain('#445566');
    expect(html(instance)).not.toContain('#112233');
    instance.controller.undo();
    expect(html(instance)).not.toContain('#445566');
    expect(instance.controller.state().canUndo).toBe(false);
  });

  it('starts another step for another field, after close and after a foreign change', () => {
    const instance = editor();
    const live = new LiveChangeGroup(() => instance.controller);
    const id = regionId(instance, 'p');
    instance.controller.select(id);
    live.apply(`${id}:width`, () => instance.controller.updateStyle('width', '10px'));
    live.apply(`${id}:height`, () => instance.controller.updateStyle('height', '20px'));
    live.close();
    live.apply(`${id}:height`, () => instance.controller.updateStyle('height', '30px'));
    instance.controller.updateStyle('color', '#000000');
    live.apply(`${id}:height`, () => instance.controller.updateStyle('height', '40px'));
    let steps = 0;
    while (instance.controller.undo()) steps += 1;
    expect(steps).toBe(5);
  });
});
