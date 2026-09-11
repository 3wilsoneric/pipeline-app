import type { PipelineCalendarEvent, PipelineUnscheduledAssessment } from "@/lib/pipeline/calendar-types";
import type { HomeWorkflowSummary, MyQueueItem } from "@/lib/pipeline/operations-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { WorkspaceActivityItem } from "@/lib/pipeline/workspace-activity-types";

export type HomeResumeItem = {
  id: string;
  kind: "new_referral" | "referral_draft" | "assessment_draft" | "last_workspace";
  client_name: string;
  community: string;
  detail: string;
  updated_at: string;
  referral_id?: number;
  draft_key?: `new-${string}`;
  location: PipelineWorkspaceLocation;
  completed_fields?: number;
  total_fields?: number;
};

export type HomeContinuitySnapshot = {
  resume_items: HomeResumeItem[];
  new_assignments: WorkspaceActivityItem[];
  assignment_tracking_started_at: string | null;
  needs_assignment_tracking_initialization: boolean;
  unavailable: boolean;
};

export type HomeBriefingSnapshot = {
  generated_at: string;
  scope: "personal" | "team";
  viewer: {
    id: string;
    name: string;
  };
  current_work: {
    total: number;
    items: MyQueueItem[];
  };
  workflow: HomeWorkflowSummary;
  upcoming: PipelineCalendarEvent[];
  unscheduled: PipelineUnscheduledAssessment[];
  unscheduled_total: number;
  continuity: HomeContinuitySnapshot;
  unavailable_sections: Array<"current_work" | "upcoming" | "workflow">;
};
