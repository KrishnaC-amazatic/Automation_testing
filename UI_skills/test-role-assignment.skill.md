---
name: "test-role-assignment"
description: "Test role changes for organization members with persistence verification"
author: "Sentinel QA"
tags: ["e2e", "roles", "rbac"]
category: "Testing"
---

# Test Role Assignment Skill

## Purpose
Verify role assignment functionality for organization members:
- Change roles (Admin → Analyst → User)
- Verify UI updates immediately
- Confirm persistence after reload
- Validate admin role is immutable

## Usage in Tests

```typescript
import { RoleOps } from '../helpers/test-operations';

test('Role change and persistence', async ({ page }) => {
  await navigateTo(page, '/org');
  
  // Find a User-role member to test
  const target = await RoleOps.findEditableUserRole(page);
  if (!target) {
    test.skip();
    return;
  }
  
  const { email } = target;
  
  // Change from User to Analyst
  await RoleOps.changeRole(page, email, 'Analyst');
  
  // Verify persistence
  const persists = await RoleOps.verifyRolePersists(page, email, 'Analyst');
  expect(persists).toBe(true);
  
  // Change back to User
  await RoleOps.changeRole(page, email, 'User');
});
```

## Key Features
- **findEditableUserRole()**: Locate first User-role member for safe testing
- **changeRole()**: Select new role from combobox, wait for update (2s timeout)
- **verifyRolePersists()**: Reload page, verify role change saved in backend

## Safety Rules
- **NEVER change the admin role** (logged-in user's role is immutable)
- Target only User-role members (safest to change)
- Use aria-label matching for member identification
- Always revert changes after test (change back to original role)

## UI Facts
- Role combobox per member row (Admin | Analyst | User)
- Admin row: role shown as static text (not a combobox)
- Change is instant (no explicit Save button) — uses PATCH request
- aria-label format: "Role for [email]"

## Expected Behavior
- Combobox selectOption({ label: 'Analyst' }) updates UI immediately
- Role change triggers backend PATCH request
- Reload re-fetches role from backend (confirms persistence)
- Admin role cannot be changed (combobox not present on admin row)
- Role value is case-insensitive ("user" === "User")

## Error Handling
- findEditableUserRole() returns null if no User-role members found → skip test
- selectOption() may fail if role already selected → catch and continue
- Reload may take up to 10s (networkidle timeout)
