# Chart document access

Local UI refinement, 2026-09-22. Not deployed.

- The existing upload owner now appears above a saved referral's chart, both before and after an assessment exists. It is not added to the interview or assessment signing page.
- Drop/browse remains visible when Documents is collapsed. Pending files, validation errors and file-list retry remain visible too.
- Existing files expand beneath the strip. The filename/thumbnail opens preview; the redundant Preview link and Uploaded files heading were removed.
- Add updated copy opens the existing label dialog with a suggested document type. It uses the existing upload, retry, storage and audit path. It does not edit file bytes, delete the original, or silently replace existing checklist evidence or assessment answers. Signature status is not inferred from the old copy.

## Deliberate boundary

This is an updated-copy shortcut, not versioned replacement. A future request to retire originals or automatically switch checklist/packet evidence requires an explicit replacement transaction with optimistic work-item versions, recoverable intent and attachment-selection tests. Do not rename this action Replace without implementing those semantics.

## Verification

Focused coverage: `tests/e2e/chart-documents.spec.ts`, `tests/e2e/intake-file-drop.spec.ts`, `tests/e2e/referral-file-batches.spec.ts`. Synthetic files only. Includes creation/reopen at phone, tablet and desktop widths; drag/drop; canceled labeling; failed upload and retry; original/new bytes; preserved evidence; assessment isolation; read-only drops; Chromium/WebKit and axe checks.

The existing desktop-only encrypted recovery test is skipped without the desktop build flag. No backend, authorization, storage or recovery formats changed.

Final result: 11 browser tests passed, 1 desktop-only test skipped. Build, TypeScript, focused ESLint, diff checks and the existing complexity check passed. Screenshots at 390, 834 and 1440 pixels were inspected. The mirrored local preview on port 3385 was opened and its upload strip verified without changing workspace documents.

Test corrections retained the same behavior assertions: phone navigation uses the existing Workspace view select, file validation is now outside the collapsed panel, and creation handoff is explicitly dismissed before reload. The first updated-copy test wrongly assumed automatic checklist replacement; the canonical reconciliation deliberately preserves existing evidence. Its final assertion now pins that protection and verifies both original and new bytes. A transient first-upload polling timeout was investigated with a traced rerun; the final batch passed with client-specific synthetic file contents. The isolated test environment has no private recipient-list configuration, so its unrelated contact-list endpoints return 503.
