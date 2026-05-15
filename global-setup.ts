/**
 * Playwright Global Setup — runs once before any test worker starts.
 *
 * Purpose: seed the Gemini Chrome profile from the ChatGPT Chrome profile so
 * both parallel workers start with:
 *   • Cached Sentinel org policies (no cold-start fetch → SW stays Online)
 *   • A valid Sentinel auth token (no "Offline (N failures)" safe-fail mode)
 *
 * If the ChatGPT profile does not exist yet (first-ever run), the Gemini
 * profile is left empty — the spec will handle sign-in normally.
 */

import fs   from 'fs';
import path from 'path';

const SRC_PROFILE    = path.resolve(__dirname, '.playwright-user-data');
const DEST_GEMINI    = path.resolve(__dirname, '.playwright-user-data-gemini');
const DEST_CLAUDE    = path.resolve(__dirname, '.playwright-user-data-claude');

/** Recursively copy src → dest, skipping files/dirs that Chrome locks. */
function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src)) {
    // Skip lock files and singletons that cannot be shared between two Chrome instances
    if (['SingletonLock', 'SingletonCookie', 'SingletonSocket',
         'lockfile', '.lock', 'LOCK'].some(n => entry === n || entry.endsWith(n))) {
      continue;
    }
    const srcPath  = path.join(src, entry);
    const destPath = path.join(dest, entry);
    try {
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    } catch {
      // Ignore files Chrome has open (e.g. LevelDB log files)
    }
  }
}

export default async function globalSetup(): Promise<void> {
  if (!fs.existsSync(SRC_PROFILE)) {
    console.log('[global-setup] ChatGPT profile not found — skipping Gemini & Claude profile seed.');
    console.log('[global-setup] Run the ChatGPT spec once first so policies get cached.');
    return;
  }

  console.log('[global-setup] Seeding Gemini Chrome profile from ChatGPT profile...');
  console.log(`[global-setup]   src : ${SRC_PROFILE}`);
  console.log(`[global-setup]   dest: ${DEST_GEMINI}`);
  copyDir(SRC_PROFILE, DEST_GEMINI);
  console.log('[global-setup] ✓ Gemini profile seeded.');

  console.log('[global-setup] Seeding Claude Chrome profile from ChatGPT profile...');
  console.log(`[global-setup]   src : ${SRC_PROFILE}`);
  console.log(`[global-setup]   dest: ${DEST_CLAUDE}`);
  copyDir(SRC_PROFILE, DEST_CLAUDE);
  console.log('[global-setup] ✓ Claude profile seeded.');

  console.log('[global-setup] ✓ All profiles seeded — all workers start with cached Sentinel policies.');
}
