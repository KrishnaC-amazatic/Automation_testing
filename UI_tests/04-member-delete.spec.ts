/**
 * member-delete.spec.ts
 * 1. Organization page loads with members table
 * 2. Admin row has no Remove button (self-protection)
 * 3. Delete a non-admin member — FAILS if deletion does not work
 */
import { test, expect } from '@playwright/test';
import { navigateTo } from '../helpers/page-helpers';

const ADMIN_EMAIL = process.env.SENTINEL_ADMIN_EMAIL || 'amol.s@amazatic.com';

test.describe('Member deletion', () => {
  test('Organization page loads with members table', async ({ page }) => {
    await navigateTo(page, '/org');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // FAILS if page does not load properly
    await expect(page.getByRole('heading', { name: 'Organization', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  });

  test('Logged-in admin row has no Remove button (self-protection)', async ({ page }) => {
    await navigateTo(page, '/org');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });

    const selfRow = page.getByRole('row').filter({ hasText: ADMIN_EMAIL }).first();
    await expect(selfRow).toBeVisible({ timeout: 10_000 });

    // FAILS if admin row has a Remove button (self-protection is broken)
    await expect(selfRow.getByRole('button', { name: /remove/i })).not.toBeAttached();
  });

  test('Delete a member and confirm they are removed', async ({ page }) => {
    await navigateTo(page, '/org');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });

    // Find all rows that have a Remove button (excludes admin row)
    const rows = page.getByRole('row').filter({ has: page.getByRole('button', { name: /remove/i }) });
    const rowCount = await rows.count();

    if (rowCount === 0) {
      test.skip(true, 'No deletable members found (only admin exists).');
      return;
    }

    const targetRow = rows.first();
    const memberEmail = await targetRow.locator('td').nth(1).textContent().catch(() => 'unknown');

    // Safety: never delete the admin
    if (memberEmail?.includes(ADMIN_EMAIL)) {
      test.skip(true, 'Only admin member found — skipping to avoid deleting admin.');
      return;
    }

    // Click the Remove button to open confirmation modal
    await targetRow.getByRole('button', { name: /remove/i }).click();

    // Confirmation modal must appear — FAILS if modal never shows
    await expect(page.getByRole('button', { name: /remove/i }).last()).toBeVisible({ timeout: 10_000 });

    // Confirm deletion (normal click - tests REAL user interaction)
    // If modal backdrop blocks this click, test will FAIL ❌ (correctly showing the bug)
    await page.getByRole('button', { name: /remove/i }).last().click({ timeout: 10_000 });

    // Wait for UI to update
    await page.waitForTimeout(1_500);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // PASS if member row is gone, FAIL if member is still visible
    await expect(targetRow, `Member "${memberEmail}" was not deleted — row is still visible`).not.toBeVisible({ timeout: 10_000 });

    // Reload and confirm deletion persisted
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // FAIL if member reappeared after reload
    await expect(targetRow, `Member "${memberEmail}" reappeared after reload — deletion did not persist`).not.toBeVisible({ timeout: 10_000 });
  });
});

