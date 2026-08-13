export type ClientHistoryStatus = "available" | "not_found" | "unavailable" | "identity_conflict";

export type ClientHistoryEpisode = {
  community: string;
  admit_date: string;
  discharge_date: string | null;
  resident_status: "Current" | "Discharged";
  discharge_reason: string | null;
  episode_days: number;
  referring_facility: string | null;
  facility_canonical: string | null;
  prior_setting_bucket: string | null;
  primary_diagnosis: string | null;
  secondary_diagnoses: string[];
  conservatorship: string | null;
  substance_use: string[];
  county: string | null;
  quality_flags: string[];
};

export type ClientHistoryProjection = {
  status: ClientHistoryStatus;
  source: "master_client_datasheet" | null;
  data_as_of: string | null;
  imported_at: string | null;
  warning: string;
  episode_count: number;
  current_episode_count: number;
  discharged_episode_count: number;
  first_admit_date: string | null;
  latest_admit_date: string | null;
  quality_flags: string[];
  episodes: ClientHistoryEpisode[];
};
