import { defineConfig, devices } from '@playwright/test';

// Another origin may be given in the environment, so a run never meets a preview already on
// 6011. The proofs build their URLs from it (tests/e2e/origin.ts), never from a port of their own.
const origin = new URL(process.env.VISUAL_EDITOR_E2E_ORIGIN ?? 'http://127.0.0.1:6011').origin;
process.env.VISUAL_EDITOR_E2E_ORIGIN = origin;
const port = new URL(origin).port;
const viewport = { width: 1280, height: 800 };

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 1,
  use: { baseURL: origin, trace: 'retain-on-failure' },
  // The playground fits the editor in one screen below its bar of controls: 800 px of height
  // give the editing area the room the scenarios were written for.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
  ],
  webServer: {
    command:
      port === '6011'
        ? 'node .yarn/releases/yarn-4.18.0.cjs preview'
        : `node .yarn/releases/yarn-4.18.0.cjs vite preview --config vite.playground.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
