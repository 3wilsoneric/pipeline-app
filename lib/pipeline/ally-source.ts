import "server-only";

import { buildAssessmentContext } from "@/lib/assessment/assessment-context";
import { getAssessment, listAssessments } from "@/lib/assessment/assessment-store";
import { readPacketFields } from "@/lib/extraction/extraction-service";
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
  assessment: "Full assessment, source-owned question definitions, visibility, required fields, unanswered values, provenance, schedule, signature, addenda and audit.",
  notes: "All persisted note blocks for this referral. Older topic blocks may be archived; the unified block is the current editor. Preserve block keys, versions and authorship.",
  files: "Native file metadata for this referral, including category, processing status and source IDs. Follow next_cursor. File presence is not proof that its content was read.",
  extraction: "The referral packet's retained extracted fields, candidates, reviewed values and bounded review history. This is not the full original document text.",
  imported: "Retained imported ALLO canvas text and historical assessment candidates. Imported values are source observations, not automatically verified current answers.",
  contacts: "Contacts linked to this referral, with relationship and source information.",
  activity: "Native recent workspace activity, at most 100 events; this is partial history, never a whole-population activity count.",
} as const;
type View = keyof typeof views;
type Input = { view: View; referralId?: number; assessmentId?: string; query?: string; community?: string; owner?: string;
  month?: string; workspaceStatus?: ReferralListOptions["workspaceStatus"]; cursor?: string; sourceRevision?: number };

export class AllySourceError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function parseAllySourceInput(value: unknown): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AllySourceError("Choose a source read.");
  const input = value as Record<string, unknown>;
  const view = input.view ?? "catalog";
  if (typeof view !== "string" || !Object.hasOwn(views, view)) throw new AllySourceError("Choose a catalog view.");
  const allowed = view === "catalog" ? ["view"] : view === "directory"
    ? ["view", "query", "community", "owner", "month", "workspaceStatus", "cursor", "sourceRevision"]
    : view === "assessment" ? ["view", "referralId", "assessmentId"]
    : ["view", "referralId", ...(["files", "assessments"].includes(view) ? ["cursor"] : [])];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new AllySourceError("Unsupported source parameter.");
  if (!["catalog", "directory"].includes(view) && (!Number.isSafeInteger(input.referralId) || Number(input.referralId) < 1)) {
    throw new AllySourceError("Choose a valid referralId from the directory.");
  }
  for (const key of ["query", "community", "owner", "month", "workspaceStatus", "cursor", "assessmentId"]) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || !input[key].trim() || input[key].length > (key === "cursor" ? 2048 : 200) || input[key].includes("\0"))) {
      throw new AllySourceError(`Invalid ${key}.`);
    }
  }
  if (view === "assessment" && (typeof input.assessmentId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.assessmentId))) throw new AllySourceError("Choose an assessmentId from this referral.");
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
      limits: { directoryPage: 20, assessmentsPage: 20, filesPage: 20, activityEvents: 100 },
      gaps: ["original-document-bytes", "full-OCR-document-text", "complete-activity-history", "deleted-workspaces"],
      parameters: { directory: ["query", "community", "owner", "month", "workspaceStatus", "cursor", "sourceRevision"],
        perReferral: "referralId required; assessment also requires assessmentId; files and assessments accept cursor" } };
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
