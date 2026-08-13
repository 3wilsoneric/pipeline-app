export type ResidentLinkStatus = "candidate" | "confirmed" | "rejected";
export type ResidentLinkMatchMethod = "resident_number_exact" | "manual" | "imported";

export type ResidentLinkActor = {
  id: string;
  name: string;
};

export type ResidentLinkAuditEvent = {
  event_id: string;
  link_id: string;
  action: "resident_link_created" | "resident_link_confirmed" | "resident_link_rejected";
  actor_id: string;
  actor_name: string;
  from_status: ResidentLinkStatus | null;
  to_status: ResidentLinkStatus;
  created_at: string;
};

export type PipelineResidentLink = {
  link_id: string;
  person_id: string;
  pipeline_client_id: string;
  referral_id: number | null;
  resident_key: string;
  resident_number: string | null;
  community_id: string;
  status: ResidentLinkStatus;
  match_method: ResidentLinkMatchMethod;
  match_confidence: number | null;
  version: number;
  created_by: ResidentLinkActor;
  reviewed_by: ResidentLinkActor | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  updated_at: string;
  audit_events: ResidentLinkAuditEvent[];
};

export type ResidentLinkCreateInput = {
  pipeline_client_id: string;
  display_name: string;
  date_of_birth?: string | null;
  referral_id?: number | null;
  resident_key: string;
  resident_number?: string | null;
  community_id: string;
  match_method: ResidentLinkMatchMethod;
  match_confidence?: number | null;
};

export type ResidentLinkReviewInput = {
  action: "confirm" | "reject";
  review_note?: string | null;
};

export type ResidentLinkListResponse = {
  links: PipelineResidentLink[];
  total: number;
  next_cursor: string | null;
  generated_at: string;
  store: {
    mode: "local_file" | "postgres";
    multi_instance_safe: boolean;
  };
};
