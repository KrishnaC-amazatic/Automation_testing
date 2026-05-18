/**
 * global-setup.ui.ts
 * Runs once before all UI tests.
 *
 * Logs in as the Sentinel admin and saves the authenticated browser storage
 * state to .ui-auth-state.json so every test worker reuses the session
 * without re-logging in.
 *
 * Required environment variables (set in .env or CI secrets):
 *   BASE_URL              – Sentinel web-app URL  (e.g. https://app.example.com)
 *   SENTINEL_EMAIL        – Admin login email
 *   SENTINEL_PASSWORD     – Admin login password
 *
 * If SENTINEL_EMAIL / SENTINEL_PASSWORD are not set the setup is skipped and
 * tests rely on an already-saved .ui-auth-state.json (useful for local dev
 * where the developer is already logged in via a stored profile).
 */
import { chromium, FullConfig } from '@playwright/test';
import path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export const UI_AUTH_STATE = path.resolve(__dirname, '.ui-auth-state.json');

const BASE_URL = (process.env.BASE_URL || process.env.SENTINEL_BASE_URL || '').replace(/\/$/, '');
const EMAIL    = process.env.SENTINEL_EMAIL    || '';
const PASSWORD = process.env.SENTINEL_PASSWORD || '';

export default async function globalSetupUI(_config: FullConfig): Promise<void> {
  if (!EMAIL || !PASSWORD || !BASE_URL) {
    console.warn(
      '[UI global-setup] BASE_URL / SENTINEL_EMAIL / SENTINEL_PASSWORD not set — ' +
      'skipping login. Tests will use an existing .ui-auth-state.json if present.',
    );
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    console.log(`[UI global-setup] Logging in as ${EMAIL} at ${BASE_URL}`);
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30_000 });

    // ── Fill credentials ──────────────────────────────────────────────────────
    // Adjust selectors below to match the actual login form.
    await page.getByRole('textbox', { name: /email|username/i }).fill(EMAIL);
    await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD);
    await page.getByRole('button',  { name: /sign in|log in|login/i }).click();

    // Wait until we are redirected away from the login page
    await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    await context.storageState({ path: UI_AUTH_STATE });
    console.log(`[UI global-setup] Auth state saved to ${UI_AUTH_STATE}`);
  } finally {
    await browser.close();
  }
}
