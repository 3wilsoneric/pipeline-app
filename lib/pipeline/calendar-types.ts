import type { AssessmentWorkflowStatus } from "@/lib/assessment/assessment-records";

export type PipelineCalendarEventKind = "assessment" | "follow_up";

export type PipelineCalendarEventStatus = AssessmentWorkflowStatus | "overdue" | "due";

export type PipelineCalendarEvent = {
  id: string;
  referralId: number;
  assessmentId?: string;
  clientName: string;
  community: string;
  ownerId?: string;
  owner: string;
  date: string;
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
};

export type PipelineCalendarResponse = {
  from: string;
  to: string;
  events: PipelineCalendarEvent[];
  unscheduled: PipelineUnscheduledAssessment[];
  unscheduledTotal: number;
  viewer: { id: string; name: string };
  generated_at: string;
};
