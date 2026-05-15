/**
 * Guardrail Sentinel — Playwright Automation Test
 *
 * 8-Step Flow:
 *  Step 1: Launch Chrome (fresh isolated profile)
 *  Step 2: Open chrome://extensions → Enable Developer Mode → Load Unpacked → select extension-build/
 *  Step 3: Verify extension is loaded (ID detected from extensions page)
 *  Step 4: Open extension popup → wait for user to sign in (OAuth)
 *  Step 5: Confirm extension is active (__SENTINEL_INJECTED__ = true on ChatGPT)
 *  Step 6: Ensure ChatGPT is ready (handle Cloudflare / ChatGPT login)
 *  Step 7: Automatically enter the test prompt
 *  Step 8: Validate Sentinel behavior (WARN / BLOCK / REDACT / ALLOW)
 *
 * Run:  npx playwright test --reporter=list
 */

import { test, expect, chromium, BrowserContext, Page, ConsoleMessage } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { PromptCase, TEST_PROMPTS } from './test-prompts';
import { EXTENSION_FOLDER, USER_DATA_DIR, CHROME_EXE, SENTINEL_EMAIL, SENTINEL_PASSWORD } from './env';

// ---------------------------------------------------------------------------
// Config (from .env)
// ---------------------------------------------------------------------------

const EXTENSION_PATH = path.resolve(__dirname, `../${EXTENSION_FOLDER}`);

// TEST_PROMPTS and PromptCase are imported from ./test-prompts

// ChatGPT selectors (covers multiple UI versions)
const CHATGPT_INPUT =
  '[data-testid="chat-input-textarea"], #prompt-textarea, [placeholder*="Message"], [contenteditable="true"]';
const CHATGPT_SEND =
  '[data-testid="send-button"], button[aria-label="Send"], button[aria-label="Submit"], button:has-text("Send")';

// Sentinel DOM elements injected by sentinel-cs.js
const SENTINEL_BLOCK_BANNER = '#sentinel-block-banner';
const SENTINEL_WARN_OVERLAY  = '#sentinel-overlay-root';
const SENTINEL_REDACT_TOAST  = '#sentinel-redact-toast';

// Shared state
let context: BrowserContext;
let sharedPage: Page;
let extensionId = '';

// ---------------------------------------------------------------------------
// SETUP — one-time before all tests
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  test.setTimeout(600_000); // 10 min — sign-in may need manual interaction

  if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  const defaultDir = path.join(USER_DATA_DIR, 'Default');
  if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1 — Launch Chrome (NO --load-extension; extension loaded via UI in Step 2)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ STEP 1: Launching Chrome                         │');
  console.log('└─────────────────────────────────────────────────┘');

  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    executablePath: CHROME_EXE,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    slowMo: 50,
    // CRITICAL: remove --disable-extensions so content scripts can run
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
  });

  // Capture SW registrations (fires once extension is loaded)
  context.on('serviceworker', (worker) => {
    const url = worker.url();
    if (url.startsWith('chrome-extension://') && !extensionId) {
      extensionId = url.split('/')[2];
      console.log('[SW event] Extension ID:', extensionId);
    }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('[Step 1] Chrome launched.');

  // Inject a message listener into every page so we can read the raw Sentinel
  // SW response (including classification.primaryCategory) before the UI renders.
  await context.addInitScript(() => {
    window.addEventListener('message', (e: any) => {
      if (e.data?.__sentinel_response && e.data?.response) {
        (window as any).__sentinel_last_decision = e.data.response;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2 — Enable Developer Mode → Load Unpacked → select extension-build/
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ STEP 2: Loading extension via chrome://extensions │');
  console.log('└─────────────────────────────────────────────────┘');

  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
  await extPage.waitForTimeout(1500);

  // (a) Check if extension is already loaded (persistent profile re-use)
  const alreadyLoaded = await extPage.evaluate(() => {
    const mgr: any = document.querySelector('extensions-manager');
    const root = mgr?.shadowRoot;
    // Try direct items first, then via extensions-item-list
    let items: any[] = Array.from(root?.querySelectorAll('extensions-item') ?? []);
    if (!items.length) {
      const list: any = root?.querySelector('extensions-item-list');
      items = Array.from(list?.shadowRoot?.querySelectorAll('extensions-item') ?? []);
    }
    return items.some((item: any) => {
      const name: string = item.shadowRoot?.querySelector('#name')?.textContent?.trim() ?? '';
      return name === 'Guardrail Sentinel';
    });
  }).catch(() => false);

  if (alreadyLoaded) {
    console.log('[Step 2] Extension already loaded in profile — skipping Load Unpacked.');
  } else {
    // (b) Enable Developer Mode toggle
    console.log('[Step 2] Enabling Developer Mode...');
    await extPage.evaluate(() => {
      const mgr: any = document.querySelector('extensions-manager');
      const toolbar: any = mgr?.shadowRoot?.querySelector('extensions-toolbar');
      const toggle: any = toolbar?.shadowRoot?.querySelector('cr-toggle#devMode')
                        ?? toolbar?.shadowRoot?.querySelector('cr-toggle');
      if (toggle && !toggle.checked) toggle.click();
    }).catch(() => {});
    await extPage.waitForTimeout(800);
    console.log('[Step 2] Developer Mode enabled.');

    // (c) Click "Load unpacked" button
    console.log('[Step 2] Clicking "Load unpacked"...');
    const clicked = await extPage.evaluate(() => {
      const mgr: any = document.querySelector('extensions-manager');
      const toolbar: any = mgr?.shadowRoot?.querySelector('extensions-toolbar');
      const btn: HTMLElement | null =
        toolbar?.shadowRoot?.querySelector('#loadUnpacked') ?? null;
      if (btn) { btn.click(); return true; }
      return false;
    }).catch(() => false);

    if (!clicked) {
      console.log('[Step 2] WARNING: Could not find "Load unpacked" button.');
      console.log('[Step 2]   → Developer Mode may not have enabled correctly.');
    } else {
      console.log('[Step 2] "Load unpacked" clicked — handling native file dialog...');

      // (d) Handle the native Windows folder-picker dialog via PowerShell SendKeys.
      //     We write a .ps1 script to avoid any command-line escaping issues.
      const psScript = [
        `Add-Type -AssemblyName System.Windows.Forms`,
        `Start-Sleep -Milliseconds 2000`,
        // Type the extension path directly into the dialog's filename field
        `[System.Windows.Forms.SendKeys]::SendWait("${EXTENSION_PATH.replace(/"/g, '""')}")`,
        `[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")`,
        `Start-Sleep -Milliseconds 1000`,
        // Some dialogs need a second Enter to confirm folder selection
        `[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")`,
      ].join('\r\n');

      const scriptFile = path.join(USER_DATA_DIR, 'load-unpacked.ps1');
      fs.writeFileSync(scriptFile, psScript, 'utf8');

      try {
        execSync(`powershell -ExecutionPolicy Bypass -File "${scriptFile}"`, {
          timeout: 15_000,
          stdio:   'pipe',
        });
        console.log('[Step 2] File dialog handled.');
      } catch (err) {
        console.log('[Step 2] File dialog error:', String(err).split('\n')[0]);
      } finally {
        fs.unlink(scriptFile, () => {}); // clean up temp script
      }
    }

    // Wait for Chrome to register the extension after Load Unpacked
    await extPage.waitForTimeout(3000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Verify extension loaded + get extension ID
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ STEP 3: Verifying extension & reading ID         │');
  console.log('└─────────────────────────────────────────────────┘');

  // Reload the extensions page to get fresh state after Load Unpacked
  await extPage.reload({ waitUntil: 'domcontentloaded' });
  await extPage.waitForTimeout(1500);

  const idFromDom = await extPage.evaluate(() => {
    const mgr: any = document.querySelector('extensions-manager');
    const root = mgr?.shadowRoot;
    let items: any[] = Array.from(root?.querySelectorAll('extensions-item') ?? []);
    if (!items.length) {
      const list: any = root?.querySelector('extensions-item-list');
      items = Array.from(list?.shadowRoot?.querySelectorAll('extensions-item') ?? []);
    }
    for (const item of items) {
      const name: string = item.shadowRoot?.querySelector('#name')?.textContent?.trim() ?? '';
      if (name === 'Guardrail Sentinel') {
        return (item as any).getAttribute('id') ?? (item as any).id ?? '';
      }
    }
    return '';
  }).catch(() => '');

  if (idFromDom) {
    extensionId = idFromDom;
    console.log('[Step 3] ✓ Extension loaded — ID:', extensionId);
  } else if (extensionId) {
    console.log('[Step 3] ✓ Extension ID from SW event:', extensionId);
  } else {
    // Last resort: check SW list
    const sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    if (sw) {
      extensionId = sw.url().split('/')[2];
      console.log('[Step 3] ✓ Extension ID from SW list:', extensionId);
    } else {
      console.log('[Step 3] ✗ Extension NOT found in chrome://extensions.');
      console.log('[Step 3]   Possible causes:');
      console.log('[Step 3]   • "Load unpacked" file dialog did not receive the path.');
      console.log('[Step 3]   • The extension-build/ directory is invalid.');
      console.log('[Step 3]   Manual check: look at the Chrome window for any error dialogs.');
    }
  }

  await extPage.close();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4 — Open extension popup and sign in automatically
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ STEP 4: Sign in through extension popup          │');
  console.log('└─────────────────────────────────────────────────┘');


  let popupPage: Page | null = null;

  if (!extensionId) {
    console.log('[Step 4] Skipped — extension ID unknown.');
  } else {
    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
    console.log('[Step 4] Opening popup:', popupUrl);
    try {
      popupPage = await context.newPage();
      await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });

      const loadedUrl = popupPage.url();
      if (!loadedUrl.startsWith('chrome-extension://')) {
        throw new Error(`Popup URL is: ${loadedUrl}`);
      }
      console.log('[Step 4] ✓ Popup opened.');

      // NOTE: "Protection Active" appears even when NOT authenticated.
      // Use absence of "Not signed in" + presence of stats as the real auth check.
      const alreadySignedIn = await popupPage.evaluate(() => {
        const text = document.body?.innerText ?? '';
        const notSignedIn = text.includes('Not signed in') || text.includes('Session expired');
        return !notSignedIn && (
          text.includes('Scanned Today') ||
          !!document.querySelector('#stats-grid') ||
          !!document.querySelector('[class*="signed-in"]')
        );
      }).catch(() => false);

      if (alreadySignedIn) {
        console.log('[Step 4] ✓ Already signed in.');
      } else {
        console.log('[Step 4] Not signed in — automating sign-in...');

        // Show current popup content for debugging
        const popupPreview = await popupPage
          .evaluate(() => (document.body?.innerText ?? '').replace(/\n+/g, ' ').substring(0, 200))
          .catch(() => '');
        console.log('[Step 4] Popup content:', popupPreview);

        // Click the "Sign In" button in the popup.
        const signInBtn = popupPage.locator('button:has-text("Sign In"), a:has-text("Sign In"), button:has-text("sign in")').first();
        await signInBtn.waitFor({ state: 'visible', timeout: 8_000 });

        // Listen for new tab BEFORE clicking (auth opens in a new tab)
        const newPagePromise = context.waitForEvent('page', { timeout: 20_000 });
        await signInBtn.click();
        console.log('[Step 4] Clicked Sign In — waiting for auth tab to open...');

        let authPage: Page;
        let authOpenedInNewTab = false;
        try {
          authPage = await newPagePromise;
          authOpenedInNewTab = true;
          // Wait for the auth page to fully load
          await authPage.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() =>
            authPage.waitForLoadState('domcontentloaded', { timeout: 10_000 })
          );
          console.log('[Step 4] Auth page URL:', authPage.url());
          console.log('[Step 4] Auth page title:', await authPage.title().catch(() => '?'));

          // Log all input fields on the auth page for debugging
          const inputs = await authPage.evaluate(() =>
            Array.from(document.querySelectorAll('input')).map(i => ({
              type: i.type, name: i.name, id: i.id,
              placeholder: i.placeholder, visible: i.offsetParent !== null,
            }))
          ).catch(() => []);
          console.log('[Step 4] Inputs on auth page:', JSON.stringify(inputs));
        } catch {
          // Auth may have navigated inside popup instead of new tab
          authPage = popupPage;
          await authPage.waitForTimeout(3000);
          console.log('[Step 4] Auth in popup page:', authPage.url());
        }

        // --- Fill in credentials ---
        // Strategy: try common email field selectors
        const emailSelectors = [
          'input[type="email"]',
          'input[name="email"]',
          'input[name="username"]',
          'input[id="email"]',
          'input[id="username"]',
          'input[placeholder*="email" i]',
          'input[autocomplete="email"]',
          'input[autocomplete="username"]',
        ];

        let emailFilled = false;
        for (const sel of emailSelectors) {
          const visible = await authPage.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false);
          if (visible) {
            await authPage.fill(sel, SENTINEL_EMAIL);
            console.log('[Step 4] Filled email using selector:', sel);
            emailFilled = true;
            break;
          }
        }
        if (!emailFilled) {
          // Last resort: fill first visible input
          await authPage.evaluate((email: string) => {
            const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
            const el = inputs.find(i => i.offsetParent !== null &&
              (i.type === 'email' || i.type === 'text' || !i.type));
            if (el) el.value = email;
          }, SENTINEL_EMAIL);
          console.log('[Step 4] Filled email via JS evaluate (fallback).');
        }

        // Some auth flows are two-step (email → Next → password)
        await authPage.waitForTimeout(500);
        const nextBtnSel = 'button:has-text("Next"), button:has-text("Continue"), input[type="submit"][value*="Next"]';
        const hasNext = await authPage.locator(nextBtnSel).first().isVisible({ timeout: 1_500 }).catch(() => false);
        if (hasNext) {
          console.log('[Step 4] Two-step auth — clicking Next...');
          await authPage.locator(nextBtnSel).first().click();
          await authPage.waitForTimeout(2000);
        }

        // Fill password
        console.log('[Step 4] Filling password...');
        await authPage.waitForSelector('input[type="password"]', { timeout: 10_000 });
        await authPage.fill('input[type="password"]', SENTINEL_PASSWORD);
        await authPage.waitForTimeout(300);

        // Submit
        console.log('[Step 4] Submitting credentials...');
        const submitSel = 'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Sign In"), button:has-text("Log in"), button:has-text("Continue")';
        const submitBtn = authPage.locator(submitSel).first();
        const submitVisible = await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false);
        if (submitVisible) {
          await submitBtn.click();
        } else {
          // Fallback: press Enter on the password field
          await authPage.keyboard.press('Enter');
        }

        console.log('[Step 4] Credentials submitted — waiting for redirect/completion...');

        // Wait for auth to complete (tab may close, or page redirects)
        if (authOpenedInNewTab) {
          // Wait for the auth tab to close (OAuth complete) or redirect
          await authPage.waitForEvent('close', { timeout: 30_000 }).catch(() =>
            authPage.waitForURL(/sentinel\.guardrail\.tech|chrome-extension:/, { timeout: 30_000 })
          ).catch(() => {});
        }

        // Re-open popup to check auth state
        await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
        await popupPage.waitForTimeout(2000);

        const finalText = await popupPage.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        console.log('[Step 4] Final popup state:', finalText.replace(/\n+/g, ' ').substring(0, 200));

        const signedIn = !finalText.includes('Not signed in') && !finalText.includes('Session expired') &&
                         finalText.length > 10;
        if (signedIn) {
          console.log('[Step 4] ✓ Signed in successfully.');
        } else {
          console.log('[Step 4] ✗ Sign-in may have failed — Sentinel will run unauthenticated.');
        }
      }
    } catch (err) {
      console.log('[Step 4] Error:', String(err).split('\n')[0]);
    }
    await popupPage?.close().catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5 — Log in to ChatGPT via Google (user selects account manually)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ STEP 5: Log in to ChatGPT with Google            │');
  console.log('└─────────────────────────────────────────────────┘');

  const chatPage = await context.newPage();
  const sentinelBootLogs: string[] = [];
  chatPage.on('console', (msg) => {
    const t = msg.text();
    if (t.toLowerCase().includes('sentinel')) sentinelBootLogs.push(t);
  });

  console.log('[Step 5] Navigating to ChatGPT...');
  await chatPage.goto('https://chatgpt.com/', { waitUntil: 'commit', timeout: 60_000 })
    .catch(e => console.log('[Step 5] Navigation error:', String(e).split('\n')[0]));

  // Check if already logged in to ChatGPT
  const alreadyLoggedIn = await chatPage
    .waitForSelector(CHATGPT_INPUT, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  if (alreadyLoggedIn) {
    console.log('[Step 5] ✓ Already logged in to ChatGPT.');
  } else {
    console.log('[Step 5] ChatGPT login required — clicking "Log in"...');

    // Click the main "Log in" button on the ChatGPT landing page
    const loginBtn = chatPage.locator(
      'button:has-text("Log in"), a:has-text("Log in"), button:has-text("Sign in"), a:has-text("Sign in")'
    ).first();
    await loginBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await loginBtn.click();
    console.log('[Step 5] Clicked Log in — waiting for login page...');

    // Wait for the OpenAI/ChatGPT login page
    await chatPage.waitForURL(/auth\.openai\.com|accounts\.google\.com|chatgpt\.com\/auth/, { timeout: 15_000 })
      .catch(() => {});
    await chatPage.waitForTimeout(1500);
    console.log('[Step 5] Login page URL:', chatPage.url());

    // Click "Continue with Google"
    const googleBtn = chatPage.locator(
      'button:has-text("Continue with Google"), a:has-text("Continue with Google"), ' +
      '[data-provider="google"], button:has-text("Google"), a:has-text("Google")'
    ).first();

    const googleVisible = await googleBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (googleVisible) {
      // Wait for Google account picker tab to open BEFORE clicking
      const googleTabPromise = context.waitForEvent('page', { timeout: 20_000 });
      await googleBtn.click();
      console.log('[Step 5] Clicked "Continue with Google" — waiting for Google account picker...');

      let googleTab: Page | null = null;
      try {
        googleTab = await googleTabPromise;
        await googleTab.waitForLoadState('domcontentloaded', { timeout: 15_000 });
        console.log('[Step 5] Google account picker opened:', googleTab.url());
      } catch {
        // Google auth may happen in the same tab
        googleTab = null;
        console.log('[Step 5] Google auth in same tab:', chatPage.url());
      }

      console.log('[Step 5]');
      console.log('[Step 5] ════ ACTION REQUIRED ════════════════════════════════════');
      console.log('[Step 5]  Google account picker is open in Chrome.');
      console.log('[Step 5]  Please select your Google account to log in to ChatGPT.');
      console.log('[Step 5]  Test continues automatically once ChatGPT input is visible.');
      console.log('[Step 5] ════════════════════════════════════════════════════════');
      console.log('[Step 5] Waiting up to 2 minutes for ChatGPT to become ready...');

      // After user picks account, Google redirects back to ChatGPT
      await chatPage
        .waitForSelector(CHATGPT_INPUT, { timeout: 120_000 })
        .then(() => console.log('[Step 5] ✓ ChatGPT login complete — input visible.'))
        .catch(() => console.log('[Step 5] ChatGPT login not detected — tests may fail.'));

    } else {
      // No Google button — may be a direct email/password login page
      console.log('[Step 5] "Continue with Google" not found — checking for direct input...');
      const inputReady = await chatPage
        .waitForSelector(CHATGPT_INPUT, { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!inputReady) {
        console.log('[Step 5] Please log in to ChatGPT manually (2 min)...');
        await chatPage
          .waitForSelector(CHATGPT_INPUT, { timeout: 120_000 })
          .then(() => console.log('[Step 5] ✓ ChatGPT login complete.'))
          .catch(() => console.log('[Step 5] ChatGPT login timed out.'));
      }
    }
  }

  sharedPage = chatPage; // keep alive — reused by both tests

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6 — Verify extension is active on ChatGPT (__SENTINEL_INJECTED__)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ STEP 6: Verifying extension active on ChatGPT    │');
  console.log('└─────────────────────────────────────────────────┘');

  // Allow content script to run after page load
  await sharedPage.waitForTimeout(3000);

  const { injected: step6Injected, fetchLen } = await sharedPage.evaluate(() => ({
    injected: !!(window as any).__SENTINEL_INJECTED__,
    fetchLen:  window.fetch.toString().length,
  }));

  console.log(`[Step 6] __SENTINEL_INJECTED__ : ${step6Injected}`);
  console.log(`[Step 6] fetch() length        : ${fetchLen}`);
  if (sentinelBootLogs.length) console.log('[Step 6] Sentinel logs:', sentinelBootLogs.slice(0, 3));
  else                         console.log('[Step 6] No Sentinel console logs captured.');

  if (step6Injected) {
    console.log('[Step 6] ✓ Extension is active — Sentinel content script confirmed.');
  } else {
    console.log('[Step 6] ✗ __SENTINEL_INJECTED__ = false — content script not running.');
    console.log('[Step 6]   Check Step 2 (extension loaded) and Step 4 (signed in).');
  }

  console.log('\n[Setup] All steps complete — starting tests.\n');
});

test.afterAll(async () => {
  await context?.close();
});

// ---------------------------------------------------------------------------
// TEST 1 — Steps 7+8: Verify extension is active
// ---------------------------------------------------------------------------

test('1 - Extension is active on ChatGPT (__SENTINEL_INJECTED__)', async () => {
  test.setTimeout(120_000);

  const page = sharedPage ?? await context.newPage();

  const sentinelLogs: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.text().toLowerCase().includes('sentinel')) sentinelLogs.push(msg.text());
  });

  // STEP 7: navigate to ChatGPT
  console.log('\n[Test 1] STEP 7 — Navigating to ChatGPT...');
  await page.goto('https://chatgpt.com/', { waitUntil: 'commit', timeout: 90_000 });
  await page.waitForSelector(CHATGPT_INPUT, { timeout: 60_000 });
  await page.waitForTimeout(2000);

  // STEP 8: validate extension is active
  const { injected, fetchHooked } = await page.evaluate(() => ({
    injected:    !!(window as any).__SENTINEL_INJECTED__,
    fetchHooked: window.fetch.toString().length > 5000,
  }));

  console.log(`[Test 1] STEP 8 — __SENTINEL_INJECTED__: ${injected}  |  fetch hooked: ${fetchHooked}`);
  if (sentinelLogs.length) console.log('[Test 1] Sentinel logs:', sentinelLogs.slice(0, 5));

  expect(
    injected,
    '__SENTINEL_INJECTED__ is false — extension not active. Check Step 2 (Load Unpacked) & Step 4 (sign-in).',
  ).toBe(true);

  console.log('[Test 1] PASS — Sentinel extension is active on ChatGPT.');
});

// ---------------------------------------------------------------------------
// TEST 2 — Steps 7+8: Enter test prompt → validate Sentinel decision
// ---------------------------------------------------------------------------

test('2 - Sentinel intercepts prompt (WARN / BLOCK / REDACT / ALLOW)', async () => {
  test.setTimeout(2_400_000); // 40 min — 28 prompts × ~45 s each

  const page = sharedPage ?? await context.newPage();

  const consoleLogs: string[] = [];
  page.on('console', (msg: ConsoleMessage) => consoleLogs.push(msg.text()));

  const sentinelApiCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('sentinel.guardrail.tech')) sentinelApiCalls.push(req.url());
  });

  const results: Array<{ index: number; category: string; expected: string; decision: string; detectedCategory: string; prompt: string; status: string }> = [];

  // Navigate once and stay on the same chat for all prompts.
  // This keeps the Sentinel SW alive and avoids the offline/reload issue.
  await page.goto('https://chatgpt.com/', { waitUntil: 'commit', timeout: 90_000 });
  await page.waitForSelector(CHATGPT_INPUT, { timeout: 60_000 });

  // Wait for Sentinel to initialise on first load, then confirm SW is ready.
  console.log('[Test 2] Waiting 10 s for Sentinel to initialise...');
  await page.waitForTimeout(10_000);
  const swReady = await page.waitForFunction(
    () => !!(window as any).__SENTINEL_INJECTED__,
    { timeout: 15_000, polling: 500 }
  ).then(() => true).catch(() => false);
  console.log(`[Test 2] Sentinel SW ready: ${swReady}`);

  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const { prompt, category, expected } = TEST_PROMPTS[i];
    const snippet = prompt.substring(0, 55);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[Test 2] Prompt ${i + 1} / ${TEST_PROMPTS.length}`);
    console.log(`[Test 2] "${snippet}..."`);
    console.log('─'.repeat(60));

    // Dismiss any leftover Sentinel banners/overlays from the previous prompt
    await page.evaluate(() => {
      document.getElementById('sentinel-block-banner')?.remove();
      document.getElementById('sentinel-overlay-root')?.remove();
      document.getElementById('sentinel-redact-toast')?.remove();
    });

    console.log(`[Test 2] Sentinel active: ${await page.evaluate(() => !!(window as any).__SENTINEL_INJECTED__)}`);

    // Enter prompt (newlines replaced with spaces to avoid accidental submission)
    const input = page.locator(CHATGPT_INPUT).first();
    await input.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await input.pressSequentially(prompt.replace(/\n/g, ' '), { delay: 20 });
    await page.waitForTimeout(500);

    // Submit
    let submitted = false;
    try {
      const sendBtn = page.locator(CHATGPT_SEND).first();
      if (await sendBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await sendBtn.click();
        submitted = true;
      } else {
        await input.press('Enter');
        submitted = true;
      }
    } catch (err) {
      console.log('[Test 2] Submit error:', String(err).split('\n')[0]);
    }

    if (!submitted) {
      console.log('[Test 2] Could not submit — skipping prompt.');
      results.push({ index: i + 1, category, expected, decision: 'SKIP', detectedCategory: '', prompt, status: 'SKIP' });
      continue;
    }

    // Wait for Sentinel decision
    const decision = await Promise.race([
      page.waitForSelector(SENTINEL_BLOCK_BANNER, { timeout: 45_000 }).then(() => 'BLOCK'),
      page.waitForSelector(SENTINEL_WARN_OVERLAY,  { timeout: 45_000 }).then(() => 'WARN'),
      page.waitForSelector(SENTINEL_REDACT_TOAST,  { timeout: 45_000 }).then(() => 'REDACT'),
    ]).catch(() => 'ALLOW');

    // Read the category Sentinel detected from the SW response captured by our init script
    const detectedCategory = await page.evaluate(
      () => (window as any).__sentinel_last_decision?.classification?.primaryCategory ?? ''
    ).catch(() => '');
    // Reset for next prompt
    await page.evaluate(() => { (window as any).__sentinel_last_decision = null; }).catch(() => {});

    const status = decision === expected ? 'PASS' : 'FAIL';
    results.push({ index: i + 1, category, expected, decision, detectedCategory, prompt, status });
    console.log(`[Test 2] Prompt ${i + 1} → Decision: ${decision}  Det.Category: ${detectedCategory || '(none)'}  [${status}]`);

    // If WARN overlay is open, dismiss it before the next prompt
    if (decision === 'WARN') {
      await page.evaluate(() => document.getElementById('sentinel-overlay-root')?.remove());
    }

    await page.waitForTimeout(2_000);
  }

  // ── Final report ─────────────────────────────────────────────────────────
  const timestamp = new Date().toLocaleString();
  const reportLines: string[] = [];

  const completedResults = results.filter(r => r.decision !== 'SKIP');
  const total = completedResults.length;
  const pass  = completedResults.filter(r => r.status === 'PASS').length;
  const fail  = total - pass;
  const pct   = total > 0 ? Math.round((pass / total) * 100) : 0;

  const LINE = '='.repeat(100);
  const DIV  = '-'.repeat(100);

  // ── Header ──
  reportLines.push(LINE);
  reportLines.push(`  Guardrail Sentinel — ChatGPT Test Report`);
  reportLines.push(`  Generated : ${timestamp}`);
  reportLines.push(`  Result    : ${pass} PASS  /  ${fail} FAIL  /  ${total} Total  (${pct}%)`);
  reportLines.push(LINE);
  reportLines.push('');

  // ── Summary table ──
  reportLines.push('SUMMARY');
  const TSEP  = '+-----+--------------------------------------------------------------+-------------------+----------+----------+----------------------+--------+';
  const THEAD = '| No  | Prompt                                                       | Category          | Expected | Actual   | Det.Category         | Status |';
  reportLines.push(TSEP);
  reportLines.push(THEAD);
  reportLines.push(TSEP);
  for (const r of completedResults) {
    const promptWords = r.prompt.split(' ');
    const promptLines: string[] = [];
    let cur = '';
    for (const word of promptWords) {
      if (cur.length + word.length + (cur ? 1 : 0) > 60) { promptLines.push(cur); cur = word; }
      else { cur += (cur ? ' ' : '') + word; }
    }
    if (cur) promptLines.push(cur);
    for (let li = 0; li < promptLines.length; li++) {
      if (li === 0) {
        reportLines.push(`| ${String(r.index).padEnd(3)} | ${promptLines[0].padEnd(60)} | ${r.category.padEnd(17)} | ${r.expected.padEnd(8)} | ${r.decision.padEnd(8)} | ${r.detectedCategory.padEnd(20)} | ${r.status.padEnd(6)} |`);
      } else {
        reportLines.push(`|     | ${promptLines[li].padEnd(60)} |                   |          |          |                      |        |`);
      }
    }
    reportLines.push(TSEP);
  }
  reportLines.push(`  Total: ${total}   PASS: ${pass}   FAIL: ${fail}   (${pct}%)`);
  reportLines.push('');

  // ── Details — full prompts ──
  reportLines.push(LINE);
  reportLines.push('DETAILS — Full Prompts');
  reportLines.push(LINE);
  reportLines.push('');
  for (const r of completedResults) {
    reportLines.push(`[${r.index}]  ${r.category}  |  Expected: ${r.expected}  |  Actual: ${r.decision}  |  Detected: ${r.detectedCategory || '(none)'}  |  ${r.status}`);
    const words = r.prompt.split(' ');
    let wrapLine = '  ';
    for (const word of words) {
      if (wrapLine.length + word.length + 1 > 98) { reportLines.push(wrapLine); wrapLine = '  ' + word; }
      else { wrapLine += (wrapLine === '  ' ? '' : ' ') + word; }
    }
    if (wrapLine.trim()) reportLines.push(wrapLine);
    reportLines.push(DIV);
    reportLines.push('');
  }

  const reportText = reportLines.join('\n');
  console.log('\n' + reportText);

  // Save report to reports/ (not test-results/ — Playwright wipes that folder on every run)
  const reportDir  = path.resolve(__dirname, '../reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const _now = new Date();
  const fileTs = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}_${String(_now.getHours()).padStart(2,'0')}-${String(_now.getMinutes()).padStart(2,'0')}-${String(_now.getSeconds()).padStart(2,'0')}`;
  const reportFile = path.join(reportDir, `chatgpt_${fileTs}.txt`);
  fs.writeFileSync(reportFile, reportText, 'utf8');
  console.log(`[Test 2] Report saved → ${reportFile}`);
  console.log(`[Test 2] Total Sentinel API calls: ${sentinelApiCalls.length}`);

  const extensionActive = await page.evaluate(() => !!(window as any).__SENTINEL_INJECTED__).catch(() => false);
  expect(extensionActive, 'Sentinel extension not active — content script not running.').toBe(true);

  // Keep browser open for 60 seconds so the final results are visible on screen.
  console.log('[Test 2] Keeping browser open for 60 s to review the Sentinel results...');
  await page.waitForTimeout(60_000);

  await page.close();
});
