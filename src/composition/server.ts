import { EditorFactory } from './factory';
import type { EditorOptions } from './factory';
import { NodeMjmlCompiler } from '../compilation/node-compiler';
import { BlockEditorFactory } from './block-factory';
import type { BlockToolkit, BlockToolkitOptions } from './block-factory';

const serverCompiler = (): NodeMjmlCompiler =>
  new NodeMjmlCompiler(new URL(/* @vite-ignore */ './server-worker.js', import.meta.url));

export function createServerEditor(options?: EditorOptions) {
  return new EditorFactory(serverCompiler).create(options);
}

/**
 * Parse, generate, compile and convert block pieces (schema 2) on the server, the source of
 * truth: the e-mail is compiled by the isolated Node worker.
 */
export function createServerBlockToolkit(options?: BlockToolkitOptions): BlockToolkit {
  return new BlockEditorFactory(serverCompiler).toolkit(options);
}
export { NodeMjmlCompiler } from '../compilation/node-compiler';
export { EditorFactory, InitialDocumentError } from './factory';
export type { EditorOptions, EditorInstance } from './factory';
export { EditorDocument, DOCUMENT_LIMITS } from '../core/document';
export type {
  EditorDocumentData,
  DocumentNode,
  SourceInput,
  Diagnostic,
  DiagnosticSeverity,
} from '../core/document';
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
export { UrlPolicy } from '../security/url-policy';
export { HtmlDocumentAssembler } from '../renderers/preview-document';
export { BlockEditorFactory } from './block-factory';
export type { BlockCompiler, BlockToolkit, BlockToolkitOptions } from './block-factory';
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
  GlobalStyles,
} from '../core/block-document';
export { parseAnyDocument } from '../core/any-document';
export type { AnyDocument } from '../core/any-document';
export type { BlockStorePort } from '../application/block-session';
export { BlockDefinitionRegistry } from '../blocks/definitions';
export { BlockConversionError } from '../blocks/conversion';
export type { OutputMode } from '../blocks/block-type';
export { GeneratedMjml } from '../compilation/generated-mjml';
export { BlockTemplateCatalog } from '../templates/blocks/catalog';
export type { BlockTemplateDescriptor } from '../templates/blocks/catalog';
export { BlockContentGuard } from '../blocks/content-guard';
export { BlockMjmlGenerator } from '../blocks/email-generator';
export { BlockPageGenerator } from '../blocks/page-generator';
export { BlockEmailRenderer } from '../blocks/email-renderer';
export { BlockToHtmlConversion } from '../blocks/conversion';
export { BlockChecker, GMAIL_CLIP_BYTES, GMAIL_NEAR_CLIP_BYTES } from '../blocks/block-checks';
export type { BlockCheck, BlockCheckCode } from '../blocks/block-checks';
export { BLOCK_DEVICES } from '../core/block-document';
export type { BlockDevice } from '../core/block-document';
