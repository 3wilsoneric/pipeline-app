import type { PipelineCalendarEvent, PipelineUnscheduledAssessment } from "@/lib/pipeline/calendar-types";
import type { HomeWorkflowSummary, MyQueueItem } from "@/lib/pipeline/operations-types";

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
  unavailable_sections: Array<"current_work" | "upcoming" | "workflow">;
};
