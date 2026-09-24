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


test("explicit activation replaces only the hold while preserving sender, domains and credentials", () => {
  const env = [
    { name: "PIPELINE_MEET_CLIENT_LIVE_ENABLED", value: "false" },
    { name: "PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS", value: "example.test" },
    { name: "PIPELINE_GRAPH_TENANT_ID", value: "mail-tenant" },
    { name: "PIPELINE_GRAPH_CLIENT_SECRET", secretRef: "mail" },
  ];
  const secret = { name: "mail", keyVaultUrl: "https://example.vault.azure.net/secrets/mail", identity: "identity" };
  const enabled = deploymentMailSettings(env, [secret], "enabled");
  assert.deepEqual(enabled.environment.slice(0, 3), env.slice(1));
  assert.deepEqual(enabled.environment.at(-1), { name: "PIPELINE_MEET_CLIENT_LIVE_ENABLED", value: "true" });
  assert.deepEqual(enabled.secrets, [secret]); assert.equal(env[0].value, "false");
  const preserved = deploymentMailSettings(enabled.environment, [secret]);
  assert.deepEqual(preserved, enabled);
  const disabled = deploymentMailSettings(enabled.environment, [secret], "disabled");
  assert.equal(disabled.environment.at(-1).value, "false");
  assert.deepEqual(disabled.secrets, [secret]);
});

test("explicit activation needs no domain allowlist and rejects unknown activation values", () => {
  assert.deepEqual(deploymentMailSettings([], [], "enabled"), { environment: [{ name: "PIPELINE_MEET_CLIENT_LIVE_ENABLED", value: "true" }], secrets: [] });
  assert.throws(() => deploymentMailSettings([], [], "typo"), /Choose preserve/);
  assert.deepEqual(deploymentMailSettings([], [], "disabled"), { environment: [{ name: "PIPELINE_MEET_CLIENT_LIVE_ENABLED", value: "false" }], secrets: [] });
});

test("large packet activation changes only the Graph write flag in existing mail configuration", () => {
  const environment = [
    { name: "PIPELINE_GRAPH_TENANT_ID", value: "mail-tenant" },
    { name: "PIPELINE_GRAPH_CLIENT_ID", value: "mail-app" },
    { name: "PIPELINE_GRAPH_CLIENT_SECRET", secretRef: "mail" },
    { name: "PIPELINE_MEET_CLIENT_SENDER", value: "admissions@example.test" },
    { name: "PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS", value: "example.test" },
    { name: "PIPELINE_MEET_CLIENT_LIVE_ENABLED", value: "true" },
    { name: "PIPELINE_GRAPH_MAIL_READ_WRITE", value: "false" },
  ];
  const secret = { name: "mail", keyVaultUrl: "https://example.vault.azure.net/secrets/mail", identity: "identity" };
  const configured = deploymentMailSettings(environment, [secret], "preserve", true);
  assert.deepEqual(configured.environment, [
    ...environment.slice(0, -1),
    { name: "PIPELINE_GRAPH_MAIL_READ_WRITE", value: "true" },
  ]);
  assert.deepEqual(configured.secrets, [secret]);
  assert.deepEqual(deploymentMailSettings(environment, [secret]), { environment, secrets: [secret] });
  assert.deepEqual(deploymentMailSettings([], [], "preserve", true), { environment: [], secrets: [] });
});

test("large packet activation adds the flag when existing Graph mail settings predate it", () => {
  const environment = [
    { name: "PIPELINE_GRAPH_CLIENT_ID", value: "mail-app" },
    { name: "PIPELINE_MEET_CLIENT_SENDER", value: "admissions@example.test" },
  ];
  assert.deepEqual(deploymentMailSettings(environment, [], "preserve", true).environment, [
    ...environment,
    { name: "PIPELINE_GRAPH_MAIL_READ_WRITE", value: "true" },
  ]);
});
