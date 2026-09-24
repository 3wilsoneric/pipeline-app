import { getPlannedAdmissionDate, plannedAdmissionDateError } from "@/lib/pipeline/admission-lifecycle";
import { requirePipelineUser, type PipelineUser } from "@/lib/auth/pipeline-auth";
import { listAssessments, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { buildAssessmentSummaryReport, selectSignedAssessment } from "@/lib/assessment/assessment-summary";
import { jsonError } from "@/lib/extraction/contracts";
import { getMeetClientAttachmentInventory } from "@/lib/notifications/meet-client-attachments";
import { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";
import { clientDataSheetName, renderClientDataSheet } from "@/lib/notifications/client-data-sheet";
import { getGraphMailReadiness, isMeetClientLive } from "@/lib/notifications/microsoft-graph-mail";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { canModifyReferral } from "@/lib/pipeline/referral-ownership";
import type { Referral } from "@/lib/pipeline/referral-types";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";

import { getOutlookMailReadiness } from "@/lib/notifications/outlook-mail";
import { workspaceOutlookState } from "@/lib/notifications/outlook-handoff";
import { meetClientAttachmentDeliveryMode } from "@/lib/notifications/meet-client-attachment-policy";

export const runtime = "nodejs";

function canSendAdmissionSummary(user: PipelineUser, referral: Referral) {
  return referral.workspaceStatus !== "historical" && canModifyReferral(referral, user);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/admission-summary", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const referralStore = requireReferralStore();
    if (!referralStore.ok) return referralStore.response;
    const assessmentStore = requireAssessmentStore();
    if (!assessmentStore.ok) return assessmentStore.response;

    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const [snapshot, assessmentList] = await Promise.all([
      getReferralWorkflowSnapshot(referralId),
      listAssessments({ referralId, limit: 100 }),
    ]);
    if (!snapshot) return jsonError("Referral not found.", 404);

    const respondWithAdmissionSummary = async () => {
      const assessment = selectSignedAssessment(
        assessmentList.assessments,
        snapshot.decision?.assessmentId ?? snapshot.recommendation?.assessmentId,
      );
      const handoffReferral = { ...snapshot.referral, requirements: snapshot.work_items };
      const report = assessment ? buildAssessmentSummaryReport(assessment, handoffReferral) : null;
      const latestAssessment = assessmentList.assessments[0];
      const chartReport = report ?? (latestAssessment ? buildAssessmentSummaryReport(latestAssessment, handoffReferral) : null);
      if (new URL(request.url).searchParams.get("download") === "chart") {
        return new Response(new Uint8Array(await renderClientDataSheet(chartReport, handoffReferral)), { headers: {
          ...privateHeaders(), "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${clientDataSheetName}"`,
          "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        } });
      }
      const mail = getOutlookMailReadiness();
      const admissionPacket = await loadAdmissionPacketInventory(
        handoffReferral,
        mail.largeAttachmentDeliveryConfigured,
        chartReport,
      );
      const emailBlockers = meetClientEmailBlockers(
        report,
        snapshot.decision?.outcome,
        mail.configured || getGraphMailReadiness().configured,
        admissionPacket.blockers,
        getPlannedAdmissionDate(snapshot.referral),
      );
      const exampleOnly = !isMeetClientLive();
      const canSend = !exampleOnly && canSendAdmissionSummary(auth.user, access.referral);

      const outlook = await summaryOutlookState(referralId, auth.user, exampleOnly);
      return Response.json({
        referral: snapshot.referral,
        report,
        email: {
          example_only: exampleOnly,
          outlook_draft: outlook.draft,
          configured: mail.configured || getGraphMailReadiness().configured,
          sender: mail.sender,
          prepared_by: auth.user.name,
          preview: report ? renderMeetClientEmail(
            report.meetClient, auth.user.name, "Preview — assigned when sent",
            admissionPacket.files.map((file) => file.name),
            undefined, { demo: exampleOnly },
          ) : null,
          eligible: snapshot.decision?.outcome === "accepted",
          can_send: canSend,
          can_edit_recipients: canSendAdmissionSummary(auth.user, access.referral),
          ready: canSend && emailBlockers.length === 0,
          sent_at: assessment?.meet_client_sent_at ?? null,
          blockers: emailBlockers,
          admission_packet: {
            revision: admissionPacket.revision,
            files: admissionPacket.files.map((file) => ({
              document_id: file.documentId,
              name: file.name,
              category: file.category,
              byte_size: file.byteSize,
              ready: file.ready,
              generated: file.generatedContent !== undefined,
            })),
            total_bytes: admissionPacket.totalBytes,
            ready: admissionPacket.ready,
            delivery_mode: meetClientAttachmentDeliveryMode(admissionPacket.files),
          },
        },
      }, { headers: privateHeaders() });
    };
    return respondWithAdmissionSummary();
  });
}

async function loadAdmissionPacketInventory(
  referral: Parameters<typeof getMeetClientAttachmentInventory>[0],
  largeAttachmentDeliveryConfigured: boolean,
  report: ReturnType<typeof buildAssessmentSummaryReport> | null,
) {
  try {
    return await getMeetClientAttachmentInventory(referral, { largeAttachmentDeliveryConfigured, report });
  } catch {
    return {
      files: [],
      revision: "",
      totalBytes: 0,
      ready: false,
      blockers: ["Admission packet files are temporarily unavailable. Refresh before sending."],
      deliveryMode: null,
      largeAttachmentDeliveryConfigured,
    } satisfies Awaited<ReturnType<typeof getMeetClientAttachmentInventory>>;
  }
}

function meetClientEmailBlockers(
  report: ReturnType<typeof buildAssessmentSummaryReport> | null,
  outcome: string | undefined,
  configured: boolean,
  attachmentBlockers: string[],
  admissionDate?: string,
) {
  const blockers: string[] = [];
  const dateError = plannedAdmissionDateError(admissionDate);
  if (dateError) blockers.push(dateError);
  if (!report) blockers.push("Complete an assessment before preparing the summary.");
  else if (!report.signed) blockers.push("Sign the assessment before preparing the summary.");
  if (outcome !== "accepted") blockers.push("Record an accepted admission decision before emailing the summary.");
  if (!configured) blockers.push("Configure the Outlook connection.");
  blockers.push(...attachmentBlockers);
  return blockers;
}

async function parseReferralId(context: { params: Promise<{ referralId: string }> }) {
  const { referralId } = await context.params;
  const parsed = Number.parseInt(referralId, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}

async function summaryOutlookState(referralId: number, user: PipelineUser, exampleOnly: boolean) {
  return exampleOnly ? { draft: null } : workspaceOutlookState(referralId, user.delegation ? "" : user.id);
}
