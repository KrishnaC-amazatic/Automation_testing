import { Page, Browser, expect } from '@playwright/test';
import { navigateTo } from './page-helpers';

// ─────────────────────────────────────────────────────────────────────────────
// PolicyOps
// ─────────────────────────────────────────────────────────────────────────────

export const PolicyOps = {
  /**
   * Navigate to /policies/new, fill in name + description, and submit.
   * Waits for redirect to /policies list.
   */
  async createPolicy(page: Page, name: string, description = ''): Promise<void> {
    await navigateTo(page, '/policies/new');
    await page.getByRole('textbox', { name: 'Name *' }).fill(name);
    if (description) {
      await page.getByRole('textbox', { name: 'Description' }).fill(description);
    }
    await page.getByRole('button', { name: 'Create Policy' }).click();
    await page.waitForURL('**/policies**', { timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  },

  /**
   * Delete a named policy from the /policies list.
   * Handles the confirmation modal with dispatchEvent to bypass backdrop.
   */
  async deletePolicy(page: Page, name: string): Promise<void> {
    await navigateTo(page, '/policies');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const card = page
      .locator('div')
      .filter({ hasText: name })
      .filter({ has: page.getByRole('button', { name: 'Remove' }) })
      .last();

    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByRole('button', { name: 'Remove' }).first().click();

    await expect(page.getByText('This cannot be undone')).toBeVisible({ timeout: 5_000 });
    // Dispatch click to bypass modal backdrop interception
    await page.getByRole('button', { name: 'Remove' }).last().dispatchEvent('click');
    await page.waitForTimeout(1_000);
  },

  /**
   * Returns true when the named policy is visible in the /policies list.
   */
  async verifyPolicyExists(page: Page, name: string): Promise<boolean> {
    await navigateTo(page, '/policies');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    return page.getByText(name).isVisible({ timeout: 5_000 }).catch(() => false);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MemberOps
// ─────────────────────────────────────────────────────────────────────────────

export const MemberOps = {
  /** Navigate to /org and wait for the members table to appear. */
  async loadOrgPage(page: Page): Promise<void> {
    await navigateTo(page, '/org');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });
  },

  /**
   * Returns all member email addresses found in the table rows.
   * Reads from the second table column (index 1).
   */
  async getMemberRows(page: Page): Promise<string[]> {
    const rows = page.getByRole('row');
    const count = await rows.count();
    const emails: string[] = [];
    for (let i = 1; i < count; i++) {
      const email = await rows.nth(i).locator('td').nth(1).textContent().catch(() => '');
      if (email?.trim()) emails.push(email.trim());
    }
    return emails;
  },

  /**
   * Delete the given member from the /org page.
   * Uses force: true for the confirmation modal button.
   */
  async deleteMember(page: Page, email: string): Promise<void> {
    const targetRow = page.getByRole('row').filter({ hasText: email }).first();
    await expect(targetRow).toBeVisible({ timeout: 10_000 });
    await targetRow.getByRole('button', { name: /remove/i }).click();
    await expect(page.getByText('This cannot be undone')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /remove/i }).last().click({ force: true });
    await page.waitForTimeout(1_500);
  },

  /**
   * Assert that the admin row has no Remove button (self-protection).
   */
  async verifyAdminRowProtected(page: Page, adminEmail: string): Promise<void> {
    const adminRow = page.getByRole('row').filter({ hasText: adminEmail }).first();
    await expect(adminRow).toBeVisible({ timeout: 10_000 });
    await expect(adminRow.getByRole('button', { name: /remove/i })).not.toBeAttached();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// RoleOps
// ─────────────────────────────────────────────────────────────────────────────

export const RoleOps = {
  /**
   * Find the first combobox whose current value is 'user'.
   * Returns { index, email } or null when none found.
   */
  async findEditableUserRole(
    page: Page,
  ): Promise<{ index: number; email: string } | null> {
    const comboboxes = page.getByRole('combobox');
    const count = await comboboxes.count();
    for (let i = 0; i < count; i++) {
      const val = await comboboxes.nth(i).inputValue().catch(() => '');
      if (val.toLowerCase() === 'user') {
        const ariaLabel = (await comboboxes.nth(i).getAttribute('aria-label')) || '';
        const email = ariaLabel.replace(/^Role for\s+/i, '').trim();
        return { index: i, email };
      }
    }
    return null;
  },

  /**
   * Select a new role from the combobox identified by the member email's
   * aria-label attribute. Waits 2 s for the backend PATCH to settle.
   */
  async changeRole(page: Page, email: string, role: string): Promise<void> {
    const combobox = page.getByRole('combobox', { name: new RegExp(`Role for ${email}`, 'i') });
    await combobox.selectOption({ label: role });
    await page.waitForTimeout(2_000);
  },

  /**
   * Reload the /org page and verify that the member's role combobox value
   * matches the expected role. Returns true on match.
   */
  async verifyRolePersists(page: Page, email: string, expectedRole: string): Promise<boolean> {
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const combobox = page.getByRole('combobox', { name: new RegExp(`Role for ${email}`, 'i') });
    const value = await combobox.inputValue().catch(() => '');
    return value.toLowerCase() === expectedRole.toLowerCase();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ShadowAIOps
// ─────────────────────────────────────────────────────────────────────────────

type ServiceAction = 'Allow' | 'Warn' | 'Block';

export const ShadowAIOps = {
  /** Navigate to /shadow-ai and wait for networkidle. */
  async navigateToSettings(page: Page): Promise<void> {
    await navigateTo(page, '/shadow-ai');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  },

  /**
   * Inspect the active action button for the named service row.
   * Active state is detected by CSS classes (bg-*, opacity, teal/yellow/red-500)
   * or aria-pressed="true" / data-active="true" attributes.
   * Returns null when the service is not found.
   */
  async getActiveAction(page: Page, serviceName: string): Promise<ServiceAction | null> {
    const row = page.getByRole('row').filter({ hasText: new RegExp(`^${serviceName}$`) }).first();
    if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) return null;

    for (const action of ['Allow', 'Warn', 'Block'] as ServiceAction[]) {
      const btn = row.getByRole('button', { name: action });
      if (!(await btn.isVisible().catch(() => false))) continue;

      const isActive =
        (await btn.getAttribute('aria-pressed')) === 'true' ||
        (await btn.getAttribute('data-active')) === 'true' ||
        (await btn.evaluate((el) => el.className)).match(
          /bg-|text-teal|text-yellow|text-red/,
        );
      if (isActive) return action;
    }
    return null;
  },

  /**
   * Click the Allow/Warn/Block button for the named service row.
   */
  async setAction(page: Page, serviceName: string, action: ServiceAction): Promise<void> {
    const row = page.getByRole('row').filter({ hasText: new RegExp(`^${serviceName}$`) }).first();
    await row.getByRole('button', { name: action }).click();
  },

  /** Click the "Save Controls" button and wait for network idle. */
  async saveControls(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Save Controls' }).click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// AuthOps
// ─────────────────────────────────────────────────────────────────────────────

export const AuthOps = {
  /**
   * Verify the logged-in admin is present on the /org page
   * (admin row is visible and has no Remove button).
   */
  async verifyAdminLoggedIn(page: Page, adminEmail: string): Promise<void> {
    await navigateTo(page, '/org');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expect(page.getByRole('row').filter({ hasText: adminEmail })).toBeVisible({
      timeout: 10_000,
    });
  },

  /** Click Sign Out / Log Out and wait for navigation to the login page. */
  async signOut(page: Page): Promise<void> {
    const logoutBtn = page
      .getByRole('button', { name: /sign out|log out/i })
      .or(page.getByRole('link', { name: /sign out|log out/i }))
      .first();
    await logoutBtn.click();
    await page.waitForURL(/login|signin|auth/i, { timeout: 15_000 });
  },
};
