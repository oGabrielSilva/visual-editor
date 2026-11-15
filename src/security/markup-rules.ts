import { UrlPolicy } from './url-policy';

/** What an e-mail may not carry and a page is merely told it carries. */
export type ActiveMarkup = 'script' | 'embed' | 'handler' | 'url' | 'style';

/** Elements which bring another document or program into the one which holds them. */
const EMBEDS: ReadonlySet<string> = new Set([
  'iframe',
  'object',
  'embed',
  'applet',
  'frame',
  'portal',
  'fencedframe',
]);
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'background',
  'poster',
  'cite',
  'longdesc',
  'xlink:href',
  'lowsrc',
  'dynsrc',
  'data',
  'codebase',
  'ping',
  'manifest',
]);
/** SMIL elements which write an attribute of the element they animate. */
const ANIMATIONS: ReadonlySet<string> = new Set([
  'set',
  'animate',
  'animatetransform',
  'animatemotion',
  'animatecolor',
]);
const ANIMATION_VALUES: readonly string[] = ['to', 'from', 'by', 'values'];
/**
 * The event handler content attributes of HTML, SVG and the old engines mail programs still
 * embed. A closed list: an attribute an author named `onboarding` is not a handler.
 */
/**
 * Handlers outside the list which engines add under a prefix of their own (`onwebkit…`,
 * `onmoz…`, `onms…`) or as a `before`/`after` pair. Matching the shape keeps a future one of
 * these families out without treating an ordinary attribute such as `onboarding` as a handler.
 */
const ENGINE_HANDLER = /^on(?:webkit|moz|ms|before|after)[a-z]+$/;

const HANDLERS: ReadonlySet<string> = new Set(
  (
    'abort activate afterprint afterscriptexecute afterupdate animationcancel animationend ' +
    'animationiteration animationstart auxclick beforeactivate beforecopy beforecut ' +
    'beforedeactivate beforeeditfocus beforeinput beforematch beforepaste beforeprint ' +
    'beforescriptexecute beforetoggle beforeunload beforeupdate begin blur bounce cancel canplay ' +
    'canplaythrough cellchange change click close command contentvisibilityautostatechange ' +
    'contextlost contextmenu contextrestored controlselect copy cuechange cut dataavailable ' +
    'datasetchanged datasetcomplete dblclick deactivate drag dragend dragenter dragexit ' +
    'dragleave dragover dragstart drop durationchange emptied end ended error errorupdate ' +
    'filterchange finish focus focusin focusout formdata fullscreenchange fullscreenerror ' +
    'gesturechange gestureend gesturestart gotpointercapture hashchange help input invalid ' +
    'keydown keypress keyup languagechange layoutcomplete load loadeddata loadedmetadata ' +
    'loadstart losecapture lostpointercapture message messageerror mousedown mouseenter ' +
    'mouseleave mousemove mouseout mouseover mouseup mousewheel move moveend movestart offline ' +
    'online pagehide pagereveal pageshow pageswap paste pause play playing pointercancel ' +
    'pointerdown pointerenter pointerleave pointerlockchange pointerlockerror pointermove ' +
    'pointerout pointerover pointerrawupdate pointerup popstate progress propertychange ' +
    'ratechange readystatechange rejectionhandled repeat reset resize resizeend resizestart ' +
    'rowenter rowexit rowsdelete rowsinserted scroll scrollend scrollsnapchange ' +
    'scrollsnapchanging search securitypolicyviolation seeked seeking select selectionchange ' +
    'selectstart show slotchange stalled start stop storage submit suspend timeupdate toggle ' +
    'touchcancel touchend touchmove touchstart transitioncancel transitionend transitionrun ' +
    'transitionstart unhandledrejection unload volumechange waiting webkitanimationend ' +
    'webkitanimationiteration webkitanimationstart webkitfullscreenchange ' +
    'webkitfullscreenerror webkittransitionend wheel zoom'
  )
    .split(' ')
    .map((event) => `on${event}`),
);

/**
 * One classification of markup which runs or loads code, shared by the inventory, the e-mail
 * sanitizer and the scan of source kept as text. It decides nothing about publication.
 */
export class ActiveMarkupRules {
  constructor(private readonly urls = new UrlPolicy()) {}

  element(tag: string): Extract<ActiveMarkup, 'script' | 'embed'> | undefined {
    const name = tag.toLowerCase();
    if (name === 'script') return 'script';
    return EMBEDS.has(name) ? 'embed' : undefined;
  }

  /**
   * An element which is only active because of what its attributes say together: an HTML
   * import, a refresh to a code address, an animation which writes a code address into a link.
   */
  elementWith(
    tag: string,
    attributes: Readonly<Record<string, string>>,
  ): Extract<ActiveMarkup, 'embed' | 'url'> | undefined {
    const name = tag.toLowerCase();
    const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(attributes)) attrs[key.toLowerCase()] = value;
    if (name === 'link' && (attrs.rel ?? '').toLowerCase().split(/\s+/).includes('import'))
      return 'embed';
    if (name === 'meta' && (attrs['http-equiv'] ?? '').trim().toLowerCase() === 'refresh') {
      // `5; url=address`, with or without the name, quotes and spaces.
      const content = attrs.content ?? '';
      const separator = content.search(/[;,]/);
      let target = separator < 0 ? '' : content.slice(separator + 1).trim();
      if (/^url\s*=/i.test(target)) target = target.slice(target.indexOf('=') + 1).trim();
      target = target.replace(/^['"]/, '');
      return this.urls.isActive(target) ? 'url' : undefined;
    }
    if (
      ANIMATIONS.has(name) &&
      ['href', 'xlink:href'].includes((attrs.attributename ?? '').trim().toLowerCase()) &&
      ANIMATION_VALUES.some((key) =>
        (attrs[key] ?? '').split(';').some((value) => this.urls.isActive(value)),
      )
    )
      return 'url';
    return undefined;
  }

  /**
   * What sends an e-mail somewhere else or changes where its addresses point: any refresh
   * (with or without a target) and any `base`. Removed from e-mails and never written by the
   * editor; a page keeps them, as its author wrote them.
   */
  navigation(tag: string, attributes: Readonly<Record<string, string>>): 'url' | undefined {
    const name = tag.toLowerCase();
    if (name === 'base') return 'url';
    if (name !== 'meta') return undefined;
    const directive = Object.entries(attributes).find(
      ([key]) => key.toLowerCase() === 'http-equiv',
    )?.[1];
    return directive?.trim().toLowerCase() === 'refresh' ? 'url' : undefined;
  }

  attribute(name: string, value: string): Extract<ActiveMarkup, 'handler' | 'url'> | undefined {
    const attribute = name.toLowerCase();
    if (HANDLERS.has(attribute) || ENGINE_HANDLER.test(attribute)) return 'handler';
    return URL_ATTRIBUTES.has(attribute) && this.urls.isActive(value) ? 'url' : undefined;
  }

  /**
   * `on` followed by letters only, as every handler is and as any future one will be. The rule
   * for what the editor itself writes, which never needs an attribute of that shape.
   */
  handlerLike(name: string): boolean {
    const attribute = name.toLowerCase();
    if (attribute.length < 3 || !attribute.startsWith('on')) return false;
    return [...attribute.slice(2)].every((character) => character >= 'a' && character <= 'z');
  }

  /** URL attributes and what each loads, for the strict rule of what the editor writes. */
  urlPurpose(name: string): 'link' | 'image' | undefined {
    const attribute = name.toLowerCase();
    if (!URL_ATTRIBUTES.has(attribute)) return undefined;
    return ['src', 'background', 'poster', 'lowsrc', 'dynsrc'].includes(attribute)
      ? 'image'
      : 'link';
  }
}
