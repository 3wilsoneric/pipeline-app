import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import postgres from "postgres";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceId = "provisional:fixture:assessor";
const targetId = "10000000-0000-4000-8000-000000000001";

// Never uses a configured database URL: proof runs in its own loopback cluster.
test("workspace member linking preserves clinical history, roles and truthful sign-in state", { skip: process.env.PIPELINE_MEMBER_LINK_POSTGRES !== "true" }, async (t) => {
  const directory = mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "pipeline-member-link-pg-"));
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  mkdirSync(socket);
  const binary = (name) => process.env.PIPELINE_MEMBER_LINK_PG_BIN ? join(process.env.PIPELINE_MEMBER_LINK_PG_BIN, name) : name;
  let started = false;
  let sql;
  try {
    execFileSync(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    const port = await availablePort();
    execFileSync(binary("pg_ctl"), ["-D", data, "-l", join(directory, "postgres.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
    started = true;
    const url = `postgres://${encodeURIComponent(process.env.USER)}@127.0.0.1:${port}/postgres`;
    const env = { ...process.env, PIPELINE_DATABASE_URL: url, PIPELINE_DATABASE_SSL_MODE: "disable" };
    execFileSync(process.execPath, ["scripts/apply-database-migrations.mjs"], { cwd: root, env, stdio: "pipe" });
    sql = postgres(url, { ssl: false, max: 1, prepare: false, onnotice: () => undefined });
    const link = (source = sourceId, target = targetId, apply = true) => spawnSync(process.execPath, [
      "scripts/link-provisional-workspace-member.mjs", `--provisional-id=${source}`,
      `--entra-principal-id=${target}`, "--display-name=Verified Fixture Name", "--email=fixture@example.invalid",
      ...(apply ? ["--apply"] : []),
    ], { cwd: root, env, encoding: "utf8" });
    const snapshot = async () => {
      const state = {};
      for (const [table, key] of [["workspace_members", "principal_id"], ["referrals", "referral_id"], ["work_items", "work_item_id"], ["assessments", "assessment_id"], ["audit_events", "audit_event_id"], ["store_revisions", "store_name"], ["user_workspace_state", "principal_id, state_kind, state_key"]]) {
        state[table] = Array.from(await sql.unsafe(`select to_jsonb(r) as record from pipeline.${table} r order by ${key}`));
      }
      return state;
    };
    await sql`insert into pipeline.workspace_members (principal_id, display_name, email, roles, last_seen_at, identity_status, source_system, source_identity)
      values (${sourceId}, 'Original Fixture Name', null, array['reviewer','viewer'], null, 'provisional', 'fixture', 'assessor')`;
    const [person] = await sql`insert into pipeline.people (display_name) values ('Synthetic fixture only') returning person_id`;
    const referralIds = {};
    for (const kind of ["active", "historical", "deleted", "closed", "other"]) {
      const [referral] = await sql`insert into pipeline.referrals (person_id, stage, community, owner_id, owner_name, data,
        workspace_status, deleted_at, delete_after, deleted_by, deleted_by_name, closed_at, created_by, created_by_name, updated_by, updated_by_name)
        values (${person.person_id}, 'Assessment', 'Fixture', ${kind === 'other' ? 'other:fixture' : sourceId}, 'Original Fixture Name',
          ${sql.json({ ownerId: kind === 'other' ? 'other:fixture' : sourceId, owners: [{ id: kind === 'other' ? 'other:fixture' : sourceId, name: 'Original Fixture Name' }], untouched: 'original' })},
          ${kind === 'historical' ? 'historical' : 'active'}, ${kind === 'deleted' ? new Date('2026-01-01') : null},
          ${kind === 'deleted' ? new Date('2026-02-01') : null},
          ${kind === 'deleted' ? 'fixture' : null}, ${kind === 'deleted' ? 'Fixture' : null},
          ${kind === 'closed' ? new Date('2026-01-01') : null}, 'fixture', 'Fixture', 'fixture', 'Fixture') returning referral_id`;
      referralIds[kind] = referral.referral_id;
      await sql`insert into pipeline.work_items (referral_id, person_id, type, label, gate, status, owner_id, owner_name, next_action)
        values (${referral.referral_id}, ${person.person_id}, 'fixture', 'Fixture requirement', 'pre_assessment', 'needed',
          ${kind === 'other' ? 'other:fixture' : sourceId}, 'Original Fixture Name', 'Fixture')`;
    }
    await sql`insert into pipeline.user_workspace_state (principal_id, state_kind, state_key, payload, version, expires_at)
      values (${sourceId}, 'workflow_continuity', 'resume', '{"position":"original"}', 4, now() + interval '1 day'),
        (${sourceId}, 'recent_destination', 'expired', '{"position":"expired"}', 1, now() - interval '1 day')`;
    for (const [id, kind, status, signed] of [
      ['open-draft', 'active', 'draft', false], ['open-review', 'active', 'needs_review', false],
      ['complete', 'active', 'complete', false], ['signed-complete', 'active', 'complete', true],
      ['signed-review', 'active', 'needs_review', true], ['historical', 'historical', 'draft', false],
      ['deleted', 'deleted', 'draft', false], ['closed', 'closed', 'draft', false], ['other', 'other', 'draft', false],
    ]) {
      await sql`insert into pipeline.assessments (assessment_id, referral_id, revision_root_id, assessor_id, assessor_name,
        status, data, signed_at, signed_by, signed_by_name, created_by, created_by_name, updated_by, updated_by_name)
        values (${id}, ${referralIds[kind]}, ${id}, ${kind === 'other' ? 'other:fixture' : sourceId}, 'Original Fixture Name',
          ${status}, ${sql.json({ assessor: 'Original Fixture Name', diagnosis: 'Unchanged synthetic fixture', signature: signed })},
          ${signed ? new Date('2026-01-01') : null}, ${signed ? sourceId : null}, ${signed ? 'Original Fixture Name' : null},
          'fixture', 'Fixture', 'fixture', 'Fixture')`;
    }

    await t.test("invalid immutable ID and plan mode make no writes", async () => {
      const before = await snapshot();
      assert.notEqual(link(sourceId, "guessed-email@example.invalid").status, 0);
      assert.equal(link(sourceId, targetId, false).status, 0);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("late audit failure rolls back identity, assignments, versions and revisions", async () => {
      await sql.unsafe(`create function pipeline.reject_member_link() returns trigger language plpgsql as $$ begin
        if NEW.entity_type = 'workspace_member' then raise exception 'synthetic failure'; end if; return NEW; end $$;
        create trigger reject_member_link before insert on pipeline.audit_events for each row execute function pipeline.reject_member_link();`);
      const before = await snapshot();
      assert.notEqual(link().status, 0);
      assert.deepEqual(await snapshot(), before);
      await sql`drop trigger reject_member_link on pipeline.audit_events`;
    });
    await t.test("only mutable active assessments change identity; historical content is byte-identical", async () => {
      const before = await snapshot();
      const result = link();
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.reassigned_referrals, 4);
      assert.equal(report.reassigned_work_items, 4);
      assert.equal(report.reassigned_assessments, 2);
      assert.equal(report.copied_saved_state, 1);
      const after = await snapshot();
      for (const row of before.assessments) {
        const original = row.record;
        const current = after.assessments.find((r) => r.record.assessment_id === original.assessment_id).record;
        if (!['open-draft', 'open-review'].includes(original.assessment_id)) {
          assert.deepEqual(current, original);
        } else {
          assert.equal(current.assessor_id, targetId);
          assert.equal(current.version, original.version + 1);
          assert.deepEqual(current.section_versions, { ...original.section_versions, identity: original.section_versions.identity + 1 });
          for (const key of Object.keys(original).filter((key) => !['assessor_id','version','section_versions','updated_at'].includes(key))) {
            assert.deepEqual(current[key], original[key], key);
          }
        }
      }
      for (const table of ['referrals', 'work_items']) {
        const key = table === 'referrals' ? 'referral_id' : 'work_item_id';
        for (const row of before[table]) {
          const original = row.record;
          const current = after[table].find((r) => r.record[key] === original[key]).record;
          if (original.owner_id !== sourceId) assert.deepEqual(current, original);
          else {
            assert.equal(current.owner_id, targetId);
            assert.equal(current.version, original.version + 1);
            if (table === 'referrals') assert.equal(current.assignment_version, original.assignment_version + 1);
            if (table === 'referrals') {
              assert.deepEqual(current.section_versions, { ...original.section_versions, intake: original.section_versions.intake + 1 });
              assert.deepEqual(current.data, { ...original.data, ownerId: targetId, owners: original.data.owners.map((owner) => ({ ...owner, id: targetId })) });
            }
            for (const field of Object.keys(original).filter((field) => !['owner_id','version','assignment_version','updated_at', ...(table === 'referrals' ? ['section_versions','data'] : [])].includes(field))) assert.deepEqual(current[field], original[field], field);
          }
        }
      }
      const [target] = await sql`select * from pipeline.workspace_members where principal_id = ${targetId}`;
      assert.equal(target.last_seen_at, null);
      assert.deepEqual(target.roles, ['reviewer','viewer']);
      const [source] = await sql`select * from pipeline.workspace_members where principal_id = ${sourceId}`;
      assert.equal(source.active, false);
      assert.equal(source.merged_into_principal_id, targetId);
      const sourceState = after.user_workspace_state.filter((r) => r.record.principal_id === sourceId);
      assert.deepEqual(sourceState, before.user_workspace_state);
      const copied = after.user_workspace_state.filter((r) => r.record.principal_id === targetId);
      assert.equal(copied.length, 1);
      assert.deepEqual(copied[0].record, { ...sourceState.find((r) => r.record.state_key === 'resume').record, principal_id: targetId });
      assert.equal(after.audit_events.length - before.audit_events.length, 11);
      for (const { record } of before.store_revisions) {
        const current = after.store_revisions.find((r) => r.record.store_name === record.store_name).record;
        assert.equal(Number(current.revision), Number(record.revision) + (['referrals','workflow','client_workspaces','assessments'].includes(record.store_name) ? 1 : 0));
      }
    });
    await t.test("exact replay is audit-neutral and conflicting merge rolls back", async () => {
      const before = await snapshot();
      const result = link();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).idempotent_replay, true);
      assert.notEqual(link(sourceId, "10000000-0000-4000-8000-000000000002").status, 0);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("existing coordinator roles and real last_seen are retained; inactive target fails closed", async () => {
      const coordinator = "10000000-0000-4000-8000-000000000003";
      const otherSource = "provisional:fixture:coordinator";
      await sql`insert into pipeline.workspace_members (principal_id, display_name, email, roles, last_seen_at, identity_status, source_system, source_identity)
        values (${otherSource}, 'Fixture', null, array['reviewer','viewer'], null, 'provisional', 'fixture', 'coordinator')`;
      await sql`insert into pipeline.workspace_members (principal_id, display_name, email, roles, active, last_seen_at)
        values (${coordinator}, 'Fixture', 'coordinator@example.invalid', array['assessment_coordinator','note_lab_reviewer','reviewer'], false, '2026-01-01')`;
      const before = await snapshot();
      assert.notEqual(link(otherSource, coordinator).status, 0);
      assert.deepEqual(await snapshot(), before);
      await sql`update pipeline.workspace_members set active = true where principal_id = ${coordinator}`;
      await sql`insert into pipeline.user_workspace_state (principal_id, state_kind, state_key, payload, expires_at)
        values (${otherSource}, 'referral_draft', 'existing', '{"source":"do not replace target"}', now() + interval '1 day'),
          (${coordinator}, 'referral_draft', 'existing', '{"target":"keep real draft"}', now() + interval '1 day'),
          (${otherSource}, 'recent_destination', 'copy', '{"source":"copy this"}', now() + interval '1 day')`;
      const stateBefore = (await snapshot()).user_workspace_state;
      const [targetBefore] = await sql`select roles, last_seen_at from pipeline.workspace_members where principal_id = ${coordinator}`;
      const result = link(otherSource, coordinator);
      assert.equal(result.status, 0, result.stderr);
      const [targetAfter] = await sql`select roles, last_seen_at from pipeline.workspace_members where principal_id = ${coordinator}`;
      assert.deepEqual(targetAfter, targetBefore);
      const stateAfter = (await snapshot()).user_workspace_state;
      for (const row of stateBefore) assert.deepEqual(stateAfter.find((r) => r.record.principal_id === row.record.principal_id && r.record.state_kind === row.record.state_kind && r.record.state_key === row.record.state_key), row);
      assert.equal(JSON.parse(result.stdout).copied_saved_state, 1);
    });
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true });
  }
});

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
