import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { capturePipelineCatalog } from "./export-proforma-catalog.mjs";

test("catalog reads only committed definitions, exported contracts and routes; working data cannot leak", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pipeline-catalog-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ["lib/assessment/assessment-context.ts", "lib/assessment/assessment-tool-schema.ts",
    "lib/assessment/assessment-interview-schema.ts", "lib/assessment/assessment-completion.ts",
    "lib/assessment/assessment-history.ts", "lib/pipeline/client-identity-presentation.mjs"]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), await readFile(file));
  }
  await mkdir(path.join(root, "app/api/fictional"), { recursive: true });
  await writeFile(path.join(root, "app/api/fictional/route.ts"), 'export async function GET() { return Response.json({}); }\n');
  await writeFile(path.join(root, ".env"), "SYNTHETIC_SECRET_MUST_NOT_EXPORT=example\n");
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "--quiet"); git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fictional source");
  const ref = git("rev-parse", "HEAD").trim();
  const first = await capturePipelineCatalog({ repository: root, ref });
  await writeFile(path.join(root, "lib/assessment/assessment-tool-schema.ts"), "WORKING_CHANGE_MUST_NOT_EXPORT");
  const second = await capturePipelineCatalog({ repository: root, ref });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert(!JSON.stringify(first).includes("SYNTHETIC_SECRET_MUST_NOT_EXPORT"));
  assert.equal(first.revision, ref);
  assert(first.definitions.fields.length > 100);
  assert(first.definitions.fields.some((field) => field.question?.options?.length));
  assert.equal(first.endpoints.length, 1); assert.equal(first.endpoints[0].id, "GET /api/fictional");
  assert(first.models.some((model) => model.name === "AssessmentToolRecord"));
  assert.equal(first.coverage.executionEnabled, false);
});
