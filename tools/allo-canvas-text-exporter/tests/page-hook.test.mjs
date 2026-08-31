import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

class FakeXHR extends EventTarget {
  open() {}
  send() {}
}

const events = [];
const calls = [];
const windowTarget = new EventTarget();

const canvases = [
  { id: "100", name: "Canvas one", project_id: "9", created_by: 7, last_updated_by: 8 },
  { id: "101", name: "Canvas two", project_id: "9", created_by: 8, last_updated_by: 7 }
];

const mockFetch = async (url, init = {}) => {
  const rawBody = typeof init.body === "string"
    ? init.body
    : url instanceof Request
      ? await url.clone().text()
      : "";
  const body = rawBody ? JSON.parse(rawBody) : null;
  calls.push({ url: String(url), body });
  if (String(url) === "/api/csrf-token") return Response.json({ ok: 1, csrf_token: "fresh-token" });
  if (body?.method === "getFileDirectoryTree") {
    if (body.request_id === "original-tree-request") return Response.json({
      ok: 1,
      data: {
        not_modified: false,
        scope: { canvas_count: 2623 },
        references: { canvases: [{ id: "file-only-stale", name: "File tree reference" }], projects: [] }
      }
    });
    assert.equal(body.params[0].if_none_match, undefined);
    return Response.json({ ok: 1, data: { not_modified: false, scope: { canvas_count: 2 }, references: { canvases, projects: [{ id: "9", name: "Admissions" }] } } });
  }
  if (body?.method === "getCanvases") {
    return Response.json({ ok: 1, data: { total: 2, canvases, projects: [{ id: "9", name: "Admissions" }] }, pagination: { has_more: false } });
  }
  if (body?.method === "getCanvasContent") {
    const id = String(body.params[0].canvas_id);
    return Response.json({
      ok: 1,
      data: {
        canvas: {
          title: `Canvas ${id}`,
          content: {
            type: "doc",
            content: [
              { type: "heading", content: [{ type: "text", text: "Assessment summary" }] },
              { type: "paragraph", content: [{ type: "text", text: `Clinical note for ${id}: client denies hallucinations and reports taking medications.` }] }
            ]
          }
        }
      }
    });
  }
  if (body?.method === "updateCanvasContent") return Response.json({ ok: 1 });
  return Response.json({ ok: 1 });
};

Object.assign(windowTarget, {
  fetch: mockFetch,
  location: new URL("https://allo.io/home/files"),
  XMLHttpRequest: FakeXHR,
  XC_SRF: ""
});
windowTarget.addEventListener("allo-canvas-text-page-event", (event) => events.push(event.detail));

const context = vm.createContext({
  window: windowTarget,
  location: windowTarget.location,
  XMLHttpRequest: FakeXHR,
  Headers,
  Response,
  Request,
  URL,
  EventTarget,
  CustomEvent,
  crypto,
  structuredClone,
  setTimeout,
  clearTimeout,
  console
});
vm.runInContext(fs.readFileSync(new URL("../core.js", import.meta.url), "utf8"), context);
vm.runInContext(fs.readFileSync(new URL("../page-hook.js", import.meta.url), "utf8"), context);

await windowTarget.fetch("https://allo.io/api/v2/aw/getFileDirectoryTree", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-bc-anti-cs-rf": "do-not-copy" },
  body: JSON.stringify({ method: "getFileDirectoryTree", params: [{ if_none_match: "etag" }], request_id: "original-tree-request" })
});
windowTarget.location = new URL("https://allo.io/canvases");
await windowTarget.fetch(new Request("https://allo.io/api/v2/aw/getCanvases", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ method: "getCanvases", params: [{ workspace_id: "workspace-1" }], request_id: "original-canvas-list-request" })
}));
await windowTarget.fetch(new Request("https://allo.io/api/v2/aw/getCanvasContent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ method: "getCanvasContent", params: [{ canvas_id: "100" }], request_id: "original-content-request" })
}));
await windowTarget.fetch("https://allo.io/api/v2/aw/updateCanvasContent", {
  method: "POST",
  body: JSON.stringify({ method: "updateCanvasContent", params: [{ canvas_id: "100" }], request_id: "mutation-that-must-not-be-captured" })
});

const waitFor = async (predicate) => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      const observed = events.map((event) => `${event.type}${event.error ? `:${event.error}` : ""}`).join(", ");
      throw new Error(`Timed out waiting for page-hook event. Observed: ${observed}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

await waitFor(() => events.some((event) => event.type === "template-status" && event.pagedCanvasReady && event.contentTemplateCount === 1));

windowTarget.dispatchEvent(new CustomEvent("allo-canvas-text-control", { detail: { action: "start-catalog", runId: "catalog-test" } }));
await waitFor(() => events.some((event) => event.type === "catalog-complete") && events.some((event) => event.type === "content-complete"));
const catalogDone = events.find((event) => event.type === "catalog-complete");
assert.equal(catalogDone.canvasCount, 2);
assert.equal(catalogDone.expectedCanvasCount, 2);
assert.equal(catalogDone.completeCoverage, true);
assert.equal(events.filter((event) => event.type === "catalog-batch").every((event) => event.source === "all-canvases-native-api"), true);

const results = events.filter((event) => event.type === "content-result" && event.runId === "native-catalog-test");
assert.equal(results.length, 2);
assert.equal(results[0].result.plain_text.includes("Clinical note for 100"), true);
assert.equal(results[1].result.plain_text.includes("Clinical note for 101"), true);
assert.equal(calls.filter((call) => call.body?.request_id?.startsWith("ro_canvas_text_exporter_") && call.body?.method === "getCanvasContent").length, 2);
assert.equal(calls.some((call) => call.body?.request_id?.startsWith("ro_canvas_text_exporter_") && call.body?.method === "updateCanvasContent"), false);

console.log("authoritative catalog plus automatic native content export tests passed");
