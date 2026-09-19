import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const groupId = "/subscriptions/test/resourceGroups/test/providers/microsoft.insights/actionGroups/operators";
const queryKeys = [...readFileSync("infra/azure/operational-alerts.bicep", "utf8").matchAll(/key:\s*'([^']+)'/g)].map((match) => match[1]);
function inventory() {
  return {
    scheduled: queryKeys.map((key) => ({ name: `pipeline-prod-${key}`, enabled: true, actions: { actionGroups: [groupId] } })),
    metrics: ["postgres-connections", "postgres-storage", "blob-capacity", "web-restarts", "web-timeouts"].map((key) => ({ name: `pipeline-prod-${key}`, enabled: true, actions: [{ actionGroupId: groupId }] })),
    groups: [{ id: groupId.toUpperCase(), enabled: true, emailReceivers: [{ name: "synthetic-operator" }] }],
  };
}

function audit(data) {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-alert-audit-"));
  try {
    // Stub only read-only Azure inventory; tests never invoke the real CLI.
    writeFileSync(join(directory, "az"), `#!${process.execPath}\nconst args = process.argv.slice(2).join(' '); const data = JSON.parse(process.env.AUDIT_TEST_INVENTORY); const key = args.includes('scheduled-query list') ? 'scheduled' : args.includes('metrics alert list') ? 'metrics' : args.includes('action-group list') ? 'groups' : null; if (!key) process.exit(99); console.log(JSON.stringify(data[key]));\n`, { mode: 0o700 });
    const result = spawnSync(process.execPath, ["scripts/azure-operational-alert-audit.mjs", "--strict"], {
      encoding: "utf8",
      env: { ...process.env, PATH: directory, PIPELINE_AZURE_RESOURCE_GROUP: "test", PIPELINE_AZURE_NAME_PREFIX: "pipeline", PIPELINE_AZURE_ENVIRONMENT: "prod", AUDIT_TEST_INVENTORY: JSON.stringify(data) },
    });
    assert.equal(result.error, undefined);
    return { code: result.status, report: JSON.parse(result.stdout) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("all alerts linked to enabled receivers pass configuration, not delivery", () => {
  const { code, report } = audit(inventory());
  assert.equal(code, 0);
  assert.equal(report.notification_configuration_ready, true);
  assert.equal(report.delivery_verified, false);
  assert.equal(report.expected.metric_alerts, 5);
});

test("unattached runtime alerts fail even when other alerts have receivers", () => {
  const data = inventory();
  data.metrics.at(-1).actions = [];
  const { code, report } = audit(data);
  assert.equal(code, 1);
  assert.deepEqual(report.unconnected_alerts, ["pipeline-prod-web-timeouts"]);
});

for (const condition of ["disabled", "empty", "unknown"]) {
  test(`${condition} action group cannot qualify as notification ready`, () => {
    const data = inventory();
    if (condition === "disabled") data.groups[0].enabled = false;
    if (condition === "empty") data.groups[0].emailReceivers = [];
    if (condition === "unknown") data.groups[0].id += "-different";
    const { code, report } = audit(data);
    assert.equal(code, 1);
    assert.equal(report.notification_configuration_ready, false);
  });
}

test("missing runtime rule fails coverage", () => {
  const data = inventory();
  data.metrics.pop();
  assert.deepEqual(audit(data).report.missing_metric_alerts, ["pipeline-prod-web-timeouts"]);
});

test("disabled expected alert fails", () => {
  const data = inventory();
  data.scheduled[0].enabled = false;
  assert.equal(audit(data).code, 1);
});
