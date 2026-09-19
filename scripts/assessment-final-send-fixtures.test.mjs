import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

for (const mode of ["local_file", "postgres"]) {
  test(`${mode}: edits and imports stay audited until successful packet send; notes only afterward`, {
    skip: mode === "postgres" && !process.env.PIPELINE_TEST_DATABASE_URL,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "pipeline-final-send-"));
    const databaseName = `pipeline_final_send_${process.pid}`;
    let admin;
    let sql;
    let phase = "setup";
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
      const store = load("lib/assessment/assessment-store.ts");
      const schema = load("lib/assessment/assessment-tool-schema.ts");
      const { isAssessmentFinalized } = load("lib/assessment/assessment-records.ts");
      const actor = { id: "final-send-fixture", name: "Fixture Assessor" };
      const { referral } = await referrals.createReferral({
        name: "Finalsend Fixture", date: "9/17/2026", stage: "New", community: "Turlock",
        county: "Stanislaus County", source: "Fixture", priority: "standard", tags: [],
        owner: actor.name, ownerId: actor.id, note: "", createdAt: "2026-09-17T00:00:00Z",
        dob: "1/1/1980", phone: "", email: "", payer: "",
      }, "final-send-referral", actor);
      phase = "create assessment";
      let current = (await store.createAssessment({
        referral_id: referral.id, assigned_assessor: actor, data: schema.createEmptyAssessmentToolData(),
      }, actor, "final-send-assessment")).assessment;
      const id = current.assessment_id;
      phase = "correct assessment name across workspace records";
      const renameOptions = { expectedVersion: current.version, expectedReferralName: referral.name, mutationId: "name-correction" };
      const renamePatch = { data: { resident_name: "  corrected fixture  " } };
      const renamed = await store.patchAssessment(id, renamePatch, actor, renameOptions);
      assert.equal(renamed.ok, true);
      current = renamed.assessment;
      assert.equal(current.resident_name, "Corrected Fixture");
      assert.equal(renamed.referral.name, current.resident_name);
      assert.equal((await referrals.getReferral(referral.id)).name, current.resident_name);
      assert.equal((await store.patchAssessment(id, renamePatch, actor, renameOptions)).assessment.version, current.version);
      assert.equal((await referrals.getReferral(referral.id)).version, renamed.referral.version);
      const events = sql
        ? await sql`select changed_fields, before_values, after_values from pipeline.audit_events where entity_type = 'referral' and entity_id = ${String(referral.id)}`
        : await referrals.listLocalReferralAuditEvents(referral.id);
      const nameEvents = events.filter((event) => event.changed_fields.includes("name"));
      assert.equal(nameEvents.length, 1);
      assert.equal(nameEvents[0].before_values.name, referral.name);
      assert.equal(nameEvents[0].after_values.name, "Corrected Fixture");

      phase = "reject stale or empty name without losing unrelated fields";
      const changedElsewhere = await referrals.patchReferral(referral.id, { name: "Newer Fixture", phone: "555-0102" }, renamed.referral.version, actor);
      assert.equal(changedElsewhere.ok, true);
      const staleName = await store.patchAssessment(id, { data: { resident_name: "Stale Fixture" } }, actor,
        { expectedVersion: current.version, expectedReferralName: current.resident_name });
      assert.equal(staleName.ok, false);
      assert.equal(staleName.referralNameConflict, true);
      assert.equal((await store.getAssessment(id)).version, current.version);
      assert.equal((await referrals.getReferral(referral.id)).name, "Newer Fixture");
      await assert.rejects(store.patchAssessment(id, { data: { resident_name: " " } }, actor,
        { expectedVersion: current.version }), /Enter a client name/);
      // Sending an unchanged snapshot with other identity answers is not a rename.
      current = (await store.patchAssessment(id, { data: { resident_name: current.resident_name, current_location: "Synthetic location" } }, actor,
        { expectedVersion: current.version })).assessment;
      assert.equal((await referrals.getReferral(referral.id)).name, "Newer Fixture");
      current = (await store.patchAssessment(id, { data: { resident_name: "Confirmed Fixture" } }, actor,
        { expectedVersion: current.version, expectedReferralName: "Newer Fixture" })).assessment;
      assert.equal((await referrals.getReferral(referral.id)).name, "Confirmed Fixture");
      assert.equal((await referrals.getReferral(referral.id)).phone, "555-0102");

      if (sql) {
        phase = "roll back both names when assessment audit fails";
        await sql.unsafe(`create function pipeline.fail_name_audit() returns trigger language plpgsql as $$ begin
          if new.entity_type = 'assessment' and new.action = 'assessment_updated' then raise exception 'Synthetic audit failure'; end if;
          return new; end $$;
          create trigger fail_name_audit before insert on pipeline.audit_events for each row execute function pipeline.fail_name_audit();`);
        await assert.rejects(store.patchAssessment(id, { data: { resident_name: "Rollback Fixture" } }, actor,
          { expectedVersion: current.version, expectedReferralName: current.resident_name }), /Synthetic audit failure/);
        await sql.unsafe("drop trigger fail_name_audit on pipeline.audit_events; drop function pipeline.fail_name_audit();");
        assert.equal((await referrals.getReferral(referral.id)).name, "Confirmed Fixture");
        assert.equal((await store.getAssessment(id)).version, current.version);
        assert.equal(Number((await sql`select count(*) from pipeline.people where display_name = 'Rollback Fixture'`)[0].count), 0);
      }
      assert.equal((await store.addAssessmentAddendum(id, "Too early", "test", actor, current.version)).ok, false);
      phase = "sign";
      current = (await store.patchAssessment(id, { signer: actor }, actor, { expectedVersion: current.version })).assessment;
      const signedAt = current.signed_at;
      assert(signedAt);
      assert.equal(isAssessmentFinalized(current), false);
      phase = "edit signed answers";
      current = (await store.patchAssessment(id, { data: { current_symptoms: "Edited after signing" } }, actor,
        { expectedVersion: current.version })).assessment;
      assert.equal(current.current_symptoms, "Edited after signing");
      assert.equal(current.signed_at, signedAt);
      assert.equal(current.audit_events.at(-1).action, "assessment_updated");
      assert(current.audit_events.at(-1).changed_fields.includes("current_symptoms"));
      assert.equal(current.audit_events.at(-1).actor_id, actor.id);
      phase = "import signed answers";
      const imported = await store.importAssessmentExtraction({
        referralId: referral.id, assessmentId: id, expectedVersion: current.version, actor,
        fields: [{ field_key: "assessment.primary_diagnosis", proposed_value: "Synthetic later record", confidence: 1, review_status: "pending", source_page_no: 1, evidence_url: "synthetic/page-1" }],
        context: { source_file: "synthetic.pdf", extraction_date: "2026-09-17", match_confidence: 1 }, defaults: {},
      });
      assert.equal(imported.ok, true);
      current = imported.assessment;
      assert.equal(current.signed_at, signedAt);
      assert.equal(current.status, "complete");
      assert.equal(current.audit_events.at(-1).action, "assessment_imported");
      assert.equal((await store.addAssessmentAddendum(id, "Still too early", "test", actor, current.version)).ok, false);
      await assert.rejects(store.deliverAssessmentPacket(id, current.version, async () => { throw new Error("Provider failed"); }), /Provider failed/);
      assert.equal(isAssessmentFinalized(await store.getAssessment(id)), false);
      current = (await store.patchAssessment(id, { data: { current_symptoms: "Edited after failed send" } }, actor,
        { expectedVersion: current.version })).assessment;
      let providerCalls = 0;
      await assert.rejects(store.deliverAssessmentPacket(id, current.version - 1, async () => { providerCalls += 1; }), /assessment changed/);
      assert.equal(providerCalls, 0);
      const versionSent = current.version;
      let acknowledge;
      let entered;
      const providerEntered = new Promise((resolve) => { entered = resolve; });
      const acceptance = new Promise((resolve) => { acknowledge = resolve; });
      const delivery = store.deliverAssessmentPacket(id, versionSent, async () => {
        providerCalls += 1;
        entered();
        await acceptance;
        return { acceptedAt: "2026-09-17T20:00:00.000Z" };
      });
      await providerEntered;
      const concurrentSave = assert.rejects(store.patchAssessment(id, { data: { current_symptoms: "Must not replace sent answers" } }, actor,
        { section: "diagnosis_clinical", expectedSectionVersion: current.section_versions.diagnosis_clinical }), /Use Add note/);
      acknowledge();
      await Promise.all([delivery, concurrentSave]);
      current = await store.getAssessment(id);
      assert.equal(isAssessmentFinalized(current), true);
      assert.equal(current.meet_client_sent_version, versionSent);
      assert.equal(current.current_symptoms, "Edited after failed send");
      assert.equal(providerCalls, 1);
      const noted = await store.addAssessmentAddendum(id, "Later clarification", "Correction", actor, current.version);
      assert.equal(noted.ok, true);
      assert.equal(noted.assessment.current_symptoms, current.current_symptoms);
      assert.equal(noted.assessment.addenda[0].authored_by, actor.id);
      assert.equal(noted.assessment.audit_events.at(-1).action, "assessment_addendum_added");
      assert.equal((await store.addAssessmentAddendum(id, "Stale", "test", actor, current.version)).conflict, true);
      await assert.rejects(store.importAssessmentExtraction({
        referralId: referral.id, assessmentId: id, expectedVersion: noted.assessment.version, actor,
        fields: [], context: {}, defaults: {},
      }), /Use Add note/);
      phase = "new revision after send";
      const revision = await store.createAssessmentRevision(id, actor, "revision-after-send");
      assert.equal(isAssessmentFinalized(revision.assessment), false);
      assert.equal(revision.assessment.meet_client_sent_at, null);
      assert.equal(isAssessmentFinalized(await load("lib/assessment/assessment-store.ts").getAssessment(id)), true);
      if (sql) {
        phase = "historical successful sends stay finalized after migration";
        await sql`insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, metadata)
          values ('referral', ${String(referral.id)}, 'meet_client_summary_sent', ${actor.id}, ${actor.name},
            ${sql.json({ assessment_id: id, assessment_version: versionSent })})`;
        await sql`update pipeline.assessments set meet_client_sent_at = null, meet_client_sent_version = null where assessment_id = ${id}`;
        const migrationSql = await sql.reserve();
        try {
          await migrationSql.unsafe(await readFile("database/migrations/0038_assessment_packet_finalization.sql", "utf8"));
        } finally { migrationSql.release(); }
        const backfilled = await store.getAssessment(id);
        assert.equal(isAssessmentFinalized(backfilled), true);
        assert.equal(backfilled.meet_client_sent_version, versionSent);
        assert.equal((await store.getAssessment(revision.assessment.assessment_id)).meet_client_sent_at, null);
      }
    } catch (error) {
      throw new Error(`${phase}: ${error.message}`, { cause: error });
    } finally {
      if (sql) await sql.end();
      if (admin) {
        await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
        await admin.end();
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}
