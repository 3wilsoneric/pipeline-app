export type PipelineCalendarEventKind = "referral" | "assessment" | "admission" | "requirement";

export type PipelineCalendarEvent = {
  id: string;
  referralId: number;
  clientName: string;
  community: string;
  owner: string;
  date: string;
  kind: PipelineCalendarEventKind;
  title: string;
  detail: string;
};
