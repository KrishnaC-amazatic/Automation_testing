---
description: "Generate comprehensive E2E test scenarios for Sentinel using Playwright and test-operations helpers"
tags: ["testing", "playwright", "e2e", "sentinel"]
---

# Generate Sentinel E2E Test Scenario

## Purpose
Create a new Playwright test file (.spec.ts) that validates a specific Sentinel feature or bug fix using reusable test operations and proper safety guardrails.

## Instructions

You are an expert Playwright test engineer. When asked to generate a test for a Sentinel issue, follow these steps:

### 1. Analyze the Issue
Extract:
- **Bug/Feature**: What is being tested?
- **Severity**: Critical, High, Medium, or Low?
- **User Role**: Admin, Analyst, User?
- **Page/Feature**: Which Sentinel page (e.g., /policies, /org, /shadow-ai)?
- **Expected Behavior**: What should happen?
- **Risk**: What could break this?

### 2. Design Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { navigateTo } from '../helpers/page-helpers';
import { [RELEVANT_OPS] } from '../helpers/test-operations';
import { ConsoleMonitor } from '../helpers/console-monitor';

const UNIQUE_ID = `E2E_TESTDATA_${Date.now()}`;

test.describe('Bug #N: [Feature Name]', () => {
  test.beforeAll(async ({ browser }) => {
    // Save original state (if modifying existing data)
  });

  test.afterAll(async ({ browser }) => {
    // Cleanup: delete test data, restore original state
  });

  test('Setup: [Create precondition]', async ({ page }) => {
    // Only if needed: create test data
  });

  test('[Main scenario] [Verify expected behavior]', async ({ page }) => {
    // Core test steps
  });

  test('[Verification] Persists after reload', async ({ page }) => {
    // Reload and re-check
  });
});
```

### 3. Select Appropriate Operations

| Feature | Operations to Use |
|---------|-------------------|
| Policy CRUD | `PolicyOps.createPolicy()`, `deletePolicy()`, `verifyPolicyExists()` |
| Member Management | `MemberOps.loadOrgPage()`, `getMemberRows()`, `deleteMember()` |
| Role Assignment | `RoleOps.findEditableUserRole()`, `changeRole()`, `verifyRolePersists()` |
| Shadow AI Config | `ShadowAIOps.navigateToSettings()`, `getActiveAction()`, `setAction()`, `saveControls()` |
| Authentication | `AuthOps.verifyAdminLoggedIn()`, `signOut()` |

### 4. Apply Safety Rules

**Policies:**
- Use timestamp-based naming: `E2E_POLICY_DELETE_ME_${Date.now()}`
- Always cleanup in `test.afterAll()` with try/catch
- Never delete system policies

**Members:**
- **NEVER delete**: `amol.s@amazatic.com`
- **NEVER delete**: Last admin
- Only delete members matching `/e2e|test_user|playwright|delete_me/i`
- Verify admin protection: `MemberOps.verifyAdminRowProtected()`

**Roles:**
- Never change admin role
- Use `RoleOps.findEditableUserRole()` to find safe targets
- Always revert after testing
- Verify persistence with reload

**Shadow AI:**
- Save original action in `test.beforeAll()`
- Restore in `test.afterAll()`
- Use CSS inspection for state detection

### 5. Error Handling & Monitoring

```typescript
test('Scenario', async ({ page }) => {
  const monitor = new ConsoleMonitor(page);
  
  try {
    // ... test steps ...
  } finally {
    if (monitor.hasCriticalErrors()) {
      console.error(`[${test.info().title}] ${monitor.report()}`);
    }
  }
});
```

### 6. Timeout Guidance

- Navigation: 20s
- Element visibility: 15s
- Network idle: 10s
- Modal confirmation: 5s
- State updates: 2s

### 7. Modal Interaction

Sentinel modals have backdrop event interception:

```typescript
// ✅ CORRECT
await page.getByRole('button', { name: 'Remove' }).dispatchEvent('click');
await clickModalButton(page, 'Remove');

// ❌ WRONG
await page.getByRole('button', { name: 'Remove' }).click();
```

## Example: Testing Policy Deletion

```typescript
import { test, expect } from '@playwright/test';
import { navigateTo } from '../helpers/page-helpers';
import { PolicyOps } from '../helpers/test-operations';
import { ConsoleMonitor } from '../helpers/console-monitor';

const POLICY_NAME = `E2E_TEST_POLICY_${Date.now()}`;

test.describe('Bug #2: Custom policy deletion', () => {
  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      if (await PolicyOps.verifyPolicyExists(page, POLICY_NAME)) {
        await PolicyOps.deletePolicy(page, POLICY_NAME);
      }
    } finally {
      await ctx.close();
    }
  });

  test('Create policy successfully', async ({ page }) => {
    const monitor = new ConsoleMonitor(page);
    await PolicyOps.createPolicy(page, POLICY_NAME, 'E2E test cleanup');
    const exists = await PolicyOps.verifyPolicyExists(page, POLICY_NAME);
    expect(exists).toBe(true);
    if (monitor.hasCriticalErrors()) {
      console.error(monitor.report());
    }
  });

  test('Delete policy and verify disappearance', async ({ page }) => {
    const monitor = new ConsoleMonitor(page);
    await PolicyOps.deletePolicy(page, POLICY_NAME);
    const stillExists = await PolicyOps.verifyPolicyExists(page, POLICY_NAME);
    expect(stillExists).toBe(false);
  });
});
```

## Quality Checklist

- ✅ Test name describes the scenario, not implementation
- ✅ Uses reusable operations from `test-operations.ts`
- ✅ Includes console monitoring
- ✅ Has cleanup in `test.afterAll()` with try/catch
- ✅ Respects safety rules (admin protection, test data patterns)
- ✅ Proper timeouts for each operation type
- ✅ Modal interactions use `dispatchEvent('click')`
- ✅ Verifies persistence after reload (where applicable)
- ✅ No hardcoded URLs (use `navigateTo()`)
- ✅ Comments explain non-obvious logic

## Common Pitfalls to Avoid

1. **Deleting admin**: Check for "(you)" suffix or use email from `.env`
2. **Modal clicks failing**: Use `dispatchEvent()` not `.click()`
3. **Flaky reload checks**: Always wait for `networkidle` after reload
4. **Missing cleanup**: Use `test.afterAll()` for every data-creation test
5. **Ignored console errors**: Always add `ConsoleMonitor` and check for critical errors
6. **Hardcoded test data**: Use `Date.now()` for uniqueness

## Output Format

When generating a test, output:
1. Test file path: `/home/ah0134/Music/tests/e2e/[feature].spec.ts`
2. Full TypeScript code with proper formatting
3. Brief explanation of test structure
4. Safety considerations
