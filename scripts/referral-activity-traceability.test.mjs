import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

// Modules run in a separate VM realm; compare plain copies.
const clean = (value) => JSON.parse(JSON.stringify(value));

// Synthetic records only, in a disposable directory or database.
for (const mode of ["local_file", "postgres"]) {
  test(`${mode}: activity rows stay traceable to their audit records and roles stay separate`, {
    skip: mode === "postgres" && !process.env.PIPELINE_TEST_DATABASE_URL,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "pipeline-activity-trace-"));
    const databaseName = `pipeline_activity_trace_${process.pid}`;
    let admin;
    let sql;
    try {
      if (mode === "postgres") {
        const url = new URL(process.env.PIPELINE_TEST_DATABASE_URL);
        url.pathname = "/postgres";
        admin = postgres(url.href, { ssl: false, max: 1, onnotice: () => {} });
        await admin.unsafe(`create database "${databaseName}"`);
        url.pathname = `/${databaseName}`;
        sql = postgres(url.href, { ssl: false, max: 5, onnotice: () => {} });
        const migrationSql = await sql.reserve();
        try {
          for (const file of (await readdir("database/migrations")).filter((file) => file.endsWith(".sql")).sort()) {
            await migrationSql.unsafe(await readFile(`database/migrations/${file}`, "utf8"));
          }
        } finally { migrationSql.release(); }
      }
      const globals = {
        ...(sql ? { __pipelineSql: sql } : {}),
        globalThis: { ...(sql ? { __pipelineSql: sql } : {}) },
        process: Object.assign(Object.create(process), { env: {
          ...process.env, NODE_ENV: "test", PIPELINE_DATABASE_MODE: mode === "postgres" ? mode : "disconnected",
          PIPELINE_DATABASE_URL: sql ? "postgres://fixture.invalid/disposable" : "",
          PIPELINE_REFERRAL_STORE_MODE: mode, PIPELINE_ASSESSMENT_STORE_MODE: mode,
          PIPELINE_REFERRAL_STORE_PATH: join(directory, "referrals.json"),
          PIPELINE_ASSESSMENT_STORE_PATH: join(directory, "assessments.json"),
          PIPELINE_DEMO_MODE: "false", PIPELINE_PERSONA_DEMO: "false", NEXT_PUBLIC_PIPELINE_PERSONA_DEMO: "false",
        } }),
      };
      const load = (file) => loadTypeScriptModule(process.cwd(), file, globals);
      const referrals = load("lib/pipeline/referral-store.ts");
      const assessments = load("lib/assessment/assessment-store.ts");
      const schema = load("lib/assessment/assessment-tool-schema.ts");
      const { getReferralActivitySnapshot } = load("lib/pipeline/referral-activity.ts");
      const { activityEventLabel } = load("lib/pipeline/referral-activity-presentation.ts");
      const { referralRoleFacts } = load("lib/pipeline/referral-owner-identity.ts");
      const { formatClientIdentityTitle } = load("lib/pipeline/client-identity-presentation.mjs");
      const starter = { id: "trace-starter", name: "Synthetic Starter" };

      // Two unassigned referrals created from the canvas default name.
      const created = [];
      for (const key of ["a", "b"]) {
        created.push((await referrals.createReferral({
          name: "Pending packet review", date: "2026-09-18", stage: "New", community: "Turlock",
          county: "Stanislaus County", source: "Referral packet", priority: "standard", tags: [],
          owner: "Unassigned", note: "", createdAt: "2026-09-18T00:00:00Z",
          dob: "", phone: "", email: "", payer: "",
        }, `trace-referral-${key}`, starter)).referral);
      }
      const [first, second] = created;
      assert.equal((await referrals.getReferral(first.id)).name, "Pending Review", "the stored source value is not rewritten");
      assert.notEqual(formatClientIdentityTitle(first), formatClientIdentityTitle(second));
      assert.equal(formatClientIdentityTitle(first), `Unnamed referral · #${first.id}`);

      // As the create route does: with no referral assignee the starting user
      // becomes the assessment's assessor, and the seed records that name.
      const assessment = (await assessments.createAssessment({
        referral_id: first.id, assigned_assessor: starter,
        data: { ...schema.createEmptyAssessmentToolData(), assessor: starter.name },
      }, starter, "trace-assessment")).assessment;

      const snapshot = await getReferralActivitySnapshot(first.id);
      const createdRows = snapshot.events.filter((event) => event.action === "assessment_created");
      assert.deepEqual(clean(createdRows.map((event) => event.entity_type)).sort(), ["assessment", "referral"]);
      assert.equal(new Set(createdRows.map((event) => event.event_id)).size, 2, "both audit rows remain, unmerged");
      const onAssessment = createdRows.find((event) => event.entity_type === "assessment");
      const onReferral = createdRows.find((event) => event.entity_type === "referral");
      assert.equal(onAssessment.entity_id, assessment.assessment_id);
      assert.equal(onReferral.entity_id, String(first.id));
      assert.deepEqual(clean(onReferral.changed_fields), ["workflowStatus"]);
      assert.notEqual(activityEventLabel(onAssessment), activityEventLabel(onReferral));

      // Every audit-sourced row resolves to a stored audit record with the same ID.
      const storedIds = new Set(sql
        ? (await sql`select audit_event_id::text as id from pipeline.audit_events`).map((row) => row.id)
        : [
          ...(await assessments.listAssessments({ referralId: first.id, limit: 100 })).assessments.flatMap((item) => item.audit_events.map((event) => event.event_id)),
          ...(await referrals.listLocalReferralAuditEvents(first.id)).map((event) => event.audit_event_id),
        ]);
      for (const event of snapshot.events.filter((item) => item.source === "audit")) {
        assert.ok(storedIds.has(event.event_id), `${event.action} ${event.event_id} is a stored audit row`);
      }

      const roles = referralRoleFacts({
        owner: snapshot.metadata.owner?.name, ownerId: snapshot.metadata.owner?.id, assessment: snapshot.metadata.assessment,
      });
      assert.deepEqual(clean(roles.map((role) => [role.label, role.value])), [
        ["Assigned assessor", "Unassigned"],
        ["Assessment assessor", "Synthetic Starter"],
      ]);
      assert.equal(snapshot.metadata.assessment.author.name, "Synthetic Starter");
    } finally {
      await sql?.end({ timeout: 5 });
      if (admin) {
        await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
        await admin.end({ timeout: 5 });
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}
