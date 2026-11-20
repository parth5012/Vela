import { defineConfig } from '@playwright/test';

/**
 * Advisory visual regression suite for the Expo web build (#678).
 *
 * Runs deterministic visual baseline comparisons via `toHaveScreenshot()`
 * at standard mobile viewport 360×640 across normal and reduced-motion modes.
 *
 * This suite is advisory and decoupled from functional verification.
 * Canonical baselines are generated in the Linux CI environment.
 */

const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT || 8081);
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8123);
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e/visual',
  snapshotDir: './e2e/visual/snapshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: isCI,
  reporter: [['list']],
  timeout: 180_000,
  expect: {
    timeout: 60_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    viewport: { width: 360, height: 640 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      args: ['--disable-dev-shm-usage'],
    },
  },
  projects: [
    {
      name: 'visual-normal',
      use: {
        viewport: { width: 360, height: 640 },
        contextOptions: {
          reducedMotion: 'no-preference',
        },
      },
    },
    {
      name: 'visual-reduced-motion',
      use: {
        viewport: { width: 360, height: 640 },
        contextOptions: {
          reducedMotion: 'reduce',
        },
      },
    },
  ],
  webServer: [
    {
      command: `uv run python -m agent.testing.e2e_server --port ${BACKEND_PORT}`,
      cwd: '../backend',
      url: `http://127.0.0.1:${BACKEND_PORT}/_e2e/health`,
      timeout: 240_000,
      reuseExistingServer: !isCI,
      env: { VELA_E2E: '1', VELA_E2E_PORT: String(BACKEND_PORT) },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npx expo start --web --port ${CLIENT_PORT}`,
      cwd: '.',
      url: `http://127.0.0.1:${CLIENT_PORT}`,
      timeout: 300_000,
      reuseExistingServer: !isCI,
      env: { CI: '1', EXPO_PUBLIC_E2E: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
