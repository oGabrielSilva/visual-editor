/**
 * Origin of the playground under test: the `baseURL` of the Playwright config which started it,
 * handed to the tests through the environment. Nothing in them names a port of its own, so a
 * run on another port never reaches a server it did not start.
 */
const origin = process.env.VISUAL_EDITOR_E2E_ORIGIN;
if (!origin) throw new Error('VISUAL_EDITOR_E2E_ORIGIN is set by playwright.config.ts');

export const E2E_ORIGIN: string = new URL(origin).origin;
