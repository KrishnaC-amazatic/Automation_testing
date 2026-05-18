import { defineConfig } from '@playwright/test';
import path from 'path';

// Absolute path to the extracted extension folder.
// This folder must contain manifest.json at its root.
const EXTENSION_PATH = path.resolve(__dirname, 'sentinel-extension-chrome-v0.5.52');

// Persistent user-data directory so login sessions are reused across runs.
// Delete this folder to start a fresh session.
const USER_DATA_DIR = path.resolve(__dirname, '.playwright-user-data');

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,        // 2 min per individual test
  retries: 0,
  workers: 6,              // ChatGPT, Gemini, Claude, Copilot, DeepSeek, and GitHub Copilot run in parallel.
                           // global-setup.ts seeds the Gemini, Claude, Copilot, DeepSeek, and GitHub Copilot profiles from the ChatGPT profile
                           // so all Chrome instances start with cached Sentinel policies & auth token.

  // global-setup runs once before any worker starts — seeds the Gemini Chrome profile.
  globalSetup: require.resolve('./global-setup'),

  use: {
    // launchPersistentContext is used inside the test, not here.
    // These defaults are referenced by the spec for convenience.
    headless: false,       // Chrome extensions do not work in headless mode
    viewport: { width: 1280, height: 800 },
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  // Each spec launches its own launchPersistentContext with a dedicated USER_DATA_DIR,
  // so projects here just declare which spec file each worker picks up.
  projects: [
    {
      name: 'sentinel-chatgpt',
      testMatch: '**/sentinel-extension.spec.ts',
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
          ],
        },
      },
    },
    {
      name: 'sentinel-gemini',
      testMatch: '**/gemini-extension.spec.ts',
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
          ],
        },
      },
    },
    {
      name: 'sentinel-claude',
      testMatch: '**/claude-extension.spec.ts',
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
          ],
        },
      },
    },
    {
      name: 'sentinel-copilot',
      testMatch: '**/copilot-extension.spec.ts',
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
          ],
        },
      },
    },
    {
      name: 'sentinel-deepseek',
      testMatch: '**/deepseek-extension.spec.ts',
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
          ],
        },
      },
    },
    {
      name: 'sentinel-githubcopilot',
      testMatch: '**/githubcopilot-extension.spec.ts',
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
          ],
        },
      },
    },
  ],
});

// Export paths for direct import in the spec file.
export { EXTENSION_PATH, USER_DATA_DIR };
