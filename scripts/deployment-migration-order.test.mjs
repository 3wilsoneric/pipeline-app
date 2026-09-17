import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/deploy-azure.yml", import.meta.url), "utf8");
const step = workflow.split("      - name: Back up and migrate before application rollout\n")[1]?.split("      - name: Deploy runtime and scheduled jobs\n")[0];
assert.ok(step?.includes("if: ${{ !inputs.initial_database_bootstrap }}"));
const script = step.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");

for (const scenario of ["success", "backup-fails", "migration-fails"]) {
  test(`candidate migration order: ${scenario}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "pipeline-deployment-order-"));
    try {
      const log = join(directory, "calls.jsonl");
      writeFileSync(join(directory, "az"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALL_LOG, JSON.stringify(args) + "\\n");
const job = args[args.indexOf("--name") + 1];
if (args[2] === "start") console.log(job + "-this-execution");
else {
  const failed = process.env.TEST_SCENARIO === "backup-fails" ? job.endsWith("backup") : process.env.TEST_SCENARIO === "migration-fails" && job.endsWith("migrate");
  console.log(failed ? "Failed" : "Succeeded");
}
`, { mode: 0o755 });
      const result = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 10_000, env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, RESOURCE_GROUP: "synthetic-group", JOB_PREFIX: "pipeline-prod",
        CANDIDATE_IMAGE: "synthetic.azurecr.io/pipeline:exact-commit", TEST_CALL_LOG: log, TEST_SCENARIO: scenario,
      } });
      assert.equal(result.status, scenario === "success" ? 0 : 1, result.stderr);
      const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
      const starts = calls.filter(args => args[2] === "start");
      assert.deepEqual(starts.map(args => args[args.indexOf("--name") + 1]), scenario === "backup-fails"
        ? ["pipeline-prod-database-backup"] : ["pipeline-prod-database-backup", "pipeline-prod-database-migrate"]);
      for (const args of starts) assert.equal(args[args.indexOf("--image") + 1], "synthetic.azurecr.io/pipeline:exact-commit");
      for (const args of calls.filter(args => args[2] === "execution")) {
        assert.equal(args[args.indexOf("--job-execution-name") + 1], `${args[args.indexOf("--name") + 1]}-this-execution`);
      }
      if (scenario !== "success") assert.match(result.stderr, /Application rollout stopped/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
