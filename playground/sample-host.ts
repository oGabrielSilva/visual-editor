import type { EditorImagePicker, EditorVariable } from '../src/vue/public';

/**
 * What a host application supplies to the editor, in a clearly fictitious form: a small image
 * library served by the playground itself and a catalog of variables. Nothing here reaches the
 * network outside this page.
 */
export interface SampleImage {
  readonly id: string;
  readonly file: string;
  readonly alt: string;
}

export const SAMPLE_IMAGES: readonly SampleImage[] = [
  { id: 'sample-aurora', file: 'aurora.svg', alt: 'Paisagem em tons de verde' },
  { id: 'sample-coral', file: 'coral.svg', alt: 'Formas em tons de coral' },
  { id: 'sample-indigo', file: 'indigo.svg', alt: 'Formas em tons de anil' },
  { id: 'sample-ambar', file: 'ambar.svg', alt: 'Paisagem em tons de âmbar' },
];

export const sampleImageUrl = (image: SampleImage): string =>
  new URL(`samples/${image.file}`, window.location.href).href;

/** A picker which resolves when the person chooses in the dialog the playground shows. */
export class SampleImageLibrary implements EditorImagePicker {
  #resolve: ((image: SampleImage | undefined) => void) | undefined;

  constructor(private readonly open: (visible: boolean) => void) {}

  pickImage(): Promise<{ id: string; url: string; alt: string } | undefined> {
    this.#resolve?.(undefined);
    this.open(true);
    return new Promise((resolve) => {
      this.#resolve = (image) =>
        resolve(image ? { id: image.id, url: sampleImageUrl(image), alt: image.alt } : undefined);
    });
  }

  /** Stands for an upload: the playground stores nothing and answers with a library image. */
  uploadImage(file: File): Promise<{ id: string; url: string; alt: string }> {
    const image = SAMPLE_IMAGES[file.size % SAMPLE_IMAGES.length] ?? SAMPLE_IMAGES[0]!;
    return Promise.resolve({ id: image.id, url: sampleImageUrl(image), alt: file.name });
  }

  choose(image: SampleImage | undefined): void {
    const resolve = this.#resolve;
    this.#resolve = undefined;
    this.open(false);
    resolve?.(image);
  }
}

export const SAMPLE_VARIABLES: readonly EditorVariable[] = [
  { key: 'contact.firstName', label: 'Nome de exemplo', purpose: 'text', group: 'Contato' },
  { key: 'contact.lastName', label: 'Sobrenome de exemplo', purpose: 'text', group: 'Contato' },
  { key: 'contact.email', label: 'E-mail de exemplo', purpose: 'text', group: 'Contato' },
  { key: 'contact.city', label: 'Cidade de exemplo', purpose: 'text', group: 'Contato' },
  { key: 'company.name', label: 'Nome da empresa de exemplo', purpose: 'text', group: 'Empresa' },
  { key: 'company.segment', label: 'Segmento de exemplo', purpose: 'text', group: 'Empresa' },
  {
    key: 'workspace.name',
    label: 'Nome da conta de exemplo',
    purpose: 'text',
    group: 'Conta',
  },
  { key: 'workspace.address', label: 'Endereço de exemplo', purpose: 'text', group: 'Conta' },
  { key: 'profileUrl', label: 'Página do perfil de exemplo', purpose: 'url', group: 'Links' },
  {
    key: 'unsubscribeUrl',
    label: 'Link de descadastro de exemplo',
    purpose: 'url',
    group: 'Links',
  },
  {
    key: 'preferencesUrl',
    label: 'Link de preferências de exemplo',
    purpose: 'url',
    group: 'Links',
  },
];

export const SAMPLE_URL_PLACEHOLDERS: readonly string[] = SAMPLE_VARIABLES.filter(
  (variable) => variable.purpose === 'url',
).map((variable) => `{{${variable.key}}}`);
