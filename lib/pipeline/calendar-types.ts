import type { AssessmentWorkflowStatus } from "@/lib/assessment/assessment-records";
import type { ReferralWorkflowStatus } from "@/lib/pipeline/referral-types";

export type PipelineCalendarEventKind = "referral_assigned" | "assessment" | "follow_up";

export type PipelineCalendarEventStatus = AssessmentWorkflowStatus | "assigned" | "overdue" | "due";

export type PipelineCalendarEvent = {
  id: string;
  referralId: number;
  assessmentId?: string;
  clientName: string;
  community: string;
  ownerId?: string;
  owner: string;
  date: string;
  createdDate?: string;
  receivedDate?: string;
  assignedAt?: string;
  startsAt?: string;
  durationMinutes?: number;
  method?: string;
  location?: string;
  kind: PipelineCalendarEventKind;
  status: PipelineCalendarEventStatus;
  title: string;
  detail: string;
};

export type PipelineUnscheduledAssessment = {
  referralId: number;
  clientName: string;
  community: string;
  ownerId?: string;
  owner: string;
  receivedDate: string;
  workflowStatus: ReferralWorkflowStatus;
};

export type PipelineCalendarResponse = {
  from: string;
  to: string;
  events: PipelineCalendarEvent[];
  unscheduled: PipelineUnscheduledAssessment[];
  unscheduledTotal: number;
  scope: "personal" | "team";
  viewer: { id: string; name: string };
  generated_at: string;
};
