import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
const root = resolve(import.meta.dirname, "..");
const model = loadTypeScriptModule(root, "lib/notifications/meet-client-message.ts");
const template = loadTypeScriptModule(root, "lib/notifications/meet-client-email-template.ts");
const summary = {
  name: "Synthetic <Client>", dateOfBirth: "1980-06-12", community: "San Pablo", admissionDate: "2026-10-30", assessmentDate: "2026-10-29",
  bio: ["Synthetic background"], admissionNotes: [{ label: "Contact", value: "Synthetic coordination" }],
  medicationNotes: [{ label: "Support", value: "Synthetic medication support" }], safetyNotes: [{ label: "Plan", value: "Synthetic safety" }],
  dietaryNotes: [{ label: "Diet", value: "Synthetic diet" }], billingNotes: [{ label: "Coverage", value: "Synthetic coverage" }], supportSnapshot: [{ label: "Daily support", value: "Synthetic daily support" }],
};
const clean = value => JSON.parse(JSON.stringify(value));
test("older drafts remain valid; ordering must contain every known section exactly once", () => {
  assert.deepEqual(clean(model.parseMeetClientMessage({ subject: null, body: null })), { subject: null, body: null });
  const order = [...model.meetClientSectionIds].reverse();
  assert.deepEqual(clean(model.parseMeetClientMessage({ subject: null, body: null, sectionOrder: order })).sectionOrder, order);
  for (const invalid of [null, [], order.slice(1), [...order, "support"], order.map(() => "support"), [...order.slice(1), "unknown"], "support"])
    assert.equal(model.parseMeetClientMessage({ subject: null, body: null, sectionOrder: invalid }), null);
});
test("working document, HTML, and plain text share order and retain every clinical section", () => {
  const message = { subject: null, body: null, sectionOrder: [...model.meetClientSectionIds].reverse() };
  const sections = template.meetClientSections(summary, message);
  const rendered = template.renderMeetClientEmail(summary, "Synthetic assessor", "test", ["signed-med-list.pdf"], message);
  assert.equal(sections.length, 7);
  assert.deepEqual(Array.from(sections, s => s.id), ["support", "billing", "diet", "safety", "medications", "coordination", "bio"]);
  let htmlPosition = -1, textPosition = -1;
  for (const section of sections) {
    const position = rendered.html.indexOf(`>${template.escapeHtml(section.title)}</h2>`);
    assert.ok(position > htmlPosition, section.title); htmlPosition = position;
    const plain = rendered.text.indexOf(section.title); assert.ok(plain > textPosition, section.title); textPosition = plain;
  }
  for (const value of ["Synthetic background", "Synthetic coordination", "Synthetic medication support", "Synthetic safety", "Synthetic diet", "Synthetic coverage", "Synthetic daily support"])
    for (const format of [rendered.html, rendered.text]) assert.equal(format.split(value).length - 1, 1, value);
  assert.ok(rendered.html.includes("signed-med-list.pdf"));
  assert.ok(rendered.html.includes("Synthetic &lt;Client&gt;"));
  assert.ok(rendered.html.indexOf("Synthetic &lt;Client&gt;") < htmlPosition);
});
test("custom messages survive as one intact block, with medication reference and packet safeguards", () => {
  const body = "Personally edited message\n<script>alert('x')</script>";
  const message = { subject: "Custom subject", body, sectionOrder: [...model.meetClientSectionIds].reverse() };
  const rendered = template.renderMeetClientEmail(summary, "Synthetic assessor", "test", ["signed-med-list.pdf"], message, { packetLinkPreview: true });
  assert.equal(rendered.subject, "Custom subject");
  assert.ok(rendered.text.includes(body));
  assert.ok(!rendered.html.includes("<script>"));
  assert.ok(rendered.html.includes("&lt;script&gt;"));
  assert.ok(rendered.html.includes("Open admission packet"));
  assert.ok(rendered.text.includes("Medications"));
  assert.ok(!rendered.text.includes("Synthetic background"), "An old custom message is not silently replaced by regenerated text");
  assert.deepEqual(Array.from(template.meetClientSections(summary, message), s => s.id), ["medications", "message"]);
});
