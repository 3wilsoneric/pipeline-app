# ALLO Canvas Notes Extractor

This unpacked Chrome extension exports ALLO canvas notes from a stable, locally imported inventory. It uses the existing signed-in Chrome session, deduplicates canvas IDs from the prior ALLO file manifest, opens one canvas to observe ALLO's own read-only content request, and replays that request for every imported canvas ID. Rendered UI traversal is retained only as a fallback and can never report completion without verified full coverage.

## Safety boundary

- Same-origin requests to `https://allo.io` only.
- Replays only RPC methods beginning with `get`, `list`, `fetch`, `read`, `search`, `load`, `find`, `query`, `retrieve`, or `view`.
- Rejects mutation verbs including `add`, `invite`, `update`, `set`, `remove`, `delete`, `create`, `save`, `write`, `upsert`, `publish`, and `submit`.
- Does not inspect or export cookies, authorization headers, passwords, or stored browser credentials.
- Uses a fresh ALLO CSRF token for each read request.
- Writes only to Chrome extension-local storage and Chrome Downloads.
- Preserves raw read evidence locally so extraction logic can be improved without rereading ALLO.
- UI fallback clicks only canvas-open and canvas-close controls; it does not click menus, checkboxes, fields, or actions.

ALLO transports some reads through `POST`. The extension validates the inner RPC method and refuses mutation-like methods instead of assuming every `POST` is a write.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `tools/allo-canvas-text-exporter` from this repository.

## Run

1. In the Chrome session already signed into ALLO, open the extension. No second browser login, reload, or manual scrolling is required.
2. Choose the existing `allo-file-manifest.csv`. The extension reads it locally and imports one deduplicated entry per `canvas_id`.
3. Click **Extract canvas notes**. The extension creates its own inactive, non-discardable ALLO worker tab and opens a known canvas by ID.
4. You may navigate away, switch tabs, or close the popup. The worker reads every imported canvas without modifying it.
5. Track the run from the extension badge, the popup's captured/discovered/stage line, or the status overlay in the worker tab. The count advances only after a canvas has been captured and retained.
6. Reopen the extension after the run completes and download:
   - `canvas-content-summary.csv`: canvas/project identity, counts, and read status.
   - `canvas-content.jsonl`: normalized native blocks and exact plain text for Pipeline staging.
   - `canvas-content-evidence.jsonl`: normalized output plus the raw read responses used as evidence.

All three downloads can contain PHI. Keep them in an approved encrypted location and delete working copies after the controlled import is reconciled.

## What it does not do

- It does not OCR attached PDFs or images; those stay in Pipeline's document-extraction lane.
- It does not treat the Files directory or file count as the authoritative canvas inventory.
- It does not infer diagnoses, medications, or decisions.
- It does not write directly to Pipeline or ALLO.
- It does not silently accept partial canvas coverage.
- It does not label a run complete when the authoritative catalog or content batch is incomplete.
- A file manifest inventories file-backed canvases. Its imported count is reported explicitly and is not represented as the total number of all ALLO canvases.

## Local verification

```bash
npm run test:allo-canvas-extension
```
