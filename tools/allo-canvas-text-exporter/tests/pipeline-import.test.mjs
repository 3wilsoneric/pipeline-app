import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const directory = await mkdtemp(path.join(os.tmpdir(), "allo-canvas-text-import-"));
const input = path.join(directory, "canvas-content.jsonl");
const output = path.join(directory, "manifest.json");

try {
  const records = [
    { metadata: { format: "allo-canvas-native-content-v1" } },
    {
      captured_at: "2026-08-01T12:00:00.000Z",
      canvas: { id: "synthetic-100", name: "Synthetic assessment", project_id: "project-9" },
      project: { id: "project-9", name: "Synthetic admissions" },
      blocks: [
        {
          order: 0,
          kind: "rendered_canvas",
          text: "Summary\nClient denies hallucinations.\nInterview\nReports sleeping well.\n❗INSTRUCTIONS❗\nFill out documentation here.",
          source_method: "rendered-dom",
          source_path: "dialog"
        }
      ],
      plain_text: "Summary\nClient denies hallucinations.\nInterview\nReports sleeping well.\n❗INSTRUCTIONS❗\nFill out documentation here."
    }
  ];
  await writeFile(input, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, { mode: 0o600 });
  await execute(process.execPath, ["scripts/prepare-allo-canvas-content.mjs", `--input=${input}`, `--output=${output}`], { cwd: path.resolve(import.meta.dirname, "../../..") });

  const manifest = JSON.parse(await readFile(output, "utf8"));
  assert.equal(manifest.canvas_count, 1);
  assert.equal(manifest.snapshots[0].source_canvas_id, "synthetic-100");
  assert.equal(manifest.snapshots[0].capture_method, "native_export");
  assert.equal(manifest.snapshots[0].candidates[0].proposed_value.includes("Client denies hallucinations."), true);
  assert.equal(manifest.snapshots[0].candidates[0].proposed_value.includes("Reports sleeping well."), true);
  assert.equal(manifest.snapshots[0].candidates[0].proposed_value.includes("Fill out documentation here."), false);
  assert.equal((await stat(output)).mode & 0o777, 0o600);

  console.log("Chrome extension output to Pipeline staging test passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
