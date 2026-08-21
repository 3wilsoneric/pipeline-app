export type ClientFileImportReviewItem = {
  import_item_id: string;
  import_batch_id: string;
  source_system: "allo" | "import";
  source_item_id: string;
  source_canvas_id: string | null;
  source_client_name: string;
  source_resident_number: string | null;
  source_date_of_birth: string | null;
  source_community: string | null;
  source_file_name: string;
  source_content_type: string | null;
  source_byte_size: number | null;
  match_status: "unmatched" | "candidate" | "confirmed" | "rejected" | "imported";
  match_method: string | null;
  match_confidence: number | null;
  matched_pipeline_client_id: string | null;
  matched_canonical_client_id: string | null;
  matched_referral_id: number | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ClientFileImportReviewInput = {
  action: "confirm" | "create_client" | "reject";
  if_match: number;
  target_client_id?: string;
  referral_id?: number;
};
