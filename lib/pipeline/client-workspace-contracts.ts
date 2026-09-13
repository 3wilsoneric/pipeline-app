import type {
  ClinicalClientDirectoryItem,
  ClinicalFreshness,
  ClinicalResident,
} from "@/lib/clinical/clinical-contracts";

export type ClientWorkspaceDirectoryItem = ClinicalClientDirectoryItem & Partial<Pick<ClinicalResident,
  "date_of_birth" | "age" | "payor" | "primary_diagnosis" | "physician" | "diet" | "length_of_stay_days"
>> & {
  /** Current census locator; never a guessed canonical identity or referral link. */
  profile_key?: string;
  workspace_origin: "alamo_platform" | "pipeline";
  pipeline_client_id: string | null;
  referral_count: number;
  active_referral_count: number;
  historical_workspace_count: number;
  document_count: number;
};

export type ClientWorkspaceDirectoryResponse = {
  clients: ClientWorkspaceDirectoryItem[];
  total: number;
  limit: number;
  next_cursor: string | null;
  query: string;
  community: string | null;
  data_as_of: string;
  freshness: ClinicalFreshness;
  clinical_warning: string | null;
};
