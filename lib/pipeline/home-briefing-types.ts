import type { PipelineCalendarEvent, PipelineUnscheduledAssessment } from "@/lib/pipeline/calendar-types";
import type { MyQueueItem } from "@/lib/pipeline/operations-types";

export type HomeBriefingActivityItem = {
  id: string;
  referral_id: number;
  client_name: string;
  community: string;
  actor_name: string;
  action: string;
  label: string;
  occurred_at: string;
};

export type HomeBriefingSnapshot = {
  generated_at: string;
  scope: "personal" | "team";
  viewer: {
    id: string;
    name: string;
  };
  activity: HomeBriefingActivityItem[];
  activity_truncated: boolean;
  current_work: {
    total: number;
    items: MyQueueItem[];
  };
  upcoming: PipelineCalendarEvent[];
  unscheduled: PipelineUnscheduledAssessment[];
  unscheduled_total: number;
  unavailable_sections: Array<"activity" | "current_work" | "upcoming">;
};
