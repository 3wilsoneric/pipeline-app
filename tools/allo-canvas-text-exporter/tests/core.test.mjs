import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(new URL("../core.js", import.meta.url), "utf8"), context);
const Core = context.AlloCanvasTextCore;

assert.equal(Core.isSafeReadRequest("POST", { method: "getCanvasContent" }), true);
assert.equal(Core.isSafeReadRequest("POST", { method: "readTask" }), true);
assert.equal(Core.isSafeReadRequest("POST", { method: "updateCanvasContent" }), false);
assert.equal(Core.isSafeReadRequest("POST", { method: "saveTask" }), false);
assert.equal(Core.isSafeReadRequest("DELETE", { method: "getCanvasContent" }), false);
assert.equal(Core.isCanvasCatalogRequest({ method: "getCanvases" }, "/api/v2/aw"), true);
assert.equal(Core.isCanvasCatalogRequest({ method: "getFileDirectoryTree" }, "/api/v2/aw"), false);
assert.equal(Core.hasExplicitCanvasCollection({ data: { canvases: [{ id: "1" }] } }), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(Core.paginationInfo({ data: { pagination: { next_cursor: "page-2", has_more: true } } }))),
  { next: "page-2", hasMore: true, observed: true }
);

const body = { method: "getCanvasContent", params: [{ canvas_id: "100" }], request_id: "abc" };
const paths = Core.findCanvasIdPaths(body);
assert.deepEqual(JSON.parse(JSON.stringify(paths)), [["params", 0, "canvas_id"]]);
Core.setAtPath(body, paths[0], "200");
assert.equal(body.params[0].canvas_id, "200");

const taskBody = { method: "getTask", params: [{ task_id: "100" }] };
assert.deepEqual(JSON.parse(JSON.stringify(Core.findCanvasIdPaths(taskBody))), [["params", 0, "task_id"]]);

const refs = Core.extractReferences({
  data: {
    scope: { canvas_count: 2 },
    references: {
      canvases: [
        { id: 100, name: "One", project_id: 9, created_by: 7 },
        { id: 101, name: "Two", project_id: 9, created_by: 8 }
      ],
      projects: [{ id: 9, name: "Admissions" }]
    }
  }
});
assert.equal(refs.canvases.length, 2);
assert.equal(refs.projects[0].name, "Admissions");

const payload = {
  ok: 1,
  data: {
    canvas: {
      title: "Example assessment",
      content: JSON.stringify({
        type: "doc",
        content: [
          { type: "heading", content: [{ type: "text", text: "Summary" }] },
          { type: "paragraph", content: [{ type: "text", text: "Client denies hallucinations and reports medication adherence." }] }
        ]
      }),
      subtasks: [
        { label: "Pre-assessment complete", checked: true },
        { label: "Post-assessment complete", checked: false }
      ],
      table: { rows: [{ cells: [{ text: "Referral source" }, { text: "Los Angeles County" }] }] }
    }
  }
};
const evidence = Core.extractContentEvidence(payload, "getCanvasContent");
assert.equal(evidence.blocks.some((block) => block.text === "Summary"), true);
assert.equal(evidence.blocks.some((block) => block.text.includes("denies hallucinations")), true);
assert.equal(evidence.blocks.some((block) => block.text === "[x] Pre-assessment complete"), true);
assert.equal(evidence.blocks.some((block) => block.text === "[ ] Post-assessment complete"), true);
assert.equal(evidence.blocks.some((block) => block.text === "Los Angeles County"), true);
assert.equal(evidence.plain_text.includes("denies hallucinations"), true);

assert.equal(Core.contentCandidateScore("/api/v2/getCanvasContent", body, payload) >= 12, true);
assert.equal(Core.contentCandidateScore("/api/v2/getCanvasMembers", { method: "getCanvasMembers", params: [{ canvas_id: "100" }] }, payload), -100);

console.log("core read safety and native text normalization tests passed");
