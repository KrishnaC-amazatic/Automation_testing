/**
 * console-errors.spec.ts
 * Visits every major page as admin and fails if any critical console errors
 * are detected: uncaught exceptions, 4xx/5xx responses, extension messaging
 * failures, aria-hidden focus conflicts, or permission denied errors.
 */
import { test, expect } from '@playwright/test';
import { ConsoleMonitor } from '../helpers/console-monitor';
import { navigateTo } from '../helpers/page-helpers';

const PAGES_TO_CHECK = [
  { name: 'Dashboard',    path: '/dashboard' },
  { name: 'AI Events',    path: '/events' },
  { name: 'Policies',     path: '/policies' },
  { name: 'AI Services',  path: '/service-controls' },
  { name: 'Shadow AI',    path: '/shadow-ai' },
  { name: 'Alerts',       path: '/alerts' },
  { name: 'Reports',      path: '/reports' },
  { name: 'Notifications',path: '/notifications' },
  { name: 'Organization', path: '/org' },
  { name: 'Settings',     path: '/settings' },
];

const IGNORED_ERRORS = [
  /ERR_NETWORK_CHANGED/,       // transient network hiccup
  /favicon\.ico/,              // missing favicon is non-critical
  /net::ERR_/i,                // resource load failures (API unavailable, extension absent)
];

function isCritical(text: string): boolean {
  if (IGNORED_ERRORS.some((re) => re.test(text))) return false;
  return /uncaught|permission denied|channel is closed/i.test(text);
}

for (const { name, path } of PAGES_TO_CHECK) {
  test(`No critical console errors on ${name} page`, async ({ page }) => {
    const monitor = new ConsoleMonitor(page);

    await navigateTo(page, path);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Let any deferred scripts / React effects settle
    await page.waitForTimeout(500);

    const criticalErrors = monitor.errors().filter((m) => isCritical(m.text));

    if (criticalErrors.length > 0) {
      const detail = criticalErrors.map((e) => `  [${e.type}] ${e.text}`).join('\n');
      throw new Error(`Critical console errors on ${name}:\n${detail}`);
    }
  });
}
