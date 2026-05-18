---
name: "test-shadow-ai-controls"
description: "Test Shadow AI WARN/BLOCK policy enforcement and persistence"
author: "Sentinel QA"
tags: ["e2e", "shadow-ai", "policies"]
category: "Testing"
---

# Test Shadow AI Controls Skill

## Purpose
Verify Shadow AI policy enforcement settings (Allow/Warn/Block):
- Load Shadow AI page
- Read current service action state
- Change action (Warn → Block → Allow)
- Save controls
- Verify persistence after reload

## Usage in Tests

```typescript
import { ShadowAIOps } from '../helpers/test-operations';

test('Shadow AI action persistence', async ({ page }) => {
  await ShadowAIOps.navigateToSettings(page);
  
  // Read current action
  const current = await ShadowAIOps.getActiveAction(page, 'ChatGPT (Web)');
  console.log('Current action:', current);
  
  // Change to Block
  await ShadowAIOps.setAction(page, 'ChatGPT (Web)', 'Block');
  await ShadowAIOps.saveControls(page);
  
  // Reload and verify
  await page.reload();
  const after = await ShadowAIOps.getActiveAction(page, 'ChatGPT (Web)');
  expect(after).toBe('Block');
  
  // Restore original
  if (current) {
    await ShadowAIOps.setAction(page, 'ChatGPT (Web)', current as any);
    await ShadowAIOps.saveControls(page);
  }
});
```

## Key Features
- **navigateToSettings()**: Go to /shadow-ai, wait for networkidle
- **getActiveAction()**: Inspect button CSS classes to find active action
- **setAction()**: Click Allow/Warn/Block button for a service
- **saveControls()**: Click "Save Controls" button and wait for persist

## Service Detection
- Finds service row by exact name match (regex: `^${serviceName}$`)
- Uses CSS class inspection to determine active button state
- Looks for: bg- classes, opacity indicators, color classes (teal/yellow/red-500)
- Fallback: aria-pressed="true" or data-active="true" attributes

## UI Facts
- Each service row has three buttons: Allow | Warn | Block
- "Save Controls" button at top-right saves all changes
- No explicit "active" ARIA attribute (uses CSS class inspection)
- Service rows are within expandable containers

## Expected Behavior
- Button click updates active state immediately in UI
- Click "Save Controls" persists to backend
- Page reload fetches fresh state from backend
- All changes reflected in re-inspection after reload
- Service action options: Allow (green), Warn (yellow), Block (red)

## Known Issues
- getActiveAction() must inspect CSS classes due to lack of ARIA attributes
- Button may not have distinguishing class on inactive state
- Multiple services may have similar button arrangements
- First matching button with active indicators is selected

## Cleanup
Use beforeAll() to save original action, afterAll() to restore:
```typescript
test.beforeAll(async ({ browser }) => {
  originalAction = await getActiveAction(page, TARGET_SERVICE);
});

test.afterAll(async ({ browser }) => {
  if (originalAction) {
    await setAction(page, TARGET_SERVICE, originalAction);
    await saveControls(page);
  }
});
```
