import assert from "node:assert/strict";
import test from "node:test";
import { deploymentMailSettings } from "./preserve-deployment-mail.mjs";

test("preserves the dedicated tenant, mail hold, sender and only referenced mail credentials", () => {
  const environment = [
    { name: "PIPELINE_GRAPH_TENANT_ID", value: "dedicated-mail-tenant" },
    { name: "PIPELINE_GRAPH_CLIENT_SECRET", secretRef: "mail-secret" },
    { name: "PIPELINE_MEET_CLIENT_LIVE_ENABLED", value: "false" },
    { name: "PIPELINE_MEET_CLIENT_SENDER", value: "admissions@example.test" },
    { name: "PIPELINE_DATABASE_URL", secretRef: "database-secret" },
    { name: "PIPELINE_DEMO_MODE", value: "true" },
  ];
  assert.deepEqual(deploymentMailSettings(environment, [{ name: "mail-secret", value: "synthetic-credential" }, { name: "database-secret", value: "exclude" }]), {
    environment: environment.slice(0, 4), secrets: [{ name: "mail-secret", value: "synthetic-credential" }],
  });
});
test("preserves Key Vault identity and deduplicates shared secret bindings", () => {
  const env = [{ name: "PIPELINE_GRAPH_CLIENT_SECRET", secretRef: "mail" }, { name: "PIPELINE_MEET_CLIENT_OTHER", secretRef: "mail" }];
  const secret = { name: "mail", keyVaultUrl: "https://example.vault.azure.net/secrets/mail", identity: "identity-resource", value: "must-not-copy" };
  assert.deepEqual(deploymentMailSettings(env, [secret]).secrets, [{ name: "mail", keyVaultUrl: secret.keyVaultUrl, identity: secret.identity }]);
});
test("fails closed if Azure does not return the configured credential", () => {
  const env = [{ name: "PIPELINE_GRAPH_CLIENT_SECRET", secretRef: "mail" }];
  assert.throws(() => deploymentMailSettings(env, []), /could not be preserved/);
  assert.throws(() => deploymentMailSettings(env, [{ name: "mail" }]), /could not be preserved/);
});
test("a fresh deployment has no existing mail settings", () => {
  assert.deepEqual(deploymentMailSettings([], []), { environment: [], secrets: [] });
});
