import "server-only";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getReferralStoreReadiness } from "@/lib/pipeline/referral-store";
import type { AssessmentRecommendation } from "@/lib/pipeline/referral-types";
import { getGraphMailReadiness, sendUnderReviewEmail } from "./microsoft-graph-mail";

export type UnderReviewEmailStatus = "sent" | "already_requested" | "unavailable" | "failed";

// The recommendation is already committed when this runs. A unique claim stops
// retries and concurrent requests from sending the same version twice. An
// ambiguous Graph failure is recorded and never retried automatically.
export async function notifyUnderReview(referralId: number, recommendation: AssessmentRecommendation, message: string): Promise<UnderReviewEmailStatus> {
  if (recommendation.outcome !== "needs_more_information") return "unavailable";
  if (!message.trim() || message.length > 4000) return "unavailable";
  if (getReferralStoreReadiness().mode !== "postgres" || !getGraphMailReadiness().configured) return "unavailable";
  try { return await claimAndNotify(referralId, recommendation, message); }
  catch { return "failed"; }
}

async function claimAndNotify(referralId: number, recommendation: AssessmentRecommendation, message: string): Promise<UnderReviewEmailStatus> {
  const sql = getPipelineSql();
  const claimed = await sql<{ recommendation_id: string }[]>`
    insert into pipeline.under_review_email_notifications
      (recommendation_id, recommendation_version, referral_id, status)
    values (${recommendation.recommendationId}, ${recommendation.version}, ${referralId}, 'sending')
    on conflict (recommendation_id, recommendation_version) do nothing
    returning recommendation_id
  `;
  if (claimed.length === 0) {
    const existing = await sql<{ status: "sending" | "sent" | "failed" }[]>`
      select status from pipeline.under_review_email_notifications
      where recommendation_id = ${recommendation.recommendationId}
        and recommendation_version = ${recommendation.version}
    `;
    return existing[0]?.status === "sent" ? "sent" : existing[0]?.status === "failed" ? "failed" : "already_requested";
  }
  let acceptedByGraph = false;
  try {
    await sendUnderReviewEmail(referralId, message);
    acceptedByGraph = true;
    await sql`
      update pipeline.under_review_email_notifications
      set status = 'sent', finished_at = now()
      where recommendation_id = ${recommendation.recommendationId}
        and recommendation_version = ${recommendation.version}
    `;
    return "sent";
  } catch {
    if (acceptedByGraph) return "sent";
    await sql`
      update pipeline.under_review_email_notifications
      set status = 'failed', finished_at = now(), error_code = 'provider_unconfirmed'
      where recommendation_id = ${recommendation.recommendationId}
        and recommendation_version = ${recommendation.version}
    `;
    return "failed";
  }
}
