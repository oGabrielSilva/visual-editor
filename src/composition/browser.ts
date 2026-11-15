import { EditorFactory } from './factory';
import type { EditorOptions } from './factory';
import { BrowserMjmlCompiler } from '../compilation/browser-compiler';
import { BlockEditorFactory } from './block-factory';
import type {
  BlockEditorInstance,
  BlockEditorOptions,
  BlockToolkit,
  BlockToolkitOptions,
} from './block-factory';

export function createEditor(options?: EditorOptions) {
  return new EditorFactory(() => new BrowserMjmlCompiler()).create(options);
}

/** An editor of a block piece (schema 2), compiling e-mails in a browser worker. */
export function createBlockEditor(options?: BlockEditorOptions): BlockEditorInstance {
  return new BlockEditorFactory(() => new BrowserMjmlCompiler()).create(options);
}

/** Parse, generate, compile and convert block pieces in the browser, without an editor. */
export function createBlockToolkit(options?: BlockToolkitOptions): BlockToolkit {
  return new BlockEditorFactory(() => new BrowserMjmlCompiler()).toolkit(options);
}
export { EditorFactory, InitialDocumentError } from './factory';
export type { EditorOptions, EditorInstance } from './factory';
export {
  EditorDocument,
  EditorDocumentSchema,
  DocumentNodeSchema,
  DOCUMENT_LIMITS,
} from '../core/document';
export type {
  EditorDocumentData,
  DocumentNode,
  Diagnostic,
  DiagnosticSeverity,
  DocumentKind,
  SourceInput,
} from '../core/document';
export { EditorSession } from '../application/session';
export type { EditorState } from '../application/session';
export type {
  HostAdapters,
  StorePort,
  AssetPort,
  SlotsPort,
  AssetReference,
} from '../application/host';
export { ContentPolicy, ContentPolicyError } from '../security/policy';
export type { SanitizedDocument } from '../security/policy';
export type { ContentInventory, ExternalReference } from '../security/content-inventory';
export { HtmlDocumentCodec } from '../codecs/html';
export { CssDocumentCodec } from '../codecs/css';
export { BrowserMjmlCompiler } from '../compilation/browser-compiler';
export { PreviewDocument } from '../renderers/preview-document';
export { HtmlDocumentAssembler } from '../renderers/preview-document';
export { SelectionPreviewRenderer } from '../renderers/selection-preview';
export { UrlPolicy } from '../security/url-policy';
export { BlockEditorFactory } from './block-factory';
export type {
  BlockCompiler,
  BlockEditorInstance,
  BlockEditorOptions,
  BlockToolkit,
  BlockToolkitOptions,
} from './block-factory';
export {
  BlockDocument,
  BlockDocumentError,
  BlockDocumentSchema,
  BLOCK_DOCUMENT_LIMITS,
  BLOCK_NODE_TYPES,
} from '../core/block-document';
export type {
  Block,
  BlockDocumentData,
  BlockNodeType,
  BlockPropValue,
  BlockProps,
  BlockTarget,
  GlobalStyles,
  StylePatch,
} from '../core/block-document';
export { parseAnyDocument } from '../core/any-document';
export type { AnyDocument } from '../core/any-document';
export { BlockEditorSession } from '../application/block-session';
export type {
  BlockEditorState,
  BlockImageChoice,
  BlockStorePort,
} from '../application/block-session';
export { BlockDefinitionRegistry } from '../blocks/definitions';
export { GLOBAL_STYLE_GROUPS } from '../blocks/styles';
export { BlockConversionError } from '../blocks/conversion';
export type { OutputMode } from '../blocks/block-type';
export { GeneratedMjml } from '../compilation/generated-mjml';
export { BlockTemplateCatalog } from '../templates/blocks/catalog';
export type { BlockTemplateDescriptor } from '../templates/blocks/catalog';
export type { BlockPreviewInput } from '../renderers/marked-preview';
export { BlockContentGuard } from '../blocks/content-guard';
export { BlockMjmlGenerator } from '../blocks/email-generator';
export { BlockPageGenerator } from '../blocks/page-generator';
export { BlockEmailRenderer } from '../blocks/email-renderer';
export { BlockToHtmlConversion } from '../blocks/conversion';
export { BlockChecker, GMAIL_CLIP_BYTES, GMAIL_NEAR_CLIP_BYTES } from '../blocks/block-checks';
export type { BlockCheck, BlockCheckCode } from '../blocks/block-checks';
export type { BlockDevice } from '../core/block-document';
