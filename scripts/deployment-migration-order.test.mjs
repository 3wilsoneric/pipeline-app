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
      const templatesLog = join(directory, "templates.jsonl");
      writeFileSync(join(directory, "az"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALL_LOG, JSON.stringify(args) + "\\n");
const job = args[args.indexOf("--name") + 1];
if (args[2] === "show") console.log(JSON.stringify({
  containers: [{ name: job.endsWith("backup") ? "database-backup" : "database-migrate", image: "previous-image",
    command: ["node"], args: [job.endsWith("backup") ? "scripts/database-backup-to-azure-blob.mjs" : "scripts/apply-database-migrations.mjs"],
    env: [{name: "PIPELINE_DATABASE_URL", secretRef: "database-migration-url"}], resources: { cpu: 0.5, memory: "1Gi" } }],
  initContainers: [], volumes: []
}));
else if (args[2] === "start") {
  fs.appendFileSync(process.env.TEST_TEMPLATES_LOG, fs.readFileSync(args[args.indexOf("--yaml") + 1], "utf8").replace(/\\n/g, "") + "\\n");
  console.log(job + "-this-execution");
}
else {
  const failed = process.env.TEST_SCENARIO === "backup-fails" ? job.endsWith("backup") : process.env.TEST_SCENARIO === "migration-fails" && job.endsWith("migrate");
  console.log(failed ? "Failed" : "Succeeded");
}
`, { mode: 0o755 });
      const result = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 10_000, env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, RESOURCE_GROUP: "synthetic-group", JOB_PREFIX: "pipeline-prod",
        CANDIDATE_IMAGE: "synthetic.azurecr.io/pipeline:exact-commit", TEST_CALL_LOG: log, TEST_TEMPLATES_LOG: templatesLog, TEST_SCENARIO: scenario,
      } });
      assert.equal(result.status, scenario === "success" ? 0 : 1, result.stderr);
      const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
      const starts = calls.filter(args => args[2] === "start");
      assert.deepEqual(starts.map(args => args[args.indexOf("--name") + 1]), scenario === "backup-fails"
        ? ["pipeline-prod-database-backup"] : ["pipeline-prod-database-backup", "pipeline-prod-database-migrate"]);
      const templates = readFileSync(templatesLog, "utf8").trim().split("\n").map(line => JSON.parse(line));
      for (const [index, args] of starts.entries()) {
        assert.ok(args.includes("--yaml"));
        assert.ok(!args.includes("--image"));
        const backup = index === 0;
        assert.deepEqual(templates[index], {
          containers: [{ name: backup ? "database-backup" : "database-migrate", image: "synthetic.azurecr.io/pipeline:exact-commit",
            command: ["node"], args: [backup ? "scripts/database-backup-to-azure-blob.mjs" : "scripts/apply-database-migrations.mjs"],
            env: [{ name: "PIPELINE_DATABASE_URL", secretRef: "database-migration-url" }], resources: { cpu: 0.5, memory: "1Gi" } }],
          initContainers: [], volumes: [],
        });
      }
      for (const args of calls.filter(args => args[2] === "execution")) {
        assert.equal(args[args.indexOf("--job-execution-name") + 1], `${args[args.indexOf("--name") + 1]}-this-execution`);
      }
      if (scenario !== "success") assert.match(result.stderr, /Application rollout stopped/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
