import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";
const { scorecardNarrative, scorecardNarrativeText } = loadEntry("lib/pipeline/assessor-scorecard-narrative.ts");
const { scorecardSelection } = loadEntry("lib/pipeline/assessor-scorecard-presentation.ts");
const keys = ["clients", "fields", "confirmed", "interviews", "uploads", "handoffs", "resends", "sendIssues", "assigned", "overdue", "gaps"];
const event = (referralId, at, key = `${referralId}:${at}`) => ({ referralId, at, key });
const person = (id, evidence = {}, work = []) => ({ id, name: `Assessor ${id}`, active: true, usage: null, activeDays: work.length, recordedWork: work, evidence: Object.fromEntries(keys.map(key => [key, evidence[key] ?? []])) });
const snapshot = people => ({ people, since: "2026-09-18T07:00:00Z", through: "2026-11-14T20:00:00Z", usageSince: null });
const prose = review => [review.lead, ...review.paragraphs.map(scorecardNarrativeText), review.question].join(" ");

test("narratives distinguish usage, shared completion credit and current unfinished work", () => {
  const a = person("A", { clients: [event(1), event(2)], confirmed: [event(1, "2026-11-01T19:00:00Z")], assigned: [event(1)] }, [event(1, "2026-10-20T18:00:00Z"), event(2, "2026-11-01T19:00:00Z")]);
  const b = person("B", { clients: [event(1)], handoffs: [event(1, "2026-11-02T18:00:00Z"), event(2, "2026-11-03T18:00:00Z")] }, [event(1, "2026-11-02T18:00:00Z")]);
  const data = snapshot([a, b]);
  const report = scorecardNarrative(data, b);
  assert.match(report.lead, /Most recent handoffs/);
  assert.match(prose(report), /1 of these handoffs followed charts confirmed by Assessor A/);
  assert.match(prose(report), /2 of the team's 2 first handoffs/);
  assert.match(report.question, /Who covers handoffs/);
  assert.match(prose(report), /Click and active-time history are unavailable/);
  for (const assessor of data.people) for (const paragraph of scorecardNarrative(data, assessor).paragraphs) {
    for (const part of paragraph.filter(part => typeof part !== "string")) {
      assert.ok(part.text.startsWith(String(scorecardSelection(assessor, part.metric, part.bucket).value)), "every linked finding agrees with its evidence");
    }
  }
});

test("equal windows preserve Pacific boundaries, state declines and do not compare uncovered history", () => {
  const work = [event(1, "2026-10-18T17:00:00Z"), event(1, "2026-10-19T17:00:00Z"), event(1, "2026-11-02T07:59:00Z")];
  const a = person("A", { clients: [event(1)], assigned: [event(1)] }, work);
  const data = snapshot([a]);
  const report = scorecardNarrative(data, a);
  assert.match(prose(report), /Nov 1–Nov 14: 1 day with saved work/);
  assert.match(prose(report), /fell from 2 in Oct 18–Oct 31 to 1/);
  assert.match(report.question, /what is preventing/i);
  const shorter = scorecardNarrative({ ...data, since: "2026-11-09T08:00:00Z" }, a);
  assert.doesNotMatch(prose(shorter), /fell from|rose from/);
});

test("ties, empty periods, tracked zero and later or ambiguous confirmations do not invent findings", () => {
  const a = person("A"), b = person("B");
  assert.match(scorecardNarrative(snapshot([a, b]), a).lead, /No saved work/);
  const data = { ...snapshot([a, b]), usageSince: "2026-11-13T20:00:00Z" };
  a.usage = { interactions: 0, activeMinutes: 0, days: 0 };
  assert.match(prose(scorecardNarrative(data, a)), /0 clicks \/ taps/);
  a.evidence.handoffs = [event(1, "2026-11-01T18:00:00Z")];
  b.evidence.confirmed = [event(1, "2026-11-02T18:00:00Z")];
  assert.doesNotMatch(prose(scorecardNarrative(data, a)), /followed charts confirmed/);
  b.evidence.confirmed = [event(1, "2026-11-01T17:00:00Z")];
  a.evidence.confirmed = [event(1, "2026-11-01T17:00:00Z")];
  assert.doesNotMatch(prose(scorecardNarrative(data, a)), /followed charts confirmed/);
  a.activeDays = b.activeDays = 5;
  assert.doesNotMatch(scorecardNarrative(data, a).lead, /Most days|Most recorded/);
});
