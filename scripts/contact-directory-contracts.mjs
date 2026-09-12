#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const read = (file) => readFileSync(file, "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const migration = read("database/migrations/0034_contact_directory.sql");
const rollback = read("database/rollbacks/0034_contact_directory.sql");
const checksums = JSON.parse(read("database/migration-checksums.json"));
const store = read("lib/pipeline/contact-store.ts");
const validation = read("lib/pipeline/contact-validation.ts");
const contactsRoute = read("app/api/contacts/route.ts");
const contactRoute = read("app/api/contacts/[contactId]/route.ts");
const linksRoute = read("app/api/referrals/[referralId]/contacts/route.ts");
const linkRoute = read("app/api/referrals/[referralId]/contacts/[referralContactId]/route.ts");
const scheduleRoute = read("app/api/assessments/[assessmentId]/schedule/route.ts");
const card = read("components/pipeline/ReferralContactsCard.tsx");
const canvas = read("components/pipeline/ReferralPacketCanvas.tsx");
const calendar = read("lib/pipeline/calendar-store.ts");
const calendarPresentation = read("components/pipeline/PipelineCalendarPresentation.tsx");
const activity = read("lib/pipeline/referral-activity.ts");
const continuity = loadTypeScriptModule(process.cwd(), "lib/pipeline/work-continuity.ts");

check("migration creates a versioned reusable contact directory",
  migration.includes("create table if not exists pipeline.contacts")
  && migration.includes("version integer not null default 1")
  && migration.includes("search_text gin_trgm_ops"));
check("referral links are explicit and prevent duplicate role links",
  migration.includes("create table if not exists pipeline.referral_contacts")
  && migration.includes("unique (referral_id, contact_id, role)"));
check("the database permits only one primary scheduling contact per referral",
  migration.includes("referral_contacts_one_primary_schedule_idx")
  && migration.includes("where primary_for_scheduling"));
check("migration rollback is scoped and operator-transactional",
  rollback.includes("drop table if exists pipeline.referral_contacts")
  && rollback.includes("0034_contact_directory")
  && !/^\s*(begin|commit)\s*;/imu.test(rollback)
  && !rollback.includes("drop schema"));
check("migration bytes match the append-only checksum ledger",
  checksums.migrations["0034_contact_directory.sql"] === createHash("sha256").update(migration).digest("hex"));

check("contact mutations are serialized locally and recover in-memory state after persistence failure",
  store.includes("mutationQueue")
  && store.includes("structuredClone(localState.contacts)")
  && store.includes("localState.contacts = snapshot.contacts"));
check("PostgreSQL contact mutations use transactions, idempotency, versioning, and audit",
  store.includes("getPipelineSql().begin")
  && store.includes("lockPostgresMutation")
  && store.includes("current.version !== expectedVersion")
  && store.includes("writeContactAudit")
  && store.includes("contact_values_redacted"));
check("directory records never merge automatically by name",
  !store.includes("mergeContact")
  && !store.includes("upsertContact")
  && store.includes("unique (referral_id, contact_id, role)") === false);
check("contact validation bounds every free-text field and validates email",
  validation.includes("notes: 2_000")
  && validation.includes("email: 320")
  && validation.includes("email is invalid")
  && validation.includes("if_match must be a positive version number"));

for (const [name, route] of [
  ["directory", contactsRoute],
  ["contact", contactRoute],
  ["referral contacts", linksRoute],
  ["referral contact", linkRoute],
]) {
  check(`${name} routes require an authenticated user`, route.includes("requirePipelineUser"));
}
for (const [name, route] of [
  ["directory", contactsRoute],
  ["contact", contactRoute],
  ["referral contacts", linksRoute],
  ["referral contact", linkRoute],
]) {
  check(`${name} mutations enforce same-origin requests`, route.includes("requireSameOriginMutation"));
}
check("all contact reads and writes are scoped through a referral access check",
  contactsRoute.includes("requireReferralAccess")
  && contactsRoute.includes("requireMutableReferralAccess")
  && contactRoute.includes("requireMutableReferralAccess")
  && linksRoute.includes("requireReferralAccess")
  && linksRoute.includes("requireMutableReferralAccess")
  && linkRoute.includes("requireMutableReferralAccess"));

check("Intake presents client contact fields and the reusable contact directory",
  canvas.includes('title="Contact and coordination"')
  && canvas.includes('(["phone", "email"] as FieldKey[])')
  && canvas.includes("<ReferralContactsCard"));
check("contact UI exposes information without native communication actions",
  card.includes("Information only—no messages are sent.")
  && !/href\s*=\s*["'`]\s*(?:tel|mailto|sms):/iu.test(card)
  && !card.includes("window.open("));
check("contact UI supports search, reuse, edit, primary selection, and unlink",
  card.includes("Find saved contact")
  && card.includes("Add new contact")
  && card.includes("Set as scheduling contact")
  && card.includes("Save contact")
  && card.includes("Remove ${contactDisplayName"));

check("scheduling rejects incomplete Intake and unreachable contact state before mutation",
  scheduleRoute.indexOf("assessmentSchedulingReadinessFailure") < scheduleRoute.indexOf("saveAssessmentSchedule")
  && scheduleRoute.includes("schedulingBlockers")
  && scheduleRoute.includes("getContactSchedulingReadiness")
  && scheduleRoute.includes("assessment_not_ready_to_schedule")
  && scheduleRoute.includes('blockers.join(" ")'));
check("calendar projection labels contact blockers and routes them back to Intake",
  calendar.includes('"complete_contact"')
  && calendar.includes("primary_for_scheduling")
  && calendar.includes("r.data->>'phone'")
  && calendar.includes("r.data->>'email'")
  && !calendar.includes("r.phone")
  && !calendar.includes("r.email")
  && calendarPresentation.includes('return "Contact needed"')
  && calendarPresentation.includes('"Open intake"'));
check("contact changes join the existing referral activity timeline",
  activity.includes("listLocalContactAuditEvents")
  && store.includes('"referral_contact_attached"')
  && store.includes('"referral_contact_details_updated"'));

const start = continuity.emptyPipelineWorkContinuityState();
let current = start;
for (let index = 1; index <= 65; index += 1) {
  current = continuity.mergePipelineWorkContinuityState(current, {
    lastWorkspace: {
      referralId: index,
      location: { view: index % 2 ? "intake" : "assessment" },
      visitedAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
    },
  });
}
check("resume continuity retains a bounded per-referral working set",
  current.recentWorkspaces.length === 50
  && current.recentWorkspaces[0].referralId === 65
  && current.recentWorkspaces.at(-1).referralId === 16);
const refreshed = continuity.mergePipelineWorkContinuityState(current, {
  lastWorkspace: { referralId: 20, location: { view: "workflow" }, visitedAt: "2026-09-02T12:00:00.000Z" },
});
check("revisiting a referral replaces only its saved location",
  refreshed.recentWorkspaces.length === 50
  && refreshed.recentWorkspaces[0].referralId === 20
  && refreshed.recentWorkspaces[0].location.view === "workflow"
  && refreshed.recentWorkspaces.filter((item) => item.referralId === 20).length === 1);

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length) process.exit(1);
