---
name: "create-and-test-policy"
description: "Create, verify, and delete a custom policy in Sentinel"
author: "Sentinel QA"
tags: ["e2e", "policy", "crud"]
category: "Testing"
---

# Create and Test Policy Skill

## Purpose
Create a new custom security policy, verify it appears in the policy list, and delete it safely.
Used for testing policy lifecycle management and CRUD operations.

## Usage in Tests

```typescript
import { PolicyOps } from '../helpers/test-operations';

test('Full policy lifecycle', async ({ page }) => {
  const policyName = `E2E_POLICY_${Date.now()}`;
  
  // Create
  await PolicyOps.createPolicy(page, policyName, 'Test policy description');
  
  // Verify exists
  const exists = await PolicyOps.verifyPolicyExists(page, policyName);
  expect(exists).toBe(true);
  
  // Delete
  await PolicyOps.deletePolicy(page, policyName);
  
  // Verify deleted
  const stillExists = await PolicyOps.verifyPolicyExists(page, policyName);
  expect(stillExists).toBe(false);
});
```

## Key Features
- **createPolicy()**: Navigate to /policies/new, fill name and description, click Create
- **deletePolicy()**: Locate policy card, click Remove, confirm deletion (handles modal backdrop)
- **verifyPolicyExists()**: Check if policy is visible in /policies list

## Expectations
- Policy creation redirects to /policies list
- Policy name appears in list after creation
- Delete confirmation modal shows "This cannot be undone"
- Modal buttons require dispatchEvent('click') due to backdrop interception
- Policy disappears immediately after delete confirmation

## Error Handling
- Timeouts: 15-20 seconds for navigation and visibility
- Modal backdrop: Uses dispatchEvent() instead of click() to bypass event interception
- Cleanup: Use afterAll() hook with try/catch to ensure test policies are deleted
