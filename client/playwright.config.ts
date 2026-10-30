import { defineConfig, devices } from '@playwright/test';

/**
 * Deterministic UI e2e for the Expo web build (#495).
 *
 * Both servers are real:
 *   - backend: the production FastAPI app with `FakeProvider` installed and a
 *     seeded SQLite DB (`backend/agent/testing/e2e_server.py`, `VELA_E2E=1`);
 *   - client:  the real Expo web dev server with `EXPO_PUBLIC_E2E=1`, which is
 *     the only thing that installs `globalThis.__VELA_E2E__`.
 *
 * No fetch mocks, no retries, one worker: a failure is a real failure.
 */

const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT || 8081);
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8123);
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e/ui',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: isCI,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      args: ['--disable-dev-shm-usage'],
    },
  },
  projects: [
    {
      name: 'expo-web-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Real app, real routes, real persistence — only the LLM is scripted.
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
      // Real Expo web dev server with the dev-only control hook enabled.
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
