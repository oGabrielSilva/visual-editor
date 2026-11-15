import type { RouterConfig } from '@nuxt/schema';

// Links to a section (`#instalar`) scroll smoothly and stop below the sticky header. People who
// ask for less motion jump straight to it.
export default {
  scrollBehavior(to, _from, saved) {
    if (saved) return saved;
    if (!to.hash) return { top: 0 };
    const reduced = import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const header = import.meta.client ? (document.querySelector('header')?.offsetHeight ?? 64) : 64;
    return { el: to.hash, top: header + 16, behavior: reduced ? 'auto' : 'smooth' };
  },
} satisfies RouterConfig;
