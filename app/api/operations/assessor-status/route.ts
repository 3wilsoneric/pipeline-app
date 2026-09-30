import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { withApiLogging } from "@/lib/observability/api-logging";
import { canAccessApplicationActivity } from "@/lib/pipeline/application-activity-access";
import { listWorkspaceMembers } from "@/lib/pipeline/workspace-members";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/assessor-status", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    if (!canAccessApplicationActivity(auth.user)) return Response.json({ error: "Team activity is private to Eric." }, { status: 403 });

    const since = new URL(request.url).searchParams.get("since") ?? "";
    const sinceTime = Date.parse(since);
    if (!Number.isFinite(sinceTime) || sinceTime > Date.now() || sinceTime < Date.now() - 26 * 60 * 60_000) {
      return Response.json({ error: "Choose the start of today in your time zone." }, { status: 400 });
    }

    const members = (await listWorkspaceMembers(auth.user)).filter((member) =>
      member.identity_status !== "merged" && !member.merged_into_principal_id
      && (member.roles.includes("reviewer") || member.roles.includes("admin")));
    const signedInToday = new Set<string>();
    if (getPipelineDatabaseReadiness().ready) {
      const sql = getPipelineSql();
      const rows = await sql<{ actor_id: string }[]>`
        select distinct actor_id from pipeline.audit_events
        where created_at >= ${since}::timestamptz
          and created_at <= now()
          and entity_type = 'auth_session' and action = 'signed_in'
      `;
      for (const row of rows) signedInToday.add(row.actor_id);
    }
    const now = Date.now();
    const people = members.map((member) => {
      const lastSeen = member.last_seen_at ? Date.parse(member.last_seen_at) : Number.NaN;
      return {
        id: member.principal_id,
        name: member.profile.preferred_name || member.display_name,
        status: lastSeen >= now - 90_000 ? "online" : signedInToday.has(member.principal_id) ? "today" : "away",
      };
    });
    return Response.json({ people }, {
      headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
    });
  });
}
