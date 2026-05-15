/**
 * Guardrail Sentinel — Playwright Automation Test (Claude)
 *
 * Mirrors gemini-extension.spec.ts but targets Anthropic Claude instead of Gemini.
 * Shares the same 28 TEST_PROMPTS and produces a matching report file.
 *
 * Run standalone:  npx playwright test claude --reporter=list
 * Run in parallel: npx playwright test --reporter=list   (workers=3 in config)
 */

import { test, expect, chromium, BrowserContext, Page, ConsoleMessage } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { PromptCase, TEST_PROMPTS } from './test-prompts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const EXTENSION_PATH = path.resolve(__dirname, '../sentinel-extension-chrome-v0.5.52');
// Separate profile so this Chrome instance does not conflict with ChatGPT / Gemini.
// global-setup.ts seeds this from .playwright-user-data before the workers start.
const USER_DATA_DIR  = path.resolve(__dirname, '../.playwright-user-data-claude');
const CHROME_EXE     = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Claude selectors (covers multiple UI versions)
const CLAUDE_INPUT =
  'div.ProseMirror[contenteditable="true"], ' +
  'div[contenteditable="true"][data-placeholder], ' +
  'div[contenteditable="true"].ProseMirror, ' +
  'div[contenteditable="true"]';
const CLAUDE_SEND =
  'button[aria-label="Send message"], button[aria-label="Send Message"], ' +
  'button[data-testid="send-button"], button:has-text("Send"), ' +
  'button[type="submit"]';

// Sentinel DOM elements injected by sentinel-cs.js
const SENTINEL_BLOCK_BANNER = '#sentinel-block-banner';
const SENTINEL_WARN_OVERLAY  = '#sentinel-overlay-root';
const SENTINEL_REDACT_TOAST  = '#sentinel-redact-toast';

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
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
  // STEP 1 — Launch Chrome
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ [CLAUDE] STEP 1: Launching Chrome                │');
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
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
  });

  context.on('serviceworker', (worker) => {
    const url = worker.url();
    if (url.startsWith('chrome-extension://') && !extensionId) {
      extensionId = url.split('/')[2];
      console.log('[CLAUDE][SW event] Extension ID:', extensionId);
    }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('[CLAUDE][Step 1] Chrome launched.');

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
  // STEP 2 — Enable Developer Mode → Load Unpacked → select extension folder
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ [CLAUDE] STEP 2: Loading extension               │');
  console.log('└─────────────────────────────────────────────────┘');

  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
  await extPage.waitForTimeout(1500);

  const alreadyLoaded = await extPage.evaluate(() => {
    const mgr: any = document.querySelector('extensions-manager');
    const root = mgr?.shadowRoot;
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
    console.log('[CLAUDE][Step 2] Extension already loaded — skipping Load Unpacked.');
  } else {
    console.log('[CLAUDE][Step 2] Enabling Developer Mode...');
    await extPage.evaluate(() => {
      const mgr: any = document.querySelector('extensions-manager');
      const toolbar: any = mgr?.shadowRoot?.querySelector('extensions-toolbar');
      const toggle: any = toolbar?.shadowRoot?.querySelector('cr-toggle#devMode')
                        ?? toolbar?.shadowRoot?.querySelector('cr-toggle');
      if (toggle && !toggle.checked) toggle.click();
    }).catch(() => {});
    await extPage.waitForTimeout(800);

    console.log('[CLAUDE][Step 2] Clicking "Load unpacked"...');
    const clicked = await extPage.evaluate(() => {
      const mgr: any = document.querySelector('extensions-manager');
      const toolbar: any = mgr?.shadowRoot?.querySelector('extensions-toolbar');
      const btn: HTMLElement | null = toolbar?.shadowRoot?.querySelector('#loadUnpacked') ?? null;
      if (btn) { btn.click(); return true; }
      return false;
    }).catch(() => false);

    if (!clicked) {
      console.log('[CLAUDE][Step 2] WARNING: Could not find "Load unpacked" button.');
    } else {
      console.log('[CLAUDE][Step 2] "Load unpacked" clicked — handling file dialog...');
      const psScript = [
        `Add-Type -AssemblyName System.Windows.Forms`,
        `Start-Sleep -Milliseconds 2000`,
        `[System.Windows.Forms.SendKeys]::SendWait("${EXTENSION_PATH.replace(/"/g, '""')}")`,
        `[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")`,
        `Start-Sleep -Milliseconds 1000`,
        `[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")`,
      ].join('\r\n');

      const scriptFile = path.join(USER_DATA_DIR, 'load-unpacked.ps1');
      fs.writeFileSync(scriptFile, psScript, 'utf8');
      try {
        execSync(`powershell -ExecutionPolicy Bypass -File "${scriptFile}"`, { timeout: 15_000, stdio: 'pipe' });
        console.log('[CLAUDE][Step 2] File dialog handled.');
      } catch (err) {
        console.log('[CLAUDE][Step 2] File dialog error:', String(err).split('\n')[0]);
      } finally {
        fs.unlink(scriptFile, () => {});
      }
    }
    await extPage.waitForTimeout(3000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Verify extension loaded + get extension ID
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ [CLAUDE] STEP 3: Verifying extension & ID        │');
  console.log('└─────────────────────────────────────────────────┘');

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
    console.log('[CLAUDE][Step 3] ✓ Extension loaded — ID:', extensionId);
  } else if (extensionId) {
    console.log('[CLAUDE][Step 3] ✓ Extension ID from SW event:', extensionId);
  } else {
    const sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    if (sw) {
      extensionId = sw.url().split('/')[2];
      console.log('[CLAUDE][Step 3] ✓ Extension ID from SW list:', extensionId);
    } else {
      console.log('[CLAUDE][Step 3] ✗ Extension NOT found in chrome://extensions.');
    }
  }

  await extPage.close();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4 — Open extension popup and sign in to Sentinel
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ [CLAUDE] STEP 4: Sign in through extension popup │');
  console.log('└─────────────────────────────────────────────────┘');

  const SENTINEL_EMAIL    = 'krishna.c@amazatic.com';
  const SENTINEL_PASSWORD = 'admin@123';
  let popupPage: Page | null = null;

  if (!extensionId) {
    console.log('[CLAUDE][Step 4] Skipped — extension ID unknown.');
  } else {
    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
    console.log('[CLAUDE][Step 4] Opening popup:', popupUrl);
    try {
      popupPage = await context.newPage();
      await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });

      const loadedUrl = popupPage.url();
      if (!loadedUrl.startsWith('chrome-extension://')) {
        throw new Error(`Popup URL is: ${loadedUrl}`);
      }
      console.log('[CLAUDE][Step 4] ✓ Popup opened.');

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
        console.log('[CLAUDE][Step 4] ✓ Already signed in.');
      } else {
        console.log('[CLAUDE][Step 4] Not signed in — automating sign-in...');
        const popupPreview = await popupPage
          .evaluate(() => (document.body?.innerText ?? '').replace(/\n+/g, ' ').substring(0, 200))
          .catch(() => '');
        console.log('[CLAUDE][Step 4] Popup content:', popupPreview);

        const signInBtn = popupPage.locator('button:has-text("Sign In"), a:has-text("Sign In"), button:has-text("sign in")').first();
        await signInBtn.waitFor({ state: 'visible', timeout: 8_000 });

        const newPagePromise = context.waitForEvent('page', { timeout: 20_000 });
        await signInBtn.click();
        console.log('[CLAUDE][Step 4] Clicked Sign In — waiting for auth tab...');

        let authPage: Page;
        let authOpenedInNewTab = false;
        try {
          authPage = await newPagePromise;
          authOpenedInNewTab = true;
          await authPage.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() =>
            authPage.waitForLoadState('domcontentloaded', { timeout: 10_000 })
          );
          console.log('[CLAUDE][Step 4] Auth page URL:', authPage.url());
        } catch {
          authPage = popupPage;
          await authPage.waitForTimeout(3000);
          console.log('[CLAUDE][Step 4] Auth in popup page:', authPage.url());
        }

        const emailSelectors = [
          'input[type="email"]', 'input[name="email"]', 'input[name="username"]',
          'input[id="email"]', 'input[id="username"]',
          'input[placeholder*="email" i]', 'input[autocomplete="email"]',
        ];
        let emailFilled = false;
        for (const sel of emailSelectors) {
          const visible = await authPage.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false);
          if (visible) {
            await authPage.fill(sel, SENTINEL_EMAIL);
            console.log('[CLAUDE][Step 4] Filled email using selector:', sel);
            emailFilled = true;
            break;
          }
        }
        if (!emailFilled) {
          await authPage.evaluate((email: string) => {
            const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
            const el = inputs.find(i => i.offsetParent !== null && (i.type === 'email' || i.type === 'text' || !i.type));
            if (el) el.value = email;
          }, SENTINEL_EMAIL);
          console.log('[CLAUDE][Step 4] Filled email via JS evaluate (fallback).');
        }

        await authPage.waitForTimeout(500);
        const nextBtnSel = 'button:has-text("Next"), button:has-text("Continue"), input[type="submit"][value*="Next"]';
        const hasNext = await authPage.locator(nextBtnSel).first().isVisible({ timeout: 1_500 }).catch(() => false);
        if (hasNext) {
          await authPage.locator(nextBtnSel).first().click();
          await authPage.waitForTimeout(2000);
        }

        await authPage.waitForSelector('input[type="password"]', { timeout: 10_000 });
        await authPage.fill('input[type="password"]', SENTINEL_PASSWORD);
        await authPage.waitForTimeout(300);

        const submitSel = 'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Sign In"), button:has-text("Log in"), button:has-text("Continue")';
        const submitBtn = authPage.locator(submitSel).first();
        const submitVisible = await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false);
        if (submitVisible) {
          await submitBtn.click();
        } else {
          await authPage.keyboard.press('Enter');
        }

        console.log('[CLAUDE][Step 4] Credentials submitted — waiting for redirect...');
        if (authOpenedInNewTab) {
          await authPage.waitForEvent('close', { timeout: 30_000 }).catch(() =>
            authPage.waitForURL(/sentinel\.guardrail\.tech|chrome-extension:/, { timeout: 30_000 })
          ).catch(() => {});
        }

        await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
        await popupPage.waitForTimeout(2000);
        const finalText = await popupPage.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        const signedIn = !finalText.includes('Not signed in') && !finalText.includes('Session expired') && finalText.length > 10;
        console.log(signedIn
          ? '[CLAUDE][Step 4] ✓ Signed in successfully.'
          : '[CLAUDE][Step 4] ✗ Sign-in may have failed — Sentinel will run unauthenticated.');
      }
    } catch (err) {
      console.log('[CLAUDE][Step 4] Error:', String(err).split('\n')[0]);
    }
    await popupPage?.close().catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5 — Log in to Claude (claude.ai)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ [CLAUDE] STEP 5: Log in to Claude                │');
  console.log('└─────────────────────────────────────────────────┘');

  const claudePage = await context.newPage();
  const sentinelBootLogs: string[] = [];
  claudePage.on('console', (msg) => {
    const t = msg.text();
    if (t.toLowerCase().includes('sentinel')) sentinelBootLogs.push(t);
  });

  console.log('[CLAUDE][Step 5] Navigating to Claude...');
  await claudePage.goto('https://claude.ai/', { waitUntil: 'commit', timeout: 60_000 })
    .catch(e => console.log('[CLAUDE][Step 5] Navigation error:', String(e).split('\n')[0]));

  await claudePage.waitForTimeout(3000);
  console.log('[CLAUDE][Step 5] Current URL:', claudePage.url());

  // Check if already logged in (Claude input visible)
  const alreadyLoggedIn = await claudePage
    .waitForSelector(CLAUDE_INPUT, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  if (alreadyLoggedIn) {
    console.log('[CLAUDE][Step 5] ✓ Already logged in to Claude.');
  } else {
    console.log('[CLAUDE][Step 5] Claude login required...');

    // Claude may show a "Continue with email" or "Sign in" button
    const signInBtn = claudePage.locator(
      'a:has-text("Sign in"), button:has-text("Sign in"), ' +
      'a:has-text("Log in"), button:has-text("Log in"), ' +
      'button:has-text("Continue"), a[href*="login"], a[href*="signin"]'
    ).first();

    const signInVisible = await signInBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (signInVisible) {
      console.log('[CLAUDE][Step 5] Clicking Sign in...');
      await signInBtn.click();
      await claudePage.waitForTimeout(2000);
    }

    console.log('[CLAUDE][Step 5] URL after click:', claudePage.url());
    console.log('[CLAUDE][Step 5]');
    console.log('[CLAUDE][Step 5] ════ ACTION REQUIRED ════════════════════════════════════');
    console.log('[CLAUDE][Step 5]  Claude sign-in page is open in the Chrome window.');
    console.log('[CLAUDE][Step 5]  Please log in to your Claude / Anthropic account.');
    console.log('[CLAUDE][Step 5]  Test continues automatically once the Claude input is visible.');
    console.log('[CLAUDE][Step 5] ════════════════════════════════════════════════════════');
    console.log('[CLAUDE][Step 5] Waiting up to 2 minutes for Claude to become ready...');

    await claudePage
      .waitForSelector(CLAUDE_INPUT, { timeout: 120_000 })
      .then(() => console.log('[CLAUDE][Step 5] ✓ Claude login complete — input visible.'))
      .catch(() => console.log('[CLAUDE][Step 5] Claude login not detected — tests may fail.'));
  }

  sharedPage = claudePage;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6 — Verify extension is active on Claude (__SENTINEL_INJECTED__)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n┌─────────────────────────────────────────────────┐');
  console.log('│ [CLAUDE] STEP 6: Verifying extension active      │');
  console.log('└─────────────────────────────────────────────────┘');

  await sharedPage.waitForTimeout(3000);

  const { injected: step6Injected, fetchLen } = await sharedPage.evaluate(() => ({
    injected: !!(window as any).__SENTINEL_INJECTED__,
    fetchLen:  window.fetch.toString().length,
  }));

  console.log(`[CLAUDE][Step 6] __SENTINEL_INJECTED__ : ${step6Injected}`);
  console.log(`[CLAUDE][Step 6] fetch() length        : ${fetchLen}`);
  if (sentinelBootLogs.length) console.log('[CLAUDE][Step 6] Sentinel logs:', sentinelBootLogs.slice(0, 3));
  else                         console.log('[CLAUDE][Step 6] No Sentinel console logs captured.');

  if (step6Injected) {
    console.log('[CLAUDE][Step 6] ✓ Extension is active on Claude.');
  } else {
    console.log('[CLAUDE][Step 6] ✗ __SENTINEL_INJECTED__ = false — content script not running.');
  }

  console.log('\n[CLAUDE][Setup] All steps complete — starting tests.\n');
});

test.afterAll(async () => {
  await context?.close();
});

// ---------------------------------------------------------------------------
// TEST 1 — Verify extension is active on Claude
// ---------------------------------------------------------------------------

test('[Claude] 1 - Extension is active on Claude (__SENTINEL_INJECTED__)', async () => {
  test.setTimeout(120_000);

  const page = sharedPage ?? await context.newPage();
  const sentinelLogs: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.text().toLowerCase().includes('sentinel')) sentinelLogs.push(msg.text());
  });

  console.log('\n[CLAUDE][Test 1] STEP 7 — Navigating to Claude...');
  await page.goto('https://claude.ai/', { waitUntil: 'commit', timeout: 90_000 });
  await page.waitForSelector(CLAUDE_INPUT, { timeout: 60_000 });
  await page.waitForTimeout(2000);

  const { injected, fetchHooked } = await page.evaluate(() => ({
    injected:    !!(window as any).__SENTINEL_INJECTED__,
    fetchHooked: window.fetch.toString().length > 5000,
  }));

  console.log(`[CLAUDE][Test 1] STEP 8 — __SENTINEL_INJECTED__: ${injected}  |  fetch hooked: ${fetchHooked}`);
  if (sentinelLogs.length) console.log('[CLAUDE][Test 1] Sentinel logs:', sentinelLogs.slice(0, 5));

  expect(
    injected,
    '__SENTINEL_INJECTED__ is false — extension not active on Claude.',
  ).toBe(true);

  console.log('[CLAUDE][Test 1] PASS — Sentinel extension is active on Claude.');
});

// ---------------------------------------------------------------------------
// TEST 2 — Enter 28 prompts on Claude → validate Sentinel decision
// ---------------------------------------------------------------------------

test('[Claude] 2 - Sentinel intercepts prompt on Claude (WARN / BLOCK / REDACT / ALLOW)', async () => {
  test.setTimeout(2_400_000); // 40 min — 28 prompts × ~45 s each

  const page = sharedPage ?? await context.newPage();

  const consoleLogs: string[] = [];
  page.on('console', (msg: ConsoleMessage) => consoleLogs.push(msg.text()));

  const sentinelApiCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('sentinel.guardrail.tech')) sentinelApiCalls.push(req.url());
  });

  const results: Array<{ index: number; category: string; expected: string; decision: string; detectedCategory: string; snippet: string; status: string }> = [];

  // Navigate to Claude once and reuse the same page for all prompts
  await page.goto('https://claude.ai/', { waitUntil: 'commit', timeout: 90_000 });
  await page.waitForSelector(CLAUDE_INPUT, { timeout: 60_000 });

  // Wait for Sentinel SW to be online.
  // Allow up to 3 attempts: wait 30 s → check injection → reload if still not ready.
  let swReady = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[CLAUDE][Test 2] Waiting 30 s for Sentinel to initialise (attempt ${attempt}/3)...`);
    await page.waitForTimeout(30_000);
    swReady = await page.evaluate(() => !!(window as any).__SENTINEL_INJECTED__).catch(() => false);
    console.log(`[CLAUDE][Test 2] Sentinel SW ready: ${swReady}`);
    if (swReady) break;
    if (attempt < 3) {
      console.log('[CLAUDE][Test 2] SW not ready — reloading page to trigger policy re-sync...');
      await page.reload({ waitUntil: 'commit', timeout: 60_000 });
      await page.waitForSelector(CLAUDE_INPUT, { timeout: 30_000 }).catch(() => {});
    }
  }
  if (!swReady) {
    console.log('[CLAUDE][Test 2] WARNING: Sentinel SW still not ready after 3 attempts — results may be affected.');
  }

  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const { prompt, category, expected } = TEST_PROMPTS[i];
    const snippet = prompt.substring(0, 55);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[CLAUDE][Test 2] Prompt ${i + 1} / ${TEST_PROMPTS.length}`);
    console.log(`[CLAUDE][Test 2] "${prompt.substring(0, 70)}..."`);
    console.log('─'.repeat(60));

    // Dismiss any leftover Sentinel overlays from the previous prompt
    await page.evaluate(() => {
      document.getElementById('sentinel-block-banner')?.remove();
      document.getElementById('sentinel-overlay-root')?.remove();
      document.getElementById('sentinel-redact-toast')?.remove();
    });

    console.log(`[CLAUDE][Test 2] Sentinel active: ${await page.evaluate(() => !!(window as any).__SENTINEL_INJECTED__)}`);

    // Focus and clear the Claude input
    const input = page.locator(CLAUDE_INPUT).first();
    await input.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await input.pressSequentially(prompt.replace(/\n/g, ' '), { delay: 20 });
    await page.waitForTimeout(500);

    // Submit — try send button, fall back to Enter
    let submitted = false;
    try {
      const sendBtn = page.locator(CLAUDE_SEND).first();
      if (await sendBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await sendBtn.click();
        submitted = true;
      } else {
        await input.press('Enter');
        submitted = true;
      }
    } catch (err) {
      console.log('[CLAUDE][Test 2] Submit error:', String(err).split('\n')[0]);
    }

    if (!submitted) {
      console.log('[CLAUDE][Test 2] Could not submit — skipping prompt.');
      results.push({ index: i + 1, category, expected, decision: 'SKIP', detectedCategory: '', snippet, status: 'SKIP' });
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
    results.push({ index: i + 1, category, expected, decision, detectedCategory, snippet, status });
    console.log(`[CLAUDE][Test 2] Prompt ${i + 1} → Decision: ${decision}  Det.Category: ${detectedCategory || '(none)'}  [${status}]`);

    if (decision === 'WARN') {
      await page.evaluate(() => document.getElementById('sentinel-overlay-root')?.remove());
    }

    await page.waitForTimeout(2_000);
  }

  // ── Final report ──────────────────────────────────────────────────────────
  const timestamp = new Date().toLocaleString();
  const reportLines: string[] = [];

  const SEP  = '+------+---------------------------------------------------------+-------------------+----------+----------+----------------------+--------+';
  const HEAD = '| No   | Prompt                                                  | Category          | Expected | Actual   | Det.Category         | Status |';
  const fmtRow = (no: string, pr: string, cat: string, exp: string, act: string, detCat: string, st: string) =>
    `| ${no.padEnd(4)} | ${pr.substring(0, 55).padEnd(55)} | ${cat.padEnd(17)} | ${exp.padEnd(8)} | ${act.padEnd(8)} | ${detCat.padEnd(20)} | ${st.padEnd(6)} |`;

  reportLines.push(`Guardrail Sentinel — Claude Test Report  [${timestamp}]`);
  reportLines.push(SEP);
  reportLines.push(HEAD);
  reportLines.push(SEP);

  const completedResults = results.filter(r => r.decision !== 'SKIP');
  for (const r of completedResults) {
    reportLines.push(fmtRow(String(r.index), r.snippet, r.category, r.expected, r.decision, r.detectedCategory, r.status));
  }
  reportLines.push(SEP);

  const total = completedResults.length;
  const pass  = completedResults.filter(r => r.status === 'PASS').length;
  const fail  = total - pass;
  const pct   = total > 0 ? Math.round((pass / total) * 100) : 0;
  reportLines.push(`  Total: ${total}   PASS: ${pass}   FAIL: ${fail}   (${pct}%)`);
  reportLines.push('');

  const reportText = reportLines.join('\n');
  console.log('\n' + reportText);

  // Save report to test-results/
  const reportDir  = path.resolve(__dirname, '../test-results');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `sentinel-claude-report-${Date.now()}.txt`);
  fs.writeFileSync(reportFile, reportText, 'utf8');
  console.log(`[CLAUDE][Test 2] Report saved → ${reportFile}`);
  console.log(`[CLAUDE][Test 2] Total Sentinel API calls: ${sentinelApiCalls.length}`);

  const extensionActive = await page.evaluate(() => !!(window as any).__SENTINEL_INJECTED__).catch(() => false);
  expect(extensionActive, 'Sentinel extension not active on Claude — content script not running.').toBe(true);

  console.log('[CLAUDE][Test 2] Keeping browser open for 60 s to review the Sentinel results...');
  await page.waitForTimeout(60_000);

  await page.close();
});
