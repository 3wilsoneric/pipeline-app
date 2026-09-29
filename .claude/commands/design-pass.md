---
description: Apply the design principles to one screen, audit first
argument-hint: <screen or route, e.g. "referral board" or "decision tab">
---

Apply docs/design/PRINCIPLES.md to: $ARGUMENTS

Rules for this task:
- Visual changes only. Do not add, remove, or reword any user-facing text. If a principle seems to require new text, list it as a question instead.
- Use the design tokens file for every color, radius, shadow, type size, and motion value. If the tokens file doesn't exist yet, propose one and stop for approval before creating it.
- If the stage-to-color mapping for this screen isn't defined in the tokens, stop and ask.
- Add no new runtime dependencies.

Step 1, audit (no code changes):
Find the components that render this screen. For each of the 10 principles, report pass, fail, or not applicable, with the file and the specific element for every fail. Then list the changes you would make, grouped by component. Stop and wait for approval.

Step 2, implement:
After approval, make the approved changes. Keep diffs scoped to styling and structure.

Step 3, verify:
Run the app or its tests, re-check each principle for this screen, and report pass or fail per principle. Confirm that no user-facing strings changed by diffing string literals in the touched files.
