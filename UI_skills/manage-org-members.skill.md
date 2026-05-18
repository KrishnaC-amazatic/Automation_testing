---
name: "manage-org-members"
description: "Test member management operations: list, verify, delete"
author: "Sentinel QA"
tags: ["e2e", "members", "organization"]
category: "Testing"
---

# Manage Organization Members Skill

## Purpose
Test member lifecycle operations on the Organization page (/org):
- Load member table
- Retrieve member list
- Delete members safely
- Verify admin protection

## Usage in Tests

```typescript
import { MemberOps } from '../helpers/test-operations';

test('Member deletion workflow', async ({ page }) => {
  // Load org page with members table
  await MemberOps.loadOrgPage(page);
  
  // Get all non-admin members
  const members = await MemberOps.getMemberRows(page);
  console.log('Members:', members);
  
  // Delete a specific test member
  const testMember = members.find(email => email.includes('test'));
  if (testMember) {
    await MemberOps.deleteMember(page, testMember);
  }
  
  // Verify admin is protected
  await MemberOps.verifyAdminRowProtected(page, 'amol.s@amazatic.com');
});
```

## Key Features
- **loadOrgPage()**: Navigate to /org, wait for network idle, verify table visible
- **getMemberRows()**: Extract all member email addresses from table rows
- **deleteMember()**: Click Remove, confirm in modal, verify removal
- **verifyAdminRowProtected()**: Ensure logged-in admin has no Remove button

## Safety Rules
- **NEVER delete the currently logged-in admin** (amol.s@amazatic.com)
- **NEVER delete the last remaining admin**
- Only delete members whose email contains "e2e", "test_user", "playwright", or "delete_me"
- Always check admin row is protected (no Remove button)

## UI Facts
- Members table: role combobox + Remove button per row
- Logged-in admin: shown with "(you)" suffix, no Remove button
- Confirmation modal: uses force: true for button clicks (backdrop interception)

## Expected Behavior
- Admin row is immutable (no Remove button visible)
- Delete opens confirmation: "This cannot be undone"
- Member disappears from table after confirmation
- Deletion persists after page reload
