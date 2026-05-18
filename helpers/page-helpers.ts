import { Page } from '@playwright/test';

/**
 * Base URL for the Sentinel web application.
 * Set via BASE_URL or SENTINEL_BASE_URL environment variable.
 * Example: https://app.example.com
 */
const BASE_URL = (
  process.env.BASE_URL ||
  process.env.SENTINEL_BASE_URL ||
  'http://localhost:3000'
).replace(/\/$/, '');

/**
 * Navigate to a Sentinel app path (e.g. '/policies', '/org').
 * Waits for domcontentloaded before returning.
 */
export async function navigateTo(page: Page, path: string): Promise<void> {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

/**
 * Exposed for tests that need to construct full URLs directly.
 */
export { BASE_URL };
