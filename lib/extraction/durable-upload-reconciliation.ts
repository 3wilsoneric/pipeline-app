export type DurableUploadReconciliationInput = {
  database_state: "missing" | "reserved" | "finalized";
  blob_state: "missing" | "present" | "size_mismatch" | "unavailable";
  reservation_expired: boolean;
  work_expected: boolean;
  active_job_present: boolean;
};

export type DurableUploadRecoveryAction =
  | "await_upload"
  | "retry_storage_check"
  | "retry_finalize"
  | "repair_queue_job"
  | "expire_reservation"
  | "quarantine_mismatch"
  | "orphan_blob_review"
  | "data_loss_incident"
  | "complete";

export function decideDurableUploadRecovery(
  input: DurableUploadReconciliationInput,
): DurableUploadRecoveryAction {
  if (input.database_state === "missing") {
    return input.blob_state === "present" || input.blob_state === "size_mismatch"
      ? "orphan_blob_review"
      : "complete";
  }
  if (input.blob_state === "unavailable") return "retry_storage_check";
  if (input.blob_state === "size_mismatch") return "quarantine_mismatch";
  if (input.database_state === "finalized" && input.blob_state === "missing") {
    return "data_loss_incident";
  }
  if (input.database_state === "reserved" && input.blob_state === "missing") {
    return input.reservation_expired ? "expire_reservation" : "await_upload";
  }
  if (input.database_state === "reserved") return "retry_finalize";
  if (input.work_expected && !input.active_job_present) return "repair_queue_job";
  return "complete";
}
