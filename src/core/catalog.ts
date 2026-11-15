import type { DocumentKind, DocumentNode } from './document';
import { HtmlContentModel } from './html-content-model';

export type BlockType =
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'section'
  | 'columns'
  | 'divider'
  | 'spacer'
  | 'footer'
  | 'form'
  | 'html';

export interface BlockProperty {
  readonly name: string;
  readonly labelKey: string;
  readonly kind: 'text' | 'attribute' | 'style';
}

export interface BlockDescriptor {
  readonly type: BlockType;
  readonly labelKey: string;
  readonly kinds: readonly DocumentKind[];
  readonly tag: string;
  readonly canContainChildren: boolean;
  readonly properties: readonly BlockProperty[];
}

/** Properties advertised in the inspector are the same capabilities accepted by commands. */
const styleLabels: Readonly<Record<string, string>> = {
  color: 'color',
  'background-color': 'background',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'line-height': 'lineHeight',
  'letter-spacing': 'letterSpacing',
  'text-align': 'alignment',
  padding: 'padding',
  margin: 'margin',
  border: 'border',
  'border-color': 'borderColor',
  'border-width': 'borderWidth',
  'border-style': 'borderStyle',
  'border-radius': 'radius',
  width: 'width',
  'max-width': 'maxWidth',
  height: 'height',
  gap: 'gap',
  'column-gap': 'columnGap',
  'row-gap': 'rowGap',
  'grid-template-columns': 'columns',
  'align-items': 'verticalAlignment',
  'justify-content': 'horizontalAlignment',
  'object-fit': 'imageFit',
};
const styleProperties = (names: readonly string[]): readonly BlockProperty[] =>
  names.map((name) => ({
    name,
    kind: 'style',
    labelKey: `properties.${styleLabels[name] ?? name.replaceAll('-', '')}`,
  }));
const attributeProperties = (names: readonly string[]): readonly BlockProperty[] =>
  names.map((name) => ({
    name,
    kind: 'attribute',
    labelKey: `properties.${({ src: 'imageUrl', alt: 'alternativeText', href: 'link', 'aria-label': 'accessibleLabel' } as Readonly<Record<string, string>>)[name] ?? name}`,
  }));
const sides = ['top', 'right', 'bottom', 'left'];
const boxStyles = [
  'padding',
  'margin',
  ...sides.flatMap((side) => [`padding-${side}`, `margin-${side}`]),
  'border',
  'border-color',
  'border-width',
  'border-style',
  'border-radius',
  'width',
  'max-width',
  'height',
];
const textStyles = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  ...boxStyles,
];
const containerStyles = [
  'background-color',
  'text-align',
  ...boxStyles,
  'gap',
  'column-gap',
  'row-gap',
  'grid-template-columns',
  'align-items',
  'justify-content',
];
const containerProperties: readonly BlockProperty[] = Object.freeze(
  styleProperties(containerStyles).map((property) => Object.freeze(property)),
);
const textProperty: BlockProperty = { name: 'text', labelKey: 'properties.text', kind: 'text' };
const textProperties = [
  textProperty,
  ...styleProperties(textStyles),
  ...attributeProperties(['title', 'aria-label']),
];
const inlineTags = new Set([
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'a',
  'br',
  'small',
  'sup',
  'sub',
  'code',
]);
const richBlockTags = new Set([
  'p',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'hr',
]);
const descriptors: readonly BlockDescriptor[] = [
  {
    type: 'heading',
    labelKey: 'blocks.heading',
    kinds: ['email', 'page'],
    tag: 'h2',
    canContainChildren: false,
    properties: textProperties,
  },
  {
    type: 'text',
    labelKey: 'blocks.text',
    kinds: ['email', 'page'],
    tag: 'p',
    canContainChildren: false,
    properties: textProperties,
  },
  {
    type: 'image',
    labelKey: 'blocks.image',
    kinds: ['email', 'page'],
    tag: 'img',
    canContainChildren: false,
    properties: [
      ...attributeProperties(['src', 'alt', 'width', 'height', 'title', 'aria-label']),
      ...styleProperties([...boxStyles, 'object-fit']),
    ],
  },
  {
    type: 'button',
    labelKey: 'blocks.button',
    kinds: ['email', 'page'],
    tag: 'a',
    canContainChildren: false,
    properties: [...textProperties, ...attributeProperties(['href', 'target', 'rel'])],
  },
  {
    type: 'section',
    labelKey: 'blocks.section',
    kinds: ['email', 'page'],
    tag: 'section',
    canContainChildren: true,
    properties: containerProperties,
  },
  {
    type: 'columns',
    labelKey: 'blocks.columns',
    kinds: ['email', 'page'],
    tag: 'div',
    canContainChildren: true,
    properties: containerProperties,
  },
  {
    type: 'divider',
    labelKey: 'blocks.divider',
    kinds: ['email', 'page'],
    tag: 'hr',
    canContainChildren: false,
    properties: styleProperties([
      'border',
      'border-color',
      'border-width',
      'border-style',
      'width',
      'margin',
      'padding',
    ]),
  },
  {
    type: 'spacer',
    labelKey: 'blocks.spacer',
    kinds: ['email', 'page'],
    tag: 'div',
    canContainChildren: false,
    properties: styleProperties(['height', 'background-color']),
  },
  {
    type: 'footer',
    labelKey: 'blocks.footer',
    kinds: ['email', 'page'],
    tag: 'footer',
    canContainChildren: false,
    properties: textProperties,
  },
  {
    type: 'form',
    labelKey: 'blocks.form',
    kinds: ['page'],
    tag: 'div',
    canContainChildren: false,
    properties: styleProperties(boxStyles),
  },
  {
    type: 'html',
    labelKey: 'blocks.html',
    kinds: ['email', 'page'],
    tag: 'div',
    canContainChildren: false,
    properties: [],
  },
];

// Canonical capabilities are shared only after every nested mutable value is frozen.
for (const descriptor of descriptors) {
  Object.freeze(descriptor.kinds);
  for (const property of descriptor.properties) Object.freeze(property);
  Object.freeze(descriptor.properties);
  Object.freeze(descriptor);
}
Object.freeze(descriptors);

/** Recognition follows actual HTML structure; imported labels do not grant capabilities. */
export class BlockCatalog {
  private readonly model = new HtmlContentModel();

  descriptors(kind?: DocumentKind): readonly BlockDescriptor[] {
    return structuredClone(
      descriptors.filter((descriptor) => !kind || descriptor.kinds.includes(kind)),
    );
  }

  descriptor(type: BlockType): BlockDescriptor {
    const descriptor = descriptors.find((entry) => entry.type === type);
    if (!descriptor) throw new RangeError('UNKNOWN_BLOCK');
    return descriptor;
  }

  properties(node: DocumentNode): readonly BlockProperty[] {
    const descriptor = this.recognize(node);
    if (descriptor) return descriptor.properties;
    if (
      this.model.isStructuralContainer(node.tag ?? '') ||
      ['body', 'td', 'th', 'figure', 'details'].includes(node.tag ?? '')
    )
      return containerProperties;
    return [];
  }

  acceptsProperty(node: DocumentNode, name: string, kind: BlockProperty['kind']): boolean {
    return this.properties(node).some(
      (property) => property.name === name && property.kind === kind,
    );
  }

  recognize(node: DocumentNode): BlockDescriptor | undefined {
    if (node.type !== 'element') return undefined;
    const tag = node.tag?.toLowerCase();
    if (
      tag === 'p' &&
      !this.hasContent(node) &&
      /(?:^|;)\s*border-(?:top|bottom)\s*:/i.test(node.attrs?.style ?? '')
    )
      return this.descriptor('divider');
    if (tag && ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag) && this.canEditRichText(node))
      return this.descriptor('heading');
    if (
      (tag === 'p' ||
        tag === 'summary' ||
        tag === 'figcaption' ||
        tag === 'blockquote' ||
        tag === 'pre' ||
        tag === 'li' ||
        (inlineTags.has(tag ?? '') && tag !== 'a' && tag !== 'br')) &&
      this.canEditRichText(node)
    )
      return this.descriptor('text');
    if (tag === 'img') return this.descriptor('image');
    if (tag === 'a' && this.canEditRichText(node)) return this.descriptor('button');
    if (tag === 'hr') return this.descriptor('divider');
    if ((tag === 'footer' || node.attrs?.role === 'contentinfo') && this.canEditRichText(node))
      return this.descriptor('footer');
    if (tag === 'div' && node.attrs?.['data-host-slot'] === 'form' && !(node.children ?? []).length)
      return this.descriptor('form');
    if (
      tag === 'div' &&
      !this.hasContent(node) &&
      /(?:^|;)\s*height\s*:/i.test(node.attrs?.style ?? '')
    )
      return this.descriptor('spacer');
    if (['div', 'section'].includes(tag ?? '') && this.isColumns(node))
      return this.descriptor('columns');
    if (
      (tag === 'div' || tag === 'td' || tag === 'th') &&
      this.canEditRichText(node) &&
      this.hasContent(node)
    )
      return this.descriptor('text');
    if (
      ['section', 'div', 'article', 'main', 'header', 'footer', 'figure', 'details'].includes(
        tag ?? '',
      )
    )
      return this.descriptor('section');
    return undefined;
  }

  canEditText(node: DocumentNode): boolean {
    if (node.type === 'text') return true;
    if (
      node.type !== 'element' ||
      ![
        'p',
        'div',
        'td',
        'th',
        'span',
        'strong',
        'b',
        'em',
        'i',
        'u',
        's',
        'small',
        'sup',
        'sub',
        'code',
        'summary',
        'figcaption',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'a',
        'footer',
        'pre',
      ].includes(node.tag ?? '')
    )
      return false;
    return this.validRichText(node.children ?? [], false);
  }

  canEditRichText(node: DocumentNode): boolean {
    if (node.type === 'text') return true;
    if (node.type !== 'element') return false;
    return this.richTextAllowsBlocks(node)
      ? this.validRichText(node.children ?? [], true)
      : this.canEditText(node);
  }

  acceptsRichText(parent: DocumentNode, children: readonly DocumentNode[]): boolean {
    if (!this.canEditRichText(parent) || parent.type !== 'element') return false;
    if (parent.tag === 'a' && this.hasAnchor(children)) return false;
    return this.validRichText(children, this.richTextAllowsBlocks(parent));
  }

  richTextAllowsBlocks(node: DocumentNode): boolean {
    return (
      node.type === 'element' &&
      ['div', 'td', 'th', 'footer', 'blockquote', 'li'].includes(node.tag ?? '')
    );
  }

  acceptsChildren(parent: DocumentNode, children: readonly DocumentNode[]): boolean {
    if (
      parent.type !== 'element' ||
      children.some(
        (child) => child.type === 'doctype' || ['html', 'head', 'body'].includes(child.tag ?? ''),
      )
    )
      return false;
    if (!this.model.acceptsChildren(parent.tag ?? '', children)) return false;
    if (
      this.model.isStructuralContainer(parent.tag ?? '') ||
      ['body', 'td', 'th'].includes(parent.tag ?? '')
    )
      return true;
    if (this.canEditRichText(parent) && this.richTextAllowsBlocks(parent))
      return this.validRichText(children, true);
    return this.recognize(parent)?.canContainChildren === true;
  }

  acceptsRootChildren(children: readonly DocumentNode[]): boolean {
    return children.every(
      (child) =>
        child.type !== 'doctype' &&
        !['html', 'head', 'body'].includes(child.tag ?? '') &&
        this.model.accepts('body', child),
    );
  }

  private validRichText(nodes: readonly DocumentNode[], blockAllowed: boolean): boolean {
    for (const node of nodes) {
      if (node.type === 'text') continue;
      if (node.type !== 'element') return false;
      const tag = node.tag ?? '';
      if (!inlineTags.has(tag) && !(blockAllowed && richBlockTags.has(tag))) return false;
      if (Object.keys(node.attrs ?? {}).some((name) => name.toLowerCase().startsWith('on')))
        return false;
      if (
        (tag === 'ul' || tag === 'ol') &&
        (node.children ?? []).some(
          (child) =>
            !(child.type === 'element' && child.tag === 'li') &&
            !(child.type === 'text' && !child.value?.trim()),
        )
      )
        return false;
      if (!this.validRichText(node.children ?? [], ['li', 'ul', 'ol', 'blockquote'].includes(tag)))
        return false;
      if (tag === 'a' && this.hasAnchor(node.children ?? [])) return false;
    }
    return true;
  }

  private isColumns(node: DocumentNode): boolean {
    const style = node.attrs?.style ?? '';
    return (
      /(?:^|;)\s*display\s*:\s*(?:grid|flex)\s*(?:;|$)/i.test(style) ||
      ((node.attrs?.class ?? '').split(/\s+/).includes('columns') &&
        (node.children ?? []).filter((child) => child.type === 'element').length > 1)
    );
  }

  private hasContent(node: DocumentNode): boolean {
    return (node.children ?? []).some(
      (child) => child.type === 'element' || (child.type === 'text' && !!child.value?.trim()),
    );
  }

  private hasAnchor(nodes: readonly DocumentNode[]): boolean {
    return nodes.some((node) => node.tag === 'a' || this.hasAnchor(node.children ?? []));
  }

  create(type: BlockType, id: string, kind: DocumentKind): DocumentNode {
    const descriptor = this.descriptor(type);
    if (!descriptor.kinds.includes(kind)) throw new RangeError('BLOCK_NOT_SUPPORTED_FOR_KIND');
    const base: DocumentNode = {
      id,
      type: 'element',
      tag: descriptor.tag,
      metadata: { blockType: type },
    };
    switch (type) {
      case 'heading':
        return { ...base, children: [{ id: `${id}-text`, type: 'text', value: 'Título' }] };
      case 'text':
        return {
          ...base,
          children: [{ id: `${id}-text`, type: 'text', value: 'Escreva seu conteúdo.' }],
        };
      case 'button':
        return {
          ...base,
          attrs: {
            href: '#',
            style:
              'display:inline-block;padding:12px 24px;background-color:#0f766e;color:#ffffff;text-decoration:none',
          },
          children: [{ id: `${id}-text`, type: 'text', value: 'Saiba mais' }],
        };
      case 'image':
        return { ...base, attrs: { alt: 'Imagem', width: '600' } };
      case 'columns':
        return {
          ...base,
          attrs: { style: 'display:grid;grid-template-columns:1fr 1fr;gap:16px' },
          children: [
            this.create('text', `${id}-left`, kind),
            this.create('text', `${id}-right`, kind),
          ],
        };
      case 'spacer':
        return { ...base, attrs: { role: 'presentation', style: 'height:24px' }, children: [] };
      case 'footer':
        return {
          ...base,
          children: [
            { id: `${id}-text`, type: 'text', value: '{{workspace.name}} · {{unsubscribe_url}}' },
          ],
        };
      case 'form':
        return { ...base, attrs: { 'data-host-slot': 'form' }, children: [] };
      default:
        return { ...base, children: [] };
    }
  }
}
