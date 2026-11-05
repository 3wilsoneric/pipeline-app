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

test("layout preferences accept formats and order only, never client wording", () => {
  const message = { subject: "Private subject", body: null, sectionText: { bio: "Client A" }, sectionFormats: { bio: "bullets" }, sectionOrder: [...model.meetClientSectionIds].reverse() };
  const layout = clean(model.meetClientLayout(message));
  assert.deepEqual(Object.keys(layout), ["sectionOrder", "sectionFormats"]);
  assert.deepEqual(clean(model.parseMeetClientLayout(layout)), layout);
  for (const extra of [{ sectionText: { bio: "Client A" } }, { subject: "Client A" }, { body: "Client A" }, { sectionFormats: { bio: "<b>" } }, { sectionFormats: { unknown: "bullets" } }]) {
    assert.equal(model.parseMeetClientLayout({ ...layout, ...extra }), null);
  }
  for (const sectionText of [{ bio: null }, { bio: 123 }, { bio: "bad\u0000" }, { bio: "x".repeat(10_001), safety: "x".repeat(10_000) }, { unknown: "text" }]) {
    assert.equal(model.parseMeetClientMessage({ subject: null, body: null, sectionText }), null);
  }
});

test("section edits render identically in the preview and email while a reused layout pulls the next client", () => {
  const message = { subject: null, body: null, sectionText: { bio: "Client A <script>\nSecond paragraph", medications: "Call the referring team", message: "Please call before arrival." }, sectionFormats: { bio: "bullets", safety: "paragraphs" }, sectionOrder: [...model.meetClientSectionIds].reverse() };
  assert.ok(model.parseMeetClientMessage(message));
  const rendered = template.renderMeetClientEmail(summary, "Assessor", "preview", ["Original.docx"], message);
  assert.match(rendered.html, /<li[^>]*>Client A &lt;script&gt;<\/li>/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /Hello team/);
  assert.match(rendered.html, /Sender-edited/);
  assert.match(rendered.text, /Second paragraph/);
  assert.match(rendered.text, /Please call before arrival/);
  assert.match(rendered.text, /Refer to the medication list/);
  assert.match(rendered.html, /Original.docx/);
  const next = template.renderMeetClientEmail({ ...summary, bio: ["Client B"] }, "Assessor", "preview", [], { subject: null, body: null, ...model.meetClientLayout(message) });
  assert.match(next.html, /<li[^>]*>Client B<\/li>/);
  assert.doesNotMatch(next.html, /Client A|Please call before arrival/);
  assert.deepEqual(summary.bio, ["Synthetic background"]);
});

test("PostgreSQL key ordering does not change message equality or lost-response recovery", () => {
  const original = { subject: null, body: null, sectionOrder: [...model.meetClientSectionIds], sectionText: { support: "Help", bio: "Client" }, sectionFormats: { support: "bullets", bio: "paragraphs" } };
  const reordered = { sectionFormats: { bio: "paragraphs", support: "bullets" }, sectionText: { bio: "Client", support: "Help" }, sectionOrder: original.sectionOrder, body: null, subject: null };
  assert.equal(JSON.stringify(model.parseMeetClientMessage(original)), JSON.stringify(model.parseMeetClientMessage(reordered)));
  assert.equal(JSON.stringify(model.meetClientLayout(original)), JSON.stringify(model.meetClientLayout(reordered)));
  assert.equal(model.parseMeetClientMessage({ subject: null, body: "Legacy message", sectionText: { message: "Conflicting message" } }), null);
});
