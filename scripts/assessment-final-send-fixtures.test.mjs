import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

test("post-send answer additions require one assessment field and a source", () => {
  const { validateAssessmentPatchRequest } = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-validation.ts");
  const request = (patch) => validateAssessmentPatchRequest({ if_match: 7, patch });
  assert.equal(request({ data: { current_symptoms: "Reported anxiety." },
    post_send_review: { field: "current_symptoms", source: "Assessor interview" } }).ok, true);
  assert.equal(request({ data: { referrer_name: "County case manager" },
    post_send_review: { field: "referrer_name", source: "Referral record" } }).ok, true);
  for (const patch of [
    { data: { current_symptoms: "Reported anxiety." }, post_send_review: { field: "current_symptoms", source: " " } },
    { data: { current_symptoms: "Reported anxiety.", cognition_orientation: "Oriented." }, post_send_review: { field: "current_symptoms", source: "Interview" } },
    { data: { assessor: "Different assessor" }, post_send_review: { field: "assessor", source: "Interview" } },
    { data: { current_symptoms: "Reported anxiety." }, status: "draft", post_send_review: { field: "current_symptoms", source: "Interview" } },
  ]) assert.equal(request(patch).ok, false);
});

for (const mode of ["local_file", "postgres"]) {
  test(`${mode}: sent assessments accept sourced additions while preserving the sent version`, {
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
      phase = "intentional second send records its latest version";
      const repeatVersion = current.version;
      await store.deliverAssessmentPacket(id, repeatVersion, async () => {
        providerCalls += 1;
        return { acceptedAt: "2026-09-17T21:00:00.000Z" };
      });
      current = await store.getAssessment(id);
      assert.equal(providerCalls, 2);
      assert.equal(current.meet_client_sent_version, repeatVersion);
      assert.equal(current.meet_client_sent_at, "2026-09-17T21:00:00.000Z");
      const noted = await store.addAssessmentAddendum(id, "Later clarification", "Correction", actor, current.version, "addendum-after-send");
      assert.equal(noted.ok, true);
      assert.equal(noted.assessment.current_symptoms, current.current_symptoms);
      assert.equal(noted.assessment.addenda[0].authored_by, actor.id);
      assert.equal(noted.assessment.audit_events.at(-1).action, "assessment_addendum_added");
      const replayed = await store.addAssessmentAddendum(id, "Later clarification", "Correction", actor, current.version, "addendum-after-send");
      assert.equal(replayed.ok, true);
      assert.equal(replayed.addendum.addendum_id, noted.addendum.addendum_id);
      assert.equal(replayed.assessment.addenda.length, 1);
      assert.equal(replayed.assessment.audit_events.filter((event) => event.action === "assessment_addendum_added").length, 1);
      assert.equal((await store.addAssessmentAddendum(id, "Stale", "test", actor, current.version)).conflict, true);
      phase = "add a sourced answer to the signed assessment without another send";
      const supplementPatch = {
        data: { cognition_orientation: "Alert and oriented to person and place." },
        post_send_review: { field: "cognition_orientation", source: "Assessor interview notes" },
      };
      const supplementOptions = { expectedVersion: noted.assessment.version, mutationId: "post-send-supplement" };
      if (sql) {
        phase = "roll back the assessment addition if its audit fails";
        await sql.unsafe(`create function pipeline.fail_supplement_audit() returns trigger language plpgsql as $$ begin
          if new.entity_type = 'assessment' and new.action = 'assessment_supplemented' then raise exception 'Synthetic supplement audit failure'; end if;
          return new; end $$;
          create trigger fail_supplement_audit before insert on pipeline.audit_events for each row execute function pipeline.fail_supplement_audit();`);
        await assert.rejects(store.patchAssessment(id, supplementPatch, actor,
          { expectedVersion: noted.assessment.version }), /Synthetic supplement audit failure/);
        await sql.unsafe("drop trigger fail_supplement_audit on pipeline.audit_events; drop function pipeline.fail_supplement_audit();");
        const rolledBack = await store.getAssessment(id);
        assert.equal(rolledBack.version, noted.assessment.version);
        assert.equal(rolledBack.cognition_orientation, null);
        assert.equal(rolledBack.addenda.length, noted.assessment.addenda.length);
      }
      phase = "add a sourced answer to the signed assessment without another send";
      const supplemented = await store.patchAssessment(id, supplementPatch, actor, supplementOptions);
      assert.equal(supplemented.ok, true);
      assert.equal(supplemented.assessment.cognition_orientation, "Alert and oriented to person and place.");
      assert.equal(supplemented.assessment.signed_at, signedAt);
      assert.equal(supplemented.assessment.meet_client_sent_at, "2026-09-17T21:00:00.000Z");
      assert.equal(supplemented.assessment.meet_client_sent_version, repeatVersion);
      assert(supplemented.assessment.audit_events.some((event) =>
        event.action === "assessment_supplemented" && event.changed_fields.includes("cognition_orientation")));
      assert.match(supplemented.assessment.addenda.at(-1).note, /Assessor interview notes/);
      assert.equal(providerCalls, 2);
      const supplementedReplay = await store.patchAssessment(id, supplementPatch, actor, supplementOptions);
      assert.equal(supplementedReplay.assessment.version, supplemented.assessment.version);
      assert.equal(supplementedReplay.assessment.addenda.length, supplemented.assessment.addenda.length);
      await assert.rejects(store.patchAssessment(id, { data: { primary_diagnosis: "Unsourced change" } }, actor,
        { expectedVersion: supplemented.assessment.version }), /Use Add note/);
      await assert.rejects(store.patchAssessment(id, {
        data: { cognition_orientation: "Replace a recorded answer" },
        post_send_review: { field: "cognition_orientation", source: "Fixture" },
      }, actor, { expectedVersion: supplemented.assessment.version }), /already recorded/);
      const unable = await store.patchAssessment(id, {
        data: { diabetic: "unable_to_assess", unable_to_assess_reasons: { diabetic: "Interview could not establish this." } },
        post_send_review: { field: "diabetic", source: "Assessor interview" },
      }, actor, { expectedVersion: supplemented.assessment.version });
      assert.equal(unable.ok, true);
      assert.equal(unable.assessment.diabetic, "unable_to_assess");
      assert.equal(unable.assessment.unable_to_assess_reasons.diabetic, "Interview could not establish this.");
      const referralSource = await store.patchAssessment(id, {
        data: { referrer_name: "County case manager" },
        post_send_review: { field: "referrer_name", source: "Referral record" },
      }, actor, { expectedVersion: unable.assessment.version });
      assert.equal(referralSource.ok, true);
      assert.equal(referralSource.assessment.referrer_name, "County case manager");
      assert.equal(referralSource.assessment.meet_client_sent_version, repeatVersion);
      current = referralSource.assessment;
      assert.equal(providerCalls, 2);
      await assert.rejects(store.importAssessmentExtraction({
        referralId: referral.id, assessmentId: id, expectedVersion: current.version, actor,
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
