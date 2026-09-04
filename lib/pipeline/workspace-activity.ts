import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { decodeKeysetCursor, encodeKeysetCursor, isAfterDescendingCursor } from "@/lib/pipeline/keyset-cursor";
import { canAccessOperationsReports } from "@/lib/pipeline/report-access";
import { scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { normalizedOwnerAliases, normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import {
  getReferralStoreReadiness,
  listReferrals,
  type ReferralListOptions,
} from "@/lib/pipeline/referral-store";
import type { Priority, Referral, ReferralWorkflowStatus, WorkspaceStatus } from "@/lib/pipeline/referral-types";
import { resolveReferralWorkflowStatus } from "@/lib/pipeline/workflow-status";
import type {
  WorkspaceActivityAttention,
  WorkspaceActivityItem,
  WorkspaceActivityResponse,
  WorkspaceActivityScope,
} from "@/lib/pipeline/workspace-activity-types";

export type WorkspaceActivityOptions = {
  scope?: WorkspaceActivityScope;
  limit?: number;
  cursor?: string;
  since?: string;
};

export class WorkspaceActivityAccessError extends Error {
  constructor() {
    super("Team activity is available only to supervisors.");
    this.name = "WorkspaceActivityAccessError";
  }
}

type WorkspaceActivityRow = {
  audit_event_id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  created_at: Date | string;
  referral_id: number | string;
  display_name: string;
  community: string;
  owner_id: string | null;
  owner_name: string | null;
  workflow_status: ReferralWorkflowStatus | null;
  priority: Priority;
  workspace_status: WorkspaceStatus | null;
};

const attentionWorkflowStatuses = new Set<ReferralWorkflowStatus>([
  "intake_unassigned",
  "intake_documents_needed",
  "profile_incomplete",
  "waiting_for_information",
  "assessment_ready_to_sign",
  "assessment_signed",
  "recommendation_submitted",
  "decision_pending",
]);

export async function listWorkspaceActivity(
  user: PipelineUser,
  options: WorkspaceActivityOptions = {},
): Promise<WorkspaceActivityResponse> {
  const scope = options.scope ?? "attention";
  const canViewTeam = canAccessOperationsReports(user.roles);
  if (scope === "team" && !canViewTeam) throw new WorkspaceActivityAccessError();
  const limit = Math.min(100, Math.max(1, options.limit ?? 40));
  const since = normalizeSince(options.since);
  const result = getReferralStoreReadiness().mode === "postgres"
    ? await listPostgresWorkspaceActivity(user, { scope, limit, cursor: options.cursor, since })
    : await listLocalWorkspaceActivity(user, { scope, limit, cursor: options.cursor, since });
  return {
    generated_at: new Date().toISOString(),
    scope,
    can_view_team: canViewTeam,
    ...result,
  };
}

async function listPostgresWorkspaceActivity(
  user: PipelineUser,
  options: Required<Pick<WorkspaceActivityOptions, "scope" | "limit">> & Pick<WorkspaceActivityOptions, "cursor" | "since">,
): Promise<Pick<WorkspaceActivityResponse, "items" | "next_cursor">> {
  const sql = getPipelineSql();
  const cursor = decodeKeysetCursor(options.cursor);
  const aliases = normalizedOwnerAliases(user);
  const restrictToAssigned = options.scope === "mine" || !canAccessOperationsReports(user.roles);
  const attentionStatuses = [...attentionWorkflowStatuses];
  const rows = await sql<WorkspaceActivityRow[]>`
    with related_events as (
      select ae.*,
        coalesce(
          case
            when ae.entity_type = 'referral' and ae.entity_id ~ '^[0-9]+$'
              then ae.entity_id::bigint
            else null
          end,
          assessment.referral_id,
          work_item.referral_id,
          decision.referral_id
        ) as referral_id
      from pipeline.audit_events ae
      left join pipeline.assessments assessment
        on ae.entity_type = 'assessment' and assessment.assessment_id = ae.entity_id
      left join pipeline.work_items work_item
        on ae.entity_type = 'work_item' and work_item.work_item_id::text = ae.entity_id
      left join pipeline.admission_decisions decision
        on ae.entity_type = 'admission_decision' and decision.decision_id::text = ae.entity_id
      where ae.entity_type in ('referral', 'assessment', 'work_item', 'admission_decision')
        and (${options.since ?? null}::timestamptz is null or ae.created_at >= ${options.since ?? null}::timestamptz)
    )
    select event.audit_event_id, event.action, event.actor_id, event.actor_name,
      event.created_at, referral.referral_id, person.display_name, referral.community,
      referral.owner_id, referral.owner_name, referral.workflow_status,
      referral.priority, referral.workspace_status
    from related_events event
    join pipeline.referrals referral on referral.referral_id = event.referral_id
    join pipeline.people person on person.person_id = referral.person_id
    where referral.deleted_at is null
      and referral.workspace_status = 'active'
      and (
        ${restrictToAssigned} = false
        or referral.owner_id = ${user.id}
        or (referral.owner_id is null and lower(trim(coalesce(referral.owner_name, ''))) = any(${aliases}::text[]))
      )
      and (
        ${options.scope === "attention"} = false
        or referral.priority in ('urgent', 'high')
        or referral.workflow_status = any(${attentionStatuses}::text[])
        or lower(coalesce(nullif(trim(referral.owner_name), ''), 'unassigned')) in ('unassigned', 'unknown', 'pending')
        or coalesce(referral.data->>'packetStatus', '') = 'failed'
      )
      and (
        ${cursor?.timestamp ?? null}::timestamptz is null
        or (event.created_at, event.audit_event_id::text) < (${cursor?.timestamp ?? null}::timestamptz, ${cursor?.key ?? null}::text)
      )
    order by event.created_at desc, event.audit_event_id desc
    limit ${options.limit + 1}
  `;
  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    items: page.map(mapPostgresActivityRow),
    next_cursor: rows.length > options.limit && last
      ? encodeKeysetCursor({ timestamp: toIso(last.created_at), key: last.audit_event_id })
      : undefined,
  };
}

async function listLocalWorkspaceActivity(
  user: PipelineUser,
  options: Required<Pick<WorkspaceActivityOptions, "scope" | "limit">> & Pick<WorkspaceActivityOptions, "cursor" | "since">,
): Promise<Pick<WorkspaceActivityResponse, "items" | "next_cursor">> {
  const requestedOptions: ReferralListOptions = {
    limit: 200,
    sort: "updated_desc",
    workspaceStatus: "active",
    includeTotal: false,
    ...(options.scope === "mine" || !canAccessOperationsReports(user.roles)
      ? { assignedOwnerId: user.id, assignedOwnerNames: normalizedOwnerAliases(user) }
      : {}),
  };
  const result = await listReferrals(scopeReferralListOptions(user, requestedOptions));
  const cursor = decodeKeysetCursor(options.cursor);
  const sinceTime = options.since ? Date.parse(options.since) : null;
  const items = result.referrals
    .flatMap(localActivityItems)
    .filter((item) => options.scope !== "attention" || item.attention)
    .filter((item) => sinceTime === null || Date.parse(item.created_at) >= sinceTime)
    .sort(compareActivityItems)
    .filter((item) => isAfterDescendingCursor(item.created_at, item.event_id, cursor));
  const page = items.slice(0, options.limit);
  const last = page.at(-1);
  return {
    items: page,
    next_cursor: items.length > options.limit && last
      ? encodeKeysetCursor({ timestamp: last.created_at, key: last.event_id })
      : undefined,
  };
}

function localActivityItems(referral: Referral): WorkspaceActivityItem[] {
  const updatedAt = referral.updatedAt ?? referral.createdAt;
  const workspace = workspaceFromReferral(referral);
  const attention = activityAttention({ ...workspace, packetStatus: referral.packetStatus });
  const updatedBy = referral.updatedBy ?? {
    id: referral.ownerId ?? null,
    name: normalizeOwnerName(referral.owner) === "Unassigned" ? "Pipeline user" : normalizeOwnerName(referral.owner),
  };
  const latest: WorkspaceActivityItem = {
    event_id: `workspace-${referral.id}-${referral.version ?? 1}`,
    action: updatedAt === referral.createdAt ? "referral_created" : "referral_updated",
    actor_id: updatedBy.id,
    actor_name: updatedBy.name,
    created_at: updatedAt,
    workspace,
    attention,
  };
  if (updatedAt === referral.createdAt) return [latest];
  return [
    latest,
    {
      event_id: `workspace-${referral.id}-created`,
      action: "referral_created",
      actor_id: null,
      actor_name: "Pipeline user",
      created_at: referral.createdAt,
      workspace,
      attention,
    },
  ];
}

function mapPostgresActivityRow(row: WorkspaceActivityRow): WorkspaceActivityItem {
  const workspace = {
    referral_id: Number(row.referral_id),
    client_name: row.display_name,
    community: row.community,
    owner_id: row.owner_id,
    owner: normalizeOwnerName(row.owner_name),
    workflow_status: row.workflow_status ?? "intake_unassigned",
    priority: row.priority,
    workspace_status: row.workspace_status ?? "active",
  };
  return {
    event_id: row.audit_event_id,
    action: row.action,
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    created_at: toIso(row.created_at),
    workspace,
    attention: activityAttention(workspace),
  };
}

function workspaceFromReferral(referral: Referral): WorkspaceActivityItem["workspace"] {
  return {
    referral_id: referral.id,
    client_name: referral.name,
    community: referral.community,
    owner_id: referral.ownerId ?? null,
    owner: normalizeOwnerName(referral.owner),
    workflow_status: referral.workflowStatus ?? resolveReferralWorkflowStatus(referral),
    priority: referral.priority,
    workspace_status: referral.workspaceStatus ?? "active",
  };
}

export function activityAttention(
  workspace: Pick<WorkspaceActivityItem["workspace"], "owner" | "workflow_status" | "priority"> & { packetStatus?: string },
): WorkspaceActivityAttention | null {
  if (workspace.packetStatus === "failed") return { level: "urgent", label: "Extraction failed" };
  if (workspace.priority === "urgent") return { level: "urgent", label: "Urgent priority" };
  if (normalizeOwnerName(workspace.owner) === "Unassigned" || workspace.workflow_status === "intake_unassigned") {
    return { level: "urgent", label: "Needs assignment" };
  }
  if (["assessment_signed", "recommendation_submitted", "decision_pending"].includes(workspace.workflow_status)) {
    return { level: "attention", label: "Supervisor decision needed" };
  }
  if (workspace.workflow_status === "assessment_ready_to_sign") return { level: "attention", label: "Assessment ready to sign" };
  if (workspace.workflow_status === "waiting_for_information") return { level: "attention", label: "Waiting for information" };
  if (workspace.workflow_status === "intake_documents_needed") return { level: "review", label: "Needs initial documents" };
  if (workspace.workflow_status === "profile_incomplete") return { level: "review", label: "Profile incomplete" };
  if (workspace.priority === "high") return { level: "review", label: "High priority" };
  return null;
}

function compareActivityItems(left: WorkspaceActivityItem, right: WorkspaceActivityItem) {
  return right.created_at.localeCompare(left.created_at) || right.event_id.localeCompare(left.event_id);
}

function normalizeSince(value?: string) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  const earliest = Date.now() - 30 * 24 * 60 * 60 * 1_000;
  return new Date(Math.max(timestamp, earliest)).toISOString();
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
