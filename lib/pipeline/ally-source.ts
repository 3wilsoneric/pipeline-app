import "server-only";

import { buildAssessmentContext, assessmentContextDefinitions } from "@/lib/assessment/assessment-context";
import { getAssessment, listAssessments } from "@/lib/assessment/assessment-store";
import { readPacketFields } from "@/lib/extraction/extraction-service";
import { readReferralDocumentPage } from "@/lib/extraction/document-text";
import { listCommunicationPackets } from "@/lib/notifications/admission-packet-store";
import { listClientNotes } from "./client-notes-store";
import { listReferralContacts } from "./contact-store";
import { getHistoricalProfile } from "./historical-profile-store";
import { getReferralActivitySnapshot } from "./referral-activity";
import { getReferral, getReferralStoreRevision, listReferralFiles, listReferrals, type ReferralListOptions } from "./referral-store";
import { getReferralWorkflowSnapshot } from "./workflow-store";

const views = {
  catalog: "Available source-owned reads. These operations cannot edit, sign, send or admit.",
  directory: "Workspace search across all active, historical and archived referrals, excluding trash. query searches the native directory; community, owner, month and workspaceStatus are optional filters. Follow next_cursor with the same filters and sourceRevision; one person may have several referral episodes.",
  workspace: "Current full workflow: referral, requirements, decisions, reviews, recommendation and linked assessment ID. Separate source reads are not an atomic historical snapshot.",
  assessments: "Assessment records for one referral, including drafts and revisions. Follow next_cursor. Use assessment to open a returned assessmentId with question definitions and answer provenance.",
  "assessment-review": "Review assessment answers across workspaces in batches. fields selects exact question keys; query searches question labels/keys, not people. Optional community and owner filter the linked referral. Optional from/through are inclusive ISO timestamps on dateField (created_at, completed_at or scheduled_start_at). Follow next_cursor with sourceRevision and referralRevision until complete; scanned counts are not matching-population totals. Trash is excluded. Missing answers and drafts remain explicit.",
  assessment: "Full assessment, source-owned question definitions, visibility, required fields, unanswered values, provenance, schedule, signature, addenda and audit.",
  notes: "All persisted note blocks for this referral. Older topic blocks may be archived; the unified block is the current editor. Preserve block keys, versions and authorship.",
  files: "Native file metadata for this referral, including category, processing status and source IDs. Follow next_cursor. File presence is not proof that its content was read.",
  document: "Read one actual document page by documentId from files. Supply page (default 1), then documentHash and nextPage for continuation. PDF text or local OCR; source errors are explicit. This is page evidence, not a whole-document summary.",
  communications: "Retained Meet the Client communications, including draft/submitted state, message, selected attachment metadata and delivery audit. Follow next_cursor. Submitted is not proof of recipient delivery. Legacy Outlook/link packets are outside this owner.",
  extraction: "The referral packet's retained extracted fields, candidates, reviewed values and bounded review history. This is not the full original document text.",
  imported: "Retained imported ALLO canvas text and historical assessment candidates. Imported values are source observations, not automatically verified current answers.",
  contacts: "Contacts linked to this referral, with relationship and source information.",
  activity: "Native recent workspace activity, at most 100 events; this is partial history, never a whole-population activity count.",
} as const;
type View = keyof typeof views;
type Input = { view: View; referralId?: number; assessmentId?: string; query?: string; community?: string; owner?: string;
  month?: string; workspaceStatus?: ReferralListOptions["workspaceStatus"]; cursor?: string; sourceRevision?: number;
  documentId?: string; page?: number; documentHash?: string; fields?: string[];
  from?: string; through?: string; dateField?: "created_at" | "completed_at" | "scheduled_start_at"; referralRevision?: number };

export class AllySourceError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function parseAllySourceInput(value: unknown): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AllySourceError("Choose a source read.");
  const input = value as Record<string, unknown>;
  const view = input.view ?? "catalog";
  if (typeof view !== "string" || !Object.hasOwn(views, view)) throw new AllySourceError("Choose a catalog view.");
  const allowed = view === "catalog" ? ["view"] : view === "assessment-review"
    ? ["view", "fields", "query", "community", "owner", "from", "through", "dateField", "cursor", "sourceRevision", "referralRevision"] : view === "directory"
    ? ["view", "query", "community", "owner", "month", "workspaceStatus", "cursor", "sourceRevision"]
    : view === "assessment" ? ["view", "referralId", "assessmentId"]
    : view === "document" ? ["view", "referralId", "documentId", "page", "documentHash"]
    : ["view", "referralId", ...(["files", "assessments", "communications"].includes(view) ? ["cursor"] : [])];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new AllySourceError("Unsupported source parameter.");
  if (!["catalog", "directory", "assessment-review"].includes(view) && (!Number.isSafeInteger(input.referralId) || Number(input.referralId) < 1)) {
    throw new AllySourceError("Choose a valid referralId from the directory.");
  }
  for (const key of ["query", "community", "owner", "month", "workspaceStatus", "cursor", "assessmentId"]) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || !input[key].trim() || input[key].length > (key === "cursor" ? 2048 : 200) || input[key].includes("\0"))) {
      throw new AllySourceError(`Invalid ${key}.`);
    }
  }
  if (view === "assessment-review") {
    const keys = new Set(assessmentContextDefinitions().fields.map(field => String(field.key)));
    if (input.fields !== undefined && (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 12 || new Set(input.fields).size !== input.fields.length || input.fields.some(key => typeof key !== "string" || !keys.has(key)))) throw new AllySourceError("Choose up to twelve question keys from the assessment catalog.");
    if (input.dateField !== undefined && !["created_at", "completed_at", "scheduled_start_at"].includes(String(input.dateField))) throw new AllySourceError("Choose an assessment date field.");
    for (const key of ["from", "through"]) if (input[key] !== undefined && (typeof input[key] !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input[key]) || !Number.isFinite(Date.parse(input[key])))) throw new AllySourceError("Use an ISO timestamp with timezone for the date range.");
    if ((input.from || input.through) && !input.dateField) throw new AllySourceError("Choose the date field for the cohort.");
    if (input.from && input.through && Date.parse(String(input.from)) > Date.parse(String(input.through))) throw new AllySourceError("Choose an ordered date range.");
    if (input.referralRevision !== undefined && (!Number.isSafeInteger(input.referralRevision) || Number(input.referralRevision)<0)) throw new AllySourceError("Invalid referralRevision.");
    if (input.cursor && (input.sourceRevision === undefined || input.referralRevision === undefined)) throw new AllySourceError("Continue with both sourceRevision and referralRevision.");
  }
  if (view === "assessment" && (typeof input.assessmentId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.assessmentId))) throw new AllySourceError("Choose an assessmentId from this referral.");
  if (view === "document") {
    if (typeof input.documentId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.documentId)) throw new AllySourceError("Choose a documentId from files.");
    if (input.page !== undefined && (!Number.isSafeInteger(input.page) || Number(input.page) < 1)) throw new AllySourceError("Choose a positive page number.");
    if (input.documentHash !== undefined && (typeof input.documentHash !== "string" || !/^[a-f0-9]{64}$/.test(input.documentHash))) throw new AllySourceError("Invalid documentHash.");
    if (Number(input.page ?? 1) > 1 && !input.documentHash) throw new AllySourceError("Continue with the documentHash from page one.");
  }
  if (input.workspaceStatus !== undefined && !["active", "historical", "archived", "all"].includes(String(input.workspaceStatus))) throw new AllySourceError("Invalid workspaceStatus.");
  if (input.month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.month))) throw new AllySourceError("Choose a YYYY-MM month.");
  if (input.sourceRevision !== undefined && (!Number.isSafeInteger(input.sourceRevision) || Number(input.sourceRevision) < 0)) throw new AllySourceError("Invalid sourceRevision.");
  if (view === "directory" && input.cursor && input.sourceRevision === undefined) throw new AllySourceError("Continue with the sourceRevision from the first page.");
  return { ...input, view } as Input;
}

export async function readAllyPipelineSource(value: unknown) {
  const input = parseAllySourceInput(value);
  let data: unknown;
  let complete = true;
  if (input.view === "catalog") {
    data = { views: Object.entries(views).map(([view, description]) => ({ view, description })),
      assessmentQuestions: assessmentContextDefinitions().fields.map(field => ({key:field.key, label:field.label, section:field.section})),
      limits: { assessmentReviewPage:20, directoryPage: 20, assessmentsPage: 20, filesPage: 20, activityEvents: 100 },
      gaps: ["original-document-bytes-not-returned", "complete-activity-history", "legacy-outlook-link-communications", "deleted-workspaces"],
      parameters: { directory: ["query", "community", "owner", "month", "workspaceStatus", "cursor", "sourceRevision"],
        perReferral: "referralId required; assessment also requires assessmentId; files and assessments accept cursor" } };
  } else if (input.view === "assessment-review") {
    const referralRevision = await getReferralStoreRevision();
    if (input.referralRevision !== undefined && input.referralRevision !== referralRevision) throw new AllySourceError("Workspaces changed. Restart this review.",409);
    const page = await listAssessments({limit:20,cursor:input.cursor,dateField:input.dateField,from:input.from,through:input.through});
    if (input.sourceRevision !== undefined && input.sourceRevision !== page.revision) throw new AllySourceError("Assessments changed. Restart this review.",409);
    const records = [];
    for (let start=0; start<page.assessments.length; start+=3) {
      const batch = await Promise.all(page.assessments.slice(start,start+3).map(async assessment => {
        const referral = await getReferral(assessment.referral_id);
        if (!referral || input.community && referral.community !== input.community || input.owner && referral.owner !== input.owner) return null;
        const when = input.dateField ? assessment[input.dateField] : null;
        if ((input.from || input.through) && (!when || !Number.isFinite(Date.parse(when)) || input.from && Date.parse(when)<Date.parse(input.from) || input.through && Date.parse(when)>Date.parse(input.through))) return null;
        const context = buildAssessmentContext(assessment);
        const fields = context.fields.filter(field => (!input.fields || input.fields.includes(field.definition.key)) &&
          (!input.query || `${field.definition.key} ${field.definition.label}`.toLowerCase().includes(input.query.toLowerCase())));
        return {referralId:referral.id, name:referral.name, community:referral.community, owner:referral.owner,
          assessmentId:assessment.assessment_id, version:assessment.version, status:assessment.status,
          createdAt:assessment.created_at, completedAt:assessment.completed_at, scheduledStartAt:assessment.scheduled_start_at,
          definitionHash:context.definitionHash, answers:fields.map(field => ({key:field.definition.key,label:field.definition.label,...field.answer,evidence:field.evidence}))};
      }));
      records.push(...batch.filter(record => record !== null));
    }
    // Both owners must retain their revision through a page. Continuation never
    // silently mixes an amended assessment or a changed referral assignment.
    const after = await listAssessments({limit:1});
    if (after.revision !== page.revision || await getReferralStoreRevision() !== referralRevision) throw new AllySourceError("Source changed during review. Restart.",409);
    data = {sourceRevision:page.revision,referralRevision, scanned:page.assessments.length, next_cursor:page.next_cursor,
      dateField:input.dateField ?? null, from:input.from ?? null, through:input.through ?? null, records,
      coverage:"Answers selected from this page of assessment records. Follow every page for the complete cohort; records are assessments, not unique people. Historical versions and unanswered values remain distinct."};
    complete = !page.next_cursor;
  } else if (input.view === "directory") {
    const before = await getReferralStoreRevision();
    if (input.sourceRevision !== undefined && input.sourceRevision !== before) throw new AllySourceError("Workspace directory changed. Restart from its first page.", 409);
    const page = await listReferrals({ scope: "team", query: input.query, community: input.community, owner: input.owner,
      month: input.month, workspaceStatus: input.workspaceStatus ?? "all", cursor: input.cursor, limit: 20, sort: "created_asc", includeTotal: true });
    if (before !== page.revision || before !== await getReferralStoreRevision()) throw new AllySourceError("Workspace directory changed during this read. Retry it.", 409);
    data = { sourceRevision: page.revision, total: page.total, next_cursor: page.next_cursor ?? null,
      records: page.referrals.map(r => ({ referralId: r.id, clientId: r.clientId, name: r.name, community: r.community,
        owner: r.owner, stage: r.stage, workflowStatus: r.workflowStatus, workspaceStatus: r.workspaceStatus,
        workspaceOrigin: r.workspaceOrigin, received: r.date, createdAt: r.createdAt, updatedAt: r.updatedAt,
        county: r.county, referralSource: r.source, plannedAdmissionDate: r.plannedAdmissionDate,
        actualAdmissionDate: r.actualAdmissionDate, admissionDate: r.admissionDate })) };
    complete = !page.next_cursor;
  } else {
    const referral = await getReferral(input.referralId!);
    if (!referral) throw new AllySourceError("Workspace not found.", 404);
    switch (input.view) {
      case "workspace":
        data = await getReferralWorkflowSnapshot(referral.id);
        if (!data) throw new AllySourceError("Workspace changed during this read.", 409);
        break;
      case "assessments": {
        const page = await listAssessments({ referralId: referral.id, limit: 20, cursor: input.cursor });
        data = { total: page.total, sourceRevision: page.revision, next_cursor: page.next_cursor,
          records: page.assessments.map(a => ({ assessmentId: a.assessment_id, referralId: a.referral_id, version: a.version,
            status: a.status, assessorId: a.assessor_id, createdAt: a.created_at, updatedAt: a.updated_at,
            scheduledStartAt: a.scheduled_start_at, scheduleStatus: a.schedule_status, startedAt: a.started_at,
            completedAt: a.completed_at, signedAt: a.signed_at, sentAt: a.meet_client_sent_at })) };
        complete = !page.next_cursor;
        break;
      }
      case "assessment": {
        const assessment = await getAssessment(input.assessmentId!);
        if (!assessment || assessment.referral_id !== referral.id) throw new AllySourceError("Assessment not found in this workspace.", 404);
        data = buildAssessmentContext(assessment);
        break;
      }
      case "notes": data = { blocks: await listClientNotes(referral.id) }; break;
      case "files": {
        const page = await listReferralFiles({ referralId: referral.id, limit: 20, cursor: input.cursor });
        data = { total: page.total, sourceRevision: page.revision, next_cursor: page.next_cursor ?? null,
          files: page.files.map(({ previewUrl, downloadUrl, thumbnailUrl, ...metadata }) => {
            // Transport URLs are not evidence or model capabilities; retain source IDs.
            void previewUrl; void downloadUrl; void thumbnailUrl; return metadata;
          }) };
        complete = !page.next_cursor;
        break;
      }
      case "extraction": data = { packetId: referral.packetId ?? null, fields: referral.packetId ? await readPacketFields(referral.packetId) : null }; complete = false; break;
      case "document": data = await readReferralDocumentPage(referral.id, input.documentId!, input.page ?? 1, input.documentHash); complete = false; break;
      case "communications": {
        const page = await listCommunicationPackets({ referralId: referral.id, cursor: input.cursor });
        data = { next_cursor: page.nextCursor ?? null, records: page.items.map(packet => ({
          id: packet.id, createdAt: packet.createdAt, assessmentId: packet.assessmentId, assessmentVersion: packet.assessmentVersion,
          message: packet.message, status: packet.communication!.status, submittedAt: packet.communication!.submittedAt ?? null,
          community: packet.communication!.community, admissionDate: packet.communication!.admissionDate,
          assessorName: packet.communication!.assessorName, from: packet.communication!.from, to: packet.communication!.to, cc: packet.communication!.cc,
          audit: packet.communication!.audit, note: packet.communication!.note,
          files: packet.files.map(({ id, name, contentType, byteSize, archived }) => ({ id, name, contentType, byteSize, archived })),
        })) };
        complete = !page.nextCursor; break;
      }
      case "imported": data = ["allo", "import"].includes(referral.workspaceOrigin ?? "") ? await getHistoricalProfile(referral) : { available: false, reason: "This workspace is not imported." }; break;
      case "contacts": data = { contacts: await listReferralContacts(referral.id) }; break;
      case "activity": {
        const snapshot = await getReferralActivitySnapshot(referral.id);
        data = { events: snapshot?.events.map(({ undo, ...event }) => { void undo; return event; }) ?? [], history: "partial", maximumEvents: 100 };
        complete = false;
        break;
      }
    }
  }
  return { schemaVersion: 1, owner: "pipeline", view: input.view, referralId: input.referralId ?? null,
    description: views[input.view], data, complete, readAt: new Date().toISOString(),
    authority: { access: "authenticated-organization-reader", canExecute: false, scope: "native-query-not-report-page-dates" } };
}
