import type { AssessmentScheduleStatus, AssessmentWorkflowStatus } from "@/lib/assessment/assessment-records";
import type { ReferralWorkflowStatus } from "@/lib/pipeline/referral-types";

export type PipelineCalendarEventKind = "referral_assigned" | "assessment" | "follow_up";

export type PipelineCalendarEventStatus = AssessmentWorkflowStatus | "assigned" | "overdue" | "due";

export type PipelineCalendarEvent = {
  id: string;
  referralId: number;
  assessmentId?: string;
  assessmentVersion?: number;
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
  scheduleStatus?: AssessmentScheduleStatus;
  followUpCount?: number;
  followUpLabels?: string[];
  kind: PipelineCalendarEventKind;
  status: PipelineCalendarEventStatus;
  title: string;
  detail: string;
};

export type PipelineUnscheduledAssessment = {
  referralId: number;
  assessmentId?: string;
  assessmentVersion?: number;
  clientName: string;
  community: string;
  ownerId?: string;
  owner: string;
  receivedDate: string;
  workflowStatus: ReferralWorkflowStatus;
  nextAction: "assign" | "complete_intake" | "schedule";
};

export type PipelineCalendarResponse = {
  from: string;
  to: string;
  events: PipelineCalendarEvent[];
  unscheduled: PipelineUnscheduledAssessment[];
  unscheduledTotal: number;
  unscheduledHasMore: boolean;
  assessors: Array<{ id?: string; name: string }>;
  scope: "personal" | "team";
  timezone: "America/Los_Angeles";
  viewer: { id: string; name: string };
  generated_at: string;
};
