import { installCanvasBridge } from './bridge';

// The bundle is the single script of the preview; its entry point is called once with the
// configuration which the host appends after it.
Object.defineProperty(globalThis, '__lyadsCanvas', { value: installCanvasBridge });
