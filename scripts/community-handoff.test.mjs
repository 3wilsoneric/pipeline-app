import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
import { loadEntry } from "./contact-import-fixtures.mjs";

const root = process.cwd();
const schema = loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts");
const summaryOwner = loadTypeScriptModule(root, "lib/assessment/assessment-summary.ts");
const sheetOwner = loadTypeScriptModule(root, "lib/notifications/client-data-sheet.ts");
const emailOwner = loadTypeScriptModule(root, "lib/notifications/meet-client-email-template.ts");
const referral = { id: 7, version: 3, name: "Synthetic <script>alert(1)</script>", dob: "1980-01-01", community: "San Pablo", source: "Synthetic referrer", county: "Synthetic county", payer: "Recorded coverage", phone: "", email: "", admissionDate: "2026-09-30" };
const assessment = { ...schema.createEmptyAssessmentToolData(), assessment_id: "synthetic-chart", version: 4, status: "complete", updated_by: { name: "Synthetic Assessor" }, signed_by: { name: "Synthetic Assessor" }, signed_at: "2026-09-19T12:00:00Z", prior_placements: "Synthetic placement note", medications_at_intake: ["Recorded medication"], conservatorship_type: "no", special_diet_details: "Recorded diet" };

test("email copy follows admission handoff sections without inventing example-client facts", () => {
  const summary = summaryOwner.buildMeetClientSummary(assessment, referral);
  const email = emailOwner.renderMeetClientEmail(summary, "Synthetic sender", "synthetic-delivery", ["Client data sheet.html"]);
  for (const label of ["Med room", "Allergies &amp; diet", "Billing team", "Recorded diet", "Recorded coverage", "Not recorded", "Client data sheet.html"]) assert.ok(email.html.includes(label), label);
  assert.equal(email.subject, `Meet the Client | ${summary.community || "New admission"}`);
  assert.doesNotMatch(email.html, /30 days of meds|No Food Allergy|SSI application has not started|<script>/);
});

test("injection handoff preserves named dates and exposes missing details without calculating a due date", () => {
  const recorded = { ...assessment, im_injections: "yes", im_injections_details: "Synthetic injection A - recorded dose", injection_frequency: "A - every 4 weeks", last_injection: "A - around September 2\nB - unknown", next_injection_due: "A - confirm with clinic" };
  const notes = Object.fromEntries(summaryOwner.buildMeetClientSummary(recorded, referral).medicationNotes.map(({ label, value }) => [label, value]));
  assert.equal(notes["Last injection given"], recorded.last_injection);
  assert.equal(notes["Next injection due"], recorded.next_injection_due);
  const incomplete = summaryOwner.buildMeetClientSummary({ ...recorded, next_injection_due: null }, referral);
  assert.match(incomplete.medicationNotes.find(({ label }) => label === "Next injection due").value, /Not recorded; confirm/);
  const noInjections = summaryOwner.buildMeetClientSummary({ ...recorded, im_injections: "no" }, referral);
  assert.equal(noInjections.medicationNotes.find(({ label }) => label === "IM injections").value, "No");
  assert.ok(!noInjections.medicationNotes.some(({ label }) => label === "Last injection given"));
  const unknown = summaryOwner.buildMeetClientSummary({ ...assessment, im_injections: null }, referral);
  assert.match(unknown.medicationNotes.find(({ label }) => label === "IM injections").value, /Not recorded; confirm/);
  const email = emailOwner.renderMeetClientEmail(summaryOwner.buildMeetClientSummary({ ...assessment, medications_at_intake: [] }, referral), "Fixture", "fixture");
  assert.match(email.html, /confirm the medication list/);
});

test("safety handoff keeps history and current support distinct, preserves zero, and never assumes no violence", () => {
  const recorded = { ...assessment, physical_altercations: "yes", physical_altercation_details: "Historical incident <script>bad()</script>; settled with support", assault_history: "yes", last_assault_details: "Historical incident in 2020", assaults_last_two_years_count: 0, current_safety_measures: "Recorded support plan" };
  const summary = summaryOwner.buildMeetClientSummary(recorded, referral);
  const notes = Object.fromEntries(summary.safetyNotes.map(({ label, value }) => [label, value]));
  assert.equal(notes["Reported assaults in the last two years"], "0");
  assert.equal(notes["Last reported assault / context"], recorded.last_assault_details);
  assert.equal(notes["Current safety supports"], recorded.current_safety_measures);
  const email = emailOwner.renderMeetClientEmail(summary, "Fixture", "fixture");
  assert.match(email.html, /Behavior &amp; safety/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>|High risk|Client is violent/);
  const unknown = summaryOwner.buildMeetClientSummary(assessment, referral);
  assert.match(unknown.safetyNotes.find(({ label }) => label === "Assault history reported").value, /Not recorded; confirm/);
  const noHistory = summaryOwner.buildMeetClientSummary({ ...recorded, assault_history: "no", physical_altercations: "no" }, referral);
  assert.equal(noHistory.safetyNotes.find(({ label }) => label === "Assault history reported").value, "No");
  assert.ok(!noHistory.safetyNotes.some(({ label }) => label === "Last reported assault / context"));
});

test("agreement copy uses the work item status, never the assessment signature or an uploaded filename", () => {
  const expected = { needed: /Still needed/, requested: /awaiting the signed copy/, received: /signatures still need review/, reviewed: /Marked reviewed in the chart/, waived: /Requirement waived/, expired: /copy expired/, unavailable: /Signed copy unavailable/, not_applicable: /Marked not applicable/ };
  for (const [status, pattern] of Object.entries(expected)) {
    const context = { ...referral, requirements: [{ type: "signed_admission_agreement", status, evidenceDocumentName: "Signed-agreement.pdf", waiverReason: "Synthetic waiver" }] };
    const report = summaryOwner.buildAssessmentSummaryReport(assessment, context);
    const agreement = report.meetClient.admissionNotes.find(({ label }) => label === "Signed admission agreement");
    assert.match(agreement.value, pattern);
    assert.match(agreement.value, /Recorded evidence: Signed-agreement.pdf/);
    assert.match(emailOwner.renderMeetClientEmail(report.meetClient, "Fixture", "fixture").html, pattern);
    assert.match(sheetOwner.renderClientDataSheet(report, context), pattern);
  }
  const absent = summaryOwner.buildMeetClientSummary(assessment, referral).admissionNotes.find(({ label }) => label === "Signed admission agreement");
  assert.match(absent.value, /Not recorded; confirm/);
  assert.match(summaryOwner.buildAdmissionAgreementSummary([{ type: "signed_admission_agreement", status: "reviewed" }]).value, /No supporting document is linked/);
  assert.match(sheetOwner.renderClientDataSheet(null, { ...referral, requirements: [{ type: "signed_admission_agreement", status: "received" }] }), /signatures still need review/);
});

test("data sheet contains canonical chart sections, recorded version, unsigned status and escaped text", () => {
  const report = summaryOwner.buildAssessmentSummaryReport(assessment, referral);
  const html = sheetOwner.renderClientDataSheet(report, referral);
  assert.ok(html.includes("Synthetic placement note"));
  assert.ok(html.includes("Assessment synthetic-chart"));
  assert.ok(html.includes("Version 4"));
  assert.ok(html.includes("Referral version 3"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.doesNotMatch(html, /<script>|<iframe|https?:\/\//);
  const draft = sheetOwner.renderClientDataSheet(null, referral);
  assert.ok(draft.includes("Working chart - not signed"));
  assert.ok(draft.includes("Assessment not yet recorded"));
});

const env = { PIPELINE_GRAPH_TENANT_ID: "synthetic-tenant", PIPELINE_GRAPH_CLIENT_ID: "synthetic-client", PIPELINE_GRAPH_CLIENT_SECRET: "synthetic-not-a-secret", PIPELINE_MEET_CLIENT_SENDER: "sender@example.test", PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS: "example.test" };

test("recipient limit covers a 22-contact community, with strict domains and a combined bounded audience", () => {
  const graph = loadTypeScriptModule(root, "lib/notifications/microsoft-graph-mail.ts", { process: { ...process, env } });
  const values = Array.from({ length: 22 }, (_, index) => `person${index}@example.test`);
  assert.equal(graph.validateMeetClientRecipients(values).ok, true);
  assert.equal(graph.validateMeetClientRecipients([...values, "outside@unapproved.test"]).ok, false);
  assert.equal(graph.validateMeetClientRecipients(Array.from({ length: 101 }, (_, index) => `p${index}@example.test`)).ok, false);
  assert.equal(graph.validateMeetClientRecipients(["name\r\nBcc: x@example.test"]).ok, false);
});

test("Graph direct send keeps To and Cc separate and attaches exact generated data-sheet bytes", async () => {
  const requests = [];
  const graph = loadTypeScriptModule(root, "lib/notifications/microsoft-graph-mail.ts", { process: { ...process, env }, fetch: async (url, init) => {
    requests.push({ url, init });
    return url.includes("/oauth2/") ? Response.json({ access_token: "synthetic-token" }) : new Response(null, { status: 202 });
  } });
  const html = sheetOwner.renderClientDataSheet(summaryOwner.buildAssessmentSummaryReport(assessment, referral), referral);
  const bytes = Buffer.from(html);
  const result = await graph.sendMeetClientMail({ recipients: ["care@example.test"], ccRecipients: ["billing@example.test"], summary: summaryOwner.buildMeetClientSummary(assessment, referral), preparedBy: "Synthetic sender", deliveryId: "synthetic-delivery", attachments: [{ documentId: "chart:7", name: "Client data sheet.html", contentType: "text/html", byteSize: bytes.length, contentBytes: bytes }] });
  assert.equal(result.attachmentCount, 1);
  assert.equal(requests.length, 2);
  const sent = JSON.parse(requests[1].init.body).message;
  assert.deepEqual(sent.toRecipients, [{ emailAddress: { address: "care@example.test" } }]);
  assert.deepEqual(sent.ccRecipients, [{ emailAddress: { address: "billing@example.test" } }]);
  assert.equal(Buffer.from(sent.attachments[0].contentBytes, "base64").toString(), html);
});

test("packet includes chart documents, assessment attachments and data sheet without crossing referral or scan boundaries", async () => {
  const ids = ["f137d093-cc6b-4001-a8b4-08ecc5d1c1da", "f137d093-cc6b-4001-a8b4-08ecc5d1c1db", "f137d093-cc6b-4001-a8b4-08ecc5d1c1dc"];
  let status = "clean";
  const metadata = (id) => ({ document_id: id, file_name: `${id}.pdf`, content_type: "application/pdf", byte_size: 40, malware_scan_status: status });
  const attachmentOwner = loadEntry("lib/notifications/meet-client-attachments.ts", {
    "@/lib/pipeline/referral-store": { listReferralFiles: async () => ({ files: ids.map((id, index) => ({ id, referralId: index === 2 ? 8 : 7, category: index === 1 ? "Assessment" : "Admission", name: `${id}.pdf` })) }) },
    "@/lib/extraction/document-assets": { getDocumentFileMetadata: async (id) => metadata(id), getDocumentOriginalAsset: async () => ({ byteSize: 40, contentType: "application/pdf", container: "fixture", blobKey: "fixture.pdf" }) },
    "@/lib/extraction/azure-blob": { getAzureBlobUploadSigner: () => ({ createReadUrl: async () => "https://fixture.example.invalid/document" }) },
    "./client-data-sheet": sheetOwner,
  });
  const inventory = await attachmentOwner.getMeetClientAttachmentInventory(referral, { report: summaryOwner.buildAssessmentSummaryReport(assessment, referral) });
  assert.equal(inventory.ready, true);
  assert.equal(inventory.files.length, 3);
  assert.ok(inventory.files.some((file) => file.documentId === ids[1]));
  assert.ok(!inventory.files.some((file) => file.documentId === ids[2]));
  assert.ok(inventory.files[0].generatedContent.includes("Synthetic placement note"));
  assert.equal((await attachmentOwner.prepareMeetClientMailAttachments(inventory))[0].contentBytes.toString(), inventory.files[0].generatedContent);
  status = "infected";
  const blocked = await attachmentOwner.getMeetClientAttachmentInventory(referral);
  assert.equal(blocked.ready, false);
  await assert.rejects(() => attachmentOwner.prepareMeetClientMailAttachments(blocked), /safety scanning/);
});
