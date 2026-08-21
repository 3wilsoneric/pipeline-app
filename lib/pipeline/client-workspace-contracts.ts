import type {
  ClinicalClientDirectoryItem,
  ClinicalFreshness,
} from "@/lib/clinical/clinical-contracts";

export type ClientWorkspaceDirectoryItem = ClinicalClientDirectoryItem & {
  workspace_origin: "alamo_platform" | "pipeline";
  pipeline_client_id: string | null;
  referral_count: number;
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
