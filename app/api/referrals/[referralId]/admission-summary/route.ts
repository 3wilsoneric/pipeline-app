import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { listAssessments, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { buildAssessmentSummaryReport } from "@/lib/assessment/assessment-summary";
import { jsonError } from "@/lib/extraction/contracts";
import { getMeetClientAttachmentInventory } from "@/lib/notifications/meet-client-attachments";
import { getGraphMailReadiness } from "@/lib/notifications/microsoft-graph-mail";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";

export const runtime = "nodejs";

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

    const assessment = selectSignedAssessment(assessmentList.assessments, snapshot.recommendation?.assessmentId);
    const report = assessment ? buildAssessmentSummaryReport(assessment, snapshot.referral) : null;
    const mail = getGraphMailReadiness();
    const admissionPacket = await loadAdmissionPacketInventory(
      snapshot.referral,
      mail.largeAttachmentDeliveryConfigured,
    );
    const emailBlockers = meetClientEmailBlockers(
      report,
      snapshot.decision?.outcome,
      mail.configured,
      admissionPacket.blockers,
    );

    return Response.json({
      referral: snapshot.referral,
      report,
      email: {
        configured: mail.configured,
        allowed_recipient_domains: mail.allowedRecipientDomains,
        eligible: snapshot.decision?.outcome === "accepted",
        ready: emailBlockers.length === 0,
        blockers: emailBlockers,
        admission_packet: {
          files: admissionPacket.files.map((file) => ({
            document_id: file.documentId,
            name: file.name,
            category: file.category,
            byte_size: file.byteSize,
            ready: file.ready,
          })),
          total_bytes: admissionPacket.totalBytes,
          ready: admissionPacket.ready,
          delivery_mode: admissionPacket.deliveryMode,
        },
      },
    }, { headers: privateHeaders() });
  });
}

async function loadAdmissionPacketInventory(
  referral: Parameters<typeof getMeetClientAttachmentInventory>[0],
  largeAttachmentDeliveryConfigured: boolean,
) {
  try {
    return await getMeetClientAttachmentInventory(referral, { largeAttachmentDeliveryConfigured });
  } catch {
    return {
      files: [],
      totalBytes: 0,
      ready: false,
      blockers: ["Admission packet files are temporarily unavailable. Refresh before sending."],
      deliveryMode: null,
      largeAttachmentDeliveryConfigured,
    } satisfies Awaited<ReturnType<typeof getMeetClientAttachmentInventory>>;
  }
}

function selectSignedAssessment(
  assessments: Awaited<ReturnType<typeof listAssessments>>["assessments"],
  recommendedAssessmentId?: string,
) {
  const recommended = assessments.find((item) => item.assessment_id === recommendedAssessmentId);
  return recommended?.signed_at ? recommended : assessments.find((item) => item.signed_at) ?? null;
}

function meetClientEmailBlockers(
  report: ReturnType<typeof buildAssessmentSummaryReport> | null,
  outcome: string | undefined,
  configured: boolean,
  attachmentBlockers: string[],
) {
  const blockers: string[] = [];
  if (!report) blockers.push("Complete an assessment before preparing the summary.");
  else if (!report.signed) blockers.push("Sign the assessment before preparing the summary.");
  if (outcome !== "accepted") blockers.push("Record an accepted admission decision before emailing the summary.");
  if (!configured) blockers.push("Configure the approved Microsoft 365 sender and recipient domains.");
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
