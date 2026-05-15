# Guardrail Sentinel — Playwright Automation Test Suite

Automated end-to-end test that loads the **Guardrail Sentinel** Chrome extension, signs in, submits 28 test prompts to ChatGPT, and validates the extension's decision (BLOCK / WARN / REDACT / ALLOW) for each one.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 18 or later | [nodejs.org](https://nodejs.org) |
| **npm** | 9 or later | Comes with Node.js |
| **Google Chrome** | Any recent stable | Must be installed on the machine |
| **Guardrail Sentinel account** | — | Valid login credentials required |

> **Windows** — file-dialog automation uses PowerShell `SendKeys` (fully automatic).  
> **Linux / macOS** — the native file dialog cannot be automated; load the extension manually once on first run (see [First-Time Setup](#first-time-setup)).

---

## Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd Automation_testing

# 2. Install dependencies
npm install

# 3. Install Playwright browser binaries
npx playwright install chromium
```

**Linux — also install Chrome:**

```bash
# Debian / Ubuntu
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable

# Verify install path
which google-chrome-stable
# → /usr/bin/google-chrome-stable  (use this in CHROME_EXE)
```

---

## Configure .env

All machine-specific and sensitive values live in `.env`. It is **never committed to git**.

**Step 1 — Copy the example file:**

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

**Step 2 — Open `.env` and update these three values:**

```env
# Full path to Google Chrome on your machine

# Windows (default install path):
CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe

# Linux (after installing google-chrome-stable):
# CHROME_EXE=/usr/bin/google-chrome-stable

# macOS:
# CHROME_EXE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome

# Your Guardrail Sentinel login credentials
SENTINEL_EMAIL=your-email@example.com
SENTINEL_PASSWORD=your-password
```

> The other two keys (`EXTENSION_FOLDER`, `USER_DATA_DIR`) can stay as-is.

---

## First-Time Setup

### 1. Extension loading

**Windows** — fully automatic. The test opens `chrome://extensions`, enables Developer Mode, and types the extension path into the file dialog via PowerShell. Nothing required from you.

**Linux / macOS** — the native file picker cannot be automated. Do this **once**:
1. Run `npx playwright test --reporter=list` — Chrome opens and navigates to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `sentinel-extension-chrome-v0.5.52/` folder
4. The test continues automatically

Once loaded, the extension persists in `.playwright-user-data/` — you never need to repeat this.

### 2. ChatGPT login (one-time)
1. The test navigates to `https://chatgpt.com/`
2. It clicks **Log in → Continue with Google**
3. A Google account picker opens — **select your account manually**
4. The test continues automatically once ChatGPT loads

Your session is saved and all future runs skip this step.

### 3. Sentinel sign-in
The test signs in to the Sentinel extension popup automatically using the credentials from your `.env`.

---

## Running the Tests

```bash
# Run the full suite
npx playwright test --reporter=list
```

**Linux — if Chrome crashes with a sandbox error**, add `--no-sandbox` (already included in the spec args, but some distros also need):

```bash
# Only if you see "No usable sandbox" errors in output
export PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS="--no-sandbox"
npx playwright test --reporter=list

with npm
npm test
```

> Keep the browser window visible — do not minimise it. Chrome may throttle the extension service worker if the window is hidden.

**Expected run time:** ~23 minutes (2 min setup + 28 prompts × ~45 s each)

After the run, reports are saved to `test-results/`:
- `sentinel-report-<timestamp>.txt` — plain-text table
- `sentinel-report-<date>.html` — formatted report, open in any browser


### Sentinel injected UI

These selectors come directly from the extension's `sentinel-cs.js` source and are stable as long as the extension version does not change:

| Constant | Selector | When visible |
|----------|----------|--------------|
| `SENTINEL_BLOCK_BANNER` | `#sentinel-block-banner` | Policy decision = BLOCK |
| `SENTINEL_WARN_OVERLAY` | `#sentinel-overlay-root` | Policy decision = WARN |
| `SENTINEL_REDACT_TOAST` | `#sentinel-redact-toast` | Policy decision = REDACT |
| `SENTINEL_ORPHAN_BADGE` | `#sentinel-orphan-badge` | Extension context invalidated |

If you update the extension ZIP, re-extract it into `extension-build/` and re-check these selectors against the new `sentinel-cs.js`.

---

## Changing the test prompt

The default prompt is designed to look like sensitive data (SSN + credit card number) to trigger a WARN or BLOCK policy decision:

```ts
const TEST_PROMPT =
  'My SSN is 123-45-6789 and my credit card number is 4111 1111 1111 1111. ...';
```

