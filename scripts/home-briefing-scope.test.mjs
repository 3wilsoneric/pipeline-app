import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const ownership = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-ownership.ts");
const appointments = loadTypeScriptModule(process.cwd(), "lib/pipeline/assessment-calendar.ts");

test("calendar dates retain Pacific midnight and daylight-saving boundaries across repeated reads", () => {
  const cases = [
    ["2026-03-08T07:59:59Z", "2026-03-07"],
    ["2026-03-08T08:00:00Z", "2026-03-08"],
    ["2026-03-08T10:00:00Z", "2026-03-08"],
    ["2026-11-01T06:59:59Z", "2026-10-31"],
    ["2026-11-01T07:00:00Z", "2026-11-01"],
    ["2026-11-01T09:00:00Z", "2026-11-01"],
  ];
  let now = cases[0][0];
  const calendar = loadTypeScriptModule(process.cwd(), "lib/pipeline/assessment-calendar.ts", {
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
    },
  });
  for (const [timestamp, expected] of cases) {
    now = timestamp;
    assert.equal(calendar.calendarDate(timestamp), expected);
    assert.equal(calendar.calendarToday(), expected);
  }
  assert.equal(calendar.calendarDate("2026-11-01"), "2026-11-01");
  assert.equal(calendar.calendarDate("11/1/2026"), "2026-11-01");
  assert.equal(calendar.calendarDate("2026-02-30"), null);
  assert.equal(calendar.calendarDate("invalid"), null);
});

const js = ts.transpileModule(readFileSync("lib/pipeline/home-briefing.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function briefingWith(events, calendarFails = false) {
  const exports = {};
  const dependencies = {
    "server-only": {},
    "@/lib/pipeline/referral-ownership": ownership,
    "@/lib/pipeline/assessment-calendar": appointments,
    "@/lib/pipeline/calendar-store": { getAssessmentCalendar: async () => {
      if (calendarFails) throw new Error("Synthetic calendar unavailable");
      return { events, unscheduled: [], unscheduledTotal: 0 };
    } },
    "@/lib/pipeline/operations-snapshot": { getHomeWorkflowSummary: async () => ({ current_work: { total: 0, items: [] } }) },
    "@/lib/pipeline/home-continuity": { getHomeContinuity: async () => ({ new_assignments: [], resume_items: [] }) },
  };
  new Function("require", "exports", js)(id => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, exports);
  return exports.getHomeBriefing;
}
const event = (id, ownerId, owner, minutes = 60) => ({
  id, ownerId, owner, kind: "assessment", status: "draft", scheduleStatus: "scheduled",
  startsAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  date: new Date().toISOString().slice(0, 10),
});

for (const roles of [["reviewer"], ["admin", "assessment_coordinator"]]) {
  test(`Home appointments use assigned identity for ${roles.join("/")}, before the eight-item limit`, async () => {
    const user = { id: "assessor-a", name: "Alex Example", email: "alex@example.test", roles };
    const events = [
      ...Array.from({ length: 9 }, (_, i) => event(`other-${i}`, "assessor-b", user.name, 10 + i)),
      event("legacy-name", undefined, " Alex Example ", 30),
      event("legacy-email", undefined, user.email, 31),
      event("unassigned", undefined, "Unassigned", 20),
      event("cancelled", user.id, user.name, 25),
      event("completed", user.id, user.name, 26),
      ...Array.from({ length: 9 }, (_, i) => event(`mine-${i}`, "ASSESSOR-A", "Older display name", 60 + i)),
    ];
    events.find(item => item.id === "cancelled").scheduleStatus = "cancelled";
    events.find(item => item.id === "completed").status = "complete";
    const result = await briefingWith(events)(user);
    assert.deepEqual(result.upcoming.map(item => item.id), ["legacy-name", "legacy-email", ...Array.from({ length: 6 }, (_, i) => `mine-${i}`)]);
    const other = await briefingWith(events)({ id: "assessor-b", name: "Other Assessor", roles: ["reviewer"] });
    assert.deepEqual(other.upcoming.map(item => item.id), Array.from({ length: 8 }, (_, i) => `other-${i}`));
    assert.equal(result.scope, "personal");
    assert.equal(result.viewer.id, user.id);
  });
}
test("an unavailable personal schedule is reported unavailable, not a successful empty schedule", async () => {
  const result = await briefingWith([], true)({ id: "assessor-a", name: "Alex Example", roles: ["reviewer"] });
  assert.deepEqual(result.upcoming, []);
  assert.ok(result.unavailable_sections.includes("upcoming"));
});
