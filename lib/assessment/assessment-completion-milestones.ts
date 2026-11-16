import "server-only";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getAssessmentStoreReadiness, listAssessments } from "./assessment-store";

const completionActions = ["assessment_interview_completed", "assessment_completed", "assessment_signed"];

/** First recorded completion per workspace, including prior revisions/reopened charts.
 * Appointment dates are plans, and updated_at includes unrelated edits; neither
 * is evidence of a completed interview. This is a client count, not a count of
 * repeat interviews. Revisit only if the briefing needs separate reassessments.
 */
export async function getFirstAssessmentCompletions(referralIds: number[]): Promise<Map<number, string>> {
  if (!referralIds.length) return new Map();
  if (getAssessmentStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<{ referral_id: number | string; at: Date | string }[]>`
      select referral_id, min(at) as at from (
        select a.referral_id, e.created_at as at
        from pipeline.assessments a join pipeline.audit_events e
          on e.entity_type = 'assessment' and e.entity_id = a.assessment_id
        where a.referral_id = any(${referralIds}::bigint[]) and e.action = any(${completionActions}::text[])
        union all
        select referral_id, least(completed_at, signed_at) as at from pipeline.assessments
        where referral_id = any(${referralIds}::bigint[]) and (completed_at is not null or signed_at is not null)
      ) milestones group by referral_id
    `;
    return new Map(rows.map(row => [Number(row.referral_id), new Date(row.at).toISOString()]));
  }
  const wanted = new Set(referralIds);
  const result = new Map<number, string>();
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await listAssessments({ limit: 200, cursor });
    for (const assessment of page.assessments) {
      if (!wanted.has(assessment.referral_id)) continue;
      const dates = [assessment.completed_at, assessment.signed_at,
        ...assessment.audit_events.filter(event => completionActions.includes(event.action)).map(event => event.created_at)]
        .filter((at): at is string => Boolean(at && Number.isFinite(Date.parse(at))))
        .map(at => new Date(at).toISOString()).sort();
      const first = dates[0];
      if (first && (!result.has(assessment.referral_id) || first < result.get(assessment.referral_id)!)) result.set(assessment.referral_id, first);
    }
    scanned += page.assessments.length;
    cursor = page.next_cursor ?? undefined;
    if (cursor && scanned >= 10000) throw new Error("Weekly assessment evidence exceeds its reporting limit.");
  } while (cursor);
  return result;
}
