import type { Priority, ReferralWorkflowStatus, WorkspaceStatus } from "@/lib/pipeline/referral-types";

export const workspaceActivityScopes = ["attention", "mine", "assigned", "team"] as const;

export type WorkspaceActivityScope = (typeof workspaceActivityScopes)[number];

export type WorkspaceActivityAttention = {
  level: "urgent" | "attention" | "review";
  label: string;
};

export type WorkspaceActivityItem = {
  event_id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  created_at: string;
  workspace: {
    referral_id: number;
    client_name: string;
    community: string;
    owner_id: string | null;
    owner: string;
    workflow_status: ReferralWorkflowStatus;
    priority: Priority;
    workspace_status: WorkspaceStatus;
  };
  attention: WorkspaceActivityAttention | null;
};

export type WorkspaceActivityResponse = {
  generated_at: string;
  scope: WorkspaceActivityScope;
  can_view_team: boolean;
  items: WorkspaceActivityItem[];
  next_cursor?: string;
};
