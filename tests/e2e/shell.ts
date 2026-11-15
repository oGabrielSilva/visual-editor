import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** Locators of the shell around the piece, shared by the tests so the layout is named once. */
export class ShellDriver {
  constructor(readonly page: Page) {}

  root(): Locator {
    return this.page.locator('.visual-editor');
  }

  /** A tab of the left panel: Blocos, Modelos or Estrutura. */
  leftTab(name: 'Blocos' | 'Modelos' | 'Estrutura'): Locator {
    return this.page.locator('.editor-panel-tabs').getByRole('tab', { name, exact: true });
  }

  /** A tab of the properties panel: Conteúdo, Estilo or Avançado. */
  propertyTab(name: 'Conteúdo' | 'Estilo' | 'Avançado'): Locator {
    return this.page.locator('.editor-properties').getByRole('tab', { name, exact: true });
  }

  /** A row of the structure tree, by the text of its block. */
  treeItem(text: string | RegExp): Locator {
    return this.page.locator('.editor-structure').getByRole('treeitem').filter({ hasText: text });
  }

  async openStructure(): Promise<void> {
    await this.leftTab('Estrutura').click();
  }

  paletteBlock(name: string): Locator {
    return this.page.locator('.editor-palette-grid').getByRole('button', { name, exact: true });
  }

  mode(name: 'HTML' | 'Visual'): Locator {
    return this.page.locator('.editor-mode-switch').getByRole('button', { name, exact: true });
  }

  /** Chooses an entry of the Arquivo menu of the top bar. */
  async file(item: 'Importar arquivo' | 'Exportar HTML' | 'Exportar documento'): Promise<void> {
    await this.page.locator('.editor-file-menu').click();
    await this.page.getByRole('menuitem', { name: item, exact: true }).click();
  }

  /** A button of the header of the properties panel: move, duplicate, remove, parent. */
  blockAction(name: string): Locator {
    return this.page.locator('.editor-block-actions').getByRole('button', { name, exact: true });
  }

  feedback(): Locator {
    return this.page.locator('.editor-feedback');
  }

  /** The menu of a block, opened with the secondary button in the piece or in the tree. */
  menuItem(name: string): Locator {
    return this.page.getByRole('menuitem', { name, exact: true });
  }

  /** Inserts a variable through its searchable menu. */
  async insertVariable(scope: Locator, label: string): Promise<void> {
    await scope.getByRole('button', { name: 'Inserir variável', exact: true }).last().click();
    await this.page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click();
  }

  /** No bar, panel or path of the shell may need a horizontal scroll bar. */
  async expectNoHorizontalOverflow(): Promise<void> {
    const overflowing = await this.page.evaluate(() =>
      [
        '.editor-toolbar',
        '.editor-side-panel',
        '.editor-scroll',
        '.editor-canvas-breadcrumb',
        '.editor-canvas-text-bar',
        '.editor-statusbar',
        '.editor-tabs-list',
        '.visual-editor',
      ].flatMap((selector) =>
        [...document.querySelectorAll<HTMLElement>(selector)]
          .filter((element) => element.getClientRects().length)
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => `${selector} ${element.scrollWidth}>${element.clientWidth}`),
      ),
    );
    expect(overflowing).toEqual([]);
  }
}
