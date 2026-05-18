/**
 * playwright.ui.config.ts
 * Separate Playwright configuration for the Sentinel UI functional tests.
 *
 * Run UI tests:           npx playwright test --config=playwright.ui.config.ts
 * Open last HTML report:  npx playwright show-report ui-reports/html
 *
 * This config is intentionally kept separate from playwright.config.ts
 * (which drives the AI-service / extension prompt tests) so the two
 * suites can be executed and reported independently.
 */
import { defineConfig } from '@playwright/test';
import path from 'path';
import * as dotenv from 'dotenv';
import { UI_AUTH_STATE } from './global-setup.ui';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const BASE_URL = (
  process.env.BASE_URL ||
  process.env.SENTINEL_BASE_URL ||
  'http://localhost:3000'
).replace(/\/$/, '');

export default defineConfig({
  // ── Test discovery ─────────────────────────────────────────────────────────
  testDir: './UI_tests',
  testMatch: '**/*.spec.ts',

  // ── Timing ─────────────────────────────────────────────────────────────────
  timeout: 60_000,        // 1 min per test
  retries: 1,             // one automatic retry on flaky UI behaviour
  workers: 2,             // run 2 spec files in parallel

  // ── Auth setup (login once, share session) ─────────────────────────────────
  globalSetup: require.resolve('./global-setup.ui'),

  // ── Reporters ──────────────────────────────────────────────────────────────
  // HTML report goes to ui-reports/html/  (kept separate from the default
  // playwright-report/ used by the extension tests).
  reporter: [
    ['list'],
    ['html', { outputFolder: 'ui-reports/html', open: 'never' }],
    ['json', { outputFile: 'ui-reports/results.json' }],
  ],

  // ── Shared test options ────────────────────────────────────────────────────
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',

    // Reuse the authenticated session saved by global-setup.ui.ts
    storageState: UI_AUTH_STATE,
  },

  // ── Test output folder ─────────────────────────────────────────────────────
  outputDir: 'ui-test-results',

  // ── Projects (one per logical test suite) ─────────────────────────────────
  projects: [
    {
      name: 'ui-chromium',
      use: {
        channel: 'chromium',
      },
    },
  ],
});
