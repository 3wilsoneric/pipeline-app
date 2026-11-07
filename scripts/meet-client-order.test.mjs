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
  const message = { subject: "Private subject", body: null, sectionEdits: { bio: { text: "Client A", source: "Synthetic background" } }, sectionFormats: { bio: "bullets" }, sectionOrder: [...model.meetClientSectionIds].reverse() };
  const layout = clean(model.meetClientLayout(message));
  assert.deepEqual(Object.keys(layout), ["sectionOrder", "sectionFormats"]);
  assert.deepEqual(clean(model.parseMeetClientLayout(layout)), layout);
  for (const extra of [{ sectionEdits: { bio: { text: "Client A", source: "Synthetic background" } } }, { subject: "Client A" }, { body: "Client A" }, { sectionFormats: { bio: "<b>" } }, { sectionFormats: { unknown: "bullets" } }]) {
    assert.equal(model.parseMeetClientLayout({ ...layout, ...extra }), null);
  }
  for (const text of [null, 123, "bad\u0000", "x".repeat(20_001)]) {
    assert.equal(model.parseMeetClientMessage({ subject: null, body: null, sectionEdits: { bio: { text, source: "original" } } }), null);
  }
});

test("section edits render identically in the preview and email while a reused layout pulls the next client", () => {
  const message = { subject: null, body: null, sectionEdits: { bio: { text: "Client A <SCRIPT>\nSecond paragraph", source: "Synthetic background" }, medications: { text: "Call the referring team", source: "original" } }, note: "Please call before arrival.", sectionFormats: { bio: "bullets", safety: "paragraphs" }, sectionOrder: [...model.meetClientSectionIds].reverse() };
  assert.ok(model.parseMeetClientMessage(message));
  const rendered = template.renderMeetClientEmail(summary, "Assessor", "preview", ["Original.docx"], message);
  assert.match(rendered.html, /<li[^>]*>Client A &lt;SCRIPT&gt;<\/li>/);
  assert.doesNotMatch(rendered.html, /<script\b/iu);
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
  const original = { subject: null, body: null, sectionOrder: [...model.meetClientSectionIds], sectionEdits: { support: { text: "Help", source: "Support source" }, bio: { text: "Client", source: "Bio source" } }, sectionFormats: { support: "bullets", bio: "paragraphs" } };
  const reordered = { sectionFormats: { bio: "paragraphs", support: "bullets" }, sectionEdits: { bio: { source: "Bio source", text: "Client" }, support: { source: "Support source", text: "Help" } }, sectionOrder: original.sectionOrder, body: null, subject: null };
  assert.equal(JSON.stringify(model.parseMeetClientMessage(original)), JSON.stringify(model.parseMeetClientMessage(reordered)));
  assert.equal(JSON.stringify(model.meetClientLayout(original)), JSON.stringify(model.meetClientLayout(reordered)));
  assert.equal(model.parseMeetClientMessage({ subject: null, body: "Legacy message", note: "Conflicting message" }), null);
});

test("section edits survive parse and change only that section in every rendered format", () => {
  const source = template.meetClientSourceSections(summary).find(s => s.id === "bio");
  const edits = { bio: { text: 'Client reports a calmer morning. <script>test</script>', source: template.meetClientSectionText(source) } };
  const message = model.parseMeetClientMessage({ subject: null, body: null, sectionEdits: edits });
  assert.deepEqual(clean(message.sectionEdits), edits);
  const rendered = template.renderMeetClientEmail(summary, "Synthetic assessor", "test", [], message);
  assert.ok(rendered.text.includes(edits.bio.text));
  assert.ok(rendered.text.startsWith("Hello team,"));
  assert.ok(rendered.html.includes("scheduled for admission on"), "Editing one section retains the admission introduction");
  assert.ok(rendered.html.includes('&lt;script&gt;test&lt;/script&gt;'));
  assert.ok(!rendered.html.includes('<script>'));
  assert.ok(rendered.text.includes('Synthetic medication support'));
  assert.ok(!rendered.text.includes('Synthetic background'));
  assert.deepEqual(Array.from(template.meetClientSectionConflicts(summary, message)), []);
  assert.deepEqual(Array.from(template.meetClientSectionConflicts({ ...summary, bio: ['Changed source'] }, message)), ['bio']);
  // Losing source data must never silently discard an assessor's edit.
  assert.ok(template.meetClientSections({ ...summary, bio: [] }, message).some(s => s.id === 'bio' && s.text === edits.bio.text));
  assert.deepEqual(Array.from(template.meetClientSectionConflicts({ ...summary, bio: [] }, message)), ['bio']);
});

test("invalid section edits are rejected; older whole-message drafts stay authoritative", () => {
  for (const sectionEdits of [[], null, { shell: { text: 'x', source: 'y' } }, { bio: { text: 'x' } }, { bio: { text: 'x', source: 'y', admin: true } }, { bio: { text: 'x'.repeat(20_001), source: 'y' } }])
    assert.equal(model.parseMeetClientMessage({ subject: null, body: null, sectionEdits }), null);
  const message = { subject: null, body: 'Existing personal message', sectionEdits: { bio: { text: 'Old section edit', source: 'Old' } } };
  assert.ok(!template.renderMeetClientEmail(summary, 'Synthetic assessor', 'test', [], message).text.includes('Old section edit'));
  assert.deepEqual(Array.from(template.meetClientSectionConflicts(summary, message)), []);
});

test("edited medication section retains the attachment reference", () => {
  const rendered = template.renderMeetClientEmail(summary, 'Synthetic assessor', 'test', [], { subject: null, body: null, sectionEdits: { medications: { text: 'Reviewed with the referring team.', source: 'old' } } });
  assert.match(rendered.text, /medication list in the admission packet/);
});

test("optional notes stay separate from chart edits and reusable layouts", () => {
  const message = model.parseMeetClientMessage({ subject: null, body: null, note: "Call before arrival." });
  assert.equal(message.note, "Call before arrival.");
  assert.equal(message.sectionEdits, undefined);
  assert.deepEqual(Array.from(template.meetClientSectionConflicts(summary, message)), []);
  assert.ok(template.renderMeetClientEmail(summary, "Assessor", "preview", [], message).text.includes(message.note));
  assert.ok(!JSON.stringify(model.meetClientLayout(message)).includes(message.note));
  assert.equal(model.parseMeetClientLayout({ ...model.meetClientLayout(message), note: message.note }), null);
  for (const note of [null, 10, "bad\u0000", "x".repeat(20_001)]) assert.equal(model.parseMeetClientMessage({ subject: null, body: null, note }), null);
  assert.equal(model.parseMeetClientMessage({ subject: null, body: null, sectionEdits: { message: { text: "Note", source: "" } } }), null);
});
