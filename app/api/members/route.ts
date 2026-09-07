import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { listWorkspaceEditingPresence } from "@/lib/pipeline/editing-presence";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { listAssignableWorkspaceAssessors, listWorkspaceMembers } from "@/lib/pipeline/workspace-members";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/members", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const members = new URL(request.url).searchParams.get("scope") === "assessors"
      ? await listAssignableWorkspaceAssessors(auth.user)
      : await listWorkspaceMembers(auth.user);
    const identity = {
      current_principal_id: auth.user.id,
      authenticated_principal_id: auth.user.delegation?.initiatedBy.id ?? auth.user.id,
    };
    if (new URL(request.url).searchParams.get("presence") !== "1") {
      return Response.json({ members, ...identity }, {
        headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
      });
    }
    const editingPresence = await listWorkspaceEditingPresence();
    const editingByActor = new Map(editingPresence.map((presence) => [presence.actor_id, presence]));
    const onlineCutoff = Date.now() - 90_000;
    const membersWithPresence = members.map((member) => {
      const editing = editingByActor.get(member.principal_id);
      const lastSeenAt = member.last_seen_at ? Date.parse(member.last_seen_at) : Number.NaN;
      return {
        ...member,
        presence_state: editing ? "editing" as const : lastSeenAt >= onlineCutoff ? "online" as const : "offline" as const,
        editing_sections: editing?.sections ?? [],
      };
    });
    return Response.json({
      members: membersWithPresence,
      ...identity,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
    });
  });
}
