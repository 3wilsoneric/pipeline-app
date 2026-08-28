import { createHash } from "node:crypto";
import path from "node:path";

export const importConfirmation = "IMPORT-ALLO-MATERIAL-WORKSPACES";
export const uploadConfirmation = "UPLOAD-ALLO-MATERIALS";
export const scanConfirmation = "SCAN-ALLO-MATERIALS";
export const publishScannedManifestConfirmation = "PUBLISH-SCANNED-ALLO-MANIFEST";

export function stableBlobKey(workspaceId, itemId, fileName) {
  const workspaceKey = digest(workspaceId);
  const itemKey = digest(itemId);
  const extension = safeExtension(fileName);
  return `allo-import/v1/workspaces/${workspaceKey}/${itemKey}/original${extension}`;
}

export function cloudManifest(localManifest, containerName) {
  validateLocalManifest(localManifest);
  return {
    version: 1,
    data_class: "user_supplied_real",
    source_system: "allo",
    workspace_count: localManifest.workspace_count,
    material_count: localManifest.material_count,
    available_file_count: localManifest.available_file_count,
    missing_file_count: localManifest.missing_file_count,
    workspaces: localManifest.workspaces.map((workspace) => ({
      source_workspace_id: workspace.source_workspace_id,
      source_workspace_name: workspace.source_workspace_name,
      project_id: workspace.project_id,
      project_name: workspace.project_name,
      community: workspace.community,
      display_name: workspace.display_name,
      primary_owner: workspace.primary_owner,
      owner_candidates: workspace.owner_candidates,
      profile_candidates: workspace.profile_candidates,
      material_count: workspace.material_count,
      available_file_count: workspace.available_file_count,
      missing_file_count: workspace.missing_file_count,
      first_material_at: workspace.first_material_at,
      files: workspace.files.filter((file) => file.source_available).map((file) => ({
        source_item_id: file.source_item_id,
        source_file_name: file.source_file_name,
        source_content_type: file.source_content_type,
        source_byte_size: file.source_byte_size,
        source_sha256: file.source_sha256,
        source_created_at: file.source_created_at,
        source_page: file.source_page,
        source_page_title: file.source_page_title,
        source_file_category: file.source_file_category,
        document_category: file.document_category,
        blob_container: containerName,
        blob_key: stableBlobKey(workspace.source_workspace_id, file.source_item_id, file.source_file_name),
      })),
    })),
  };
}

export function validateLocalManifest(value) {
  validateManifestEnvelope(value);
  for (const workspace of value.workspaces) {
    validateWorkspace(workspace);
    for (const file of workspace.files) {
      validateFile(file, false);
      if (file.source_available && (!path.isAbsolute(file.source_path ?? "") || !file.source_path)) {
        throw new Error("available_source_path_invalid");
      }
    }
  }
}

export function validateCloudManifest(value) {
  validateManifestEnvelope(value);
  for (const workspace of value.workspaces) {
    validateWorkspace(workspace);
    for (const file of workspace.files) {
      validateFile(file, true);
      if (!safeText(file.blob_container, 63) || !safeText(file.blob_key, 1024)) {
        throw new Error("blob_locator_invalid");
      }
    }
  }
  if (value.malware_scan !== undefined) validateMalwareScan(value);
}

export function hasVerifiedCleanScan(value) {
  try {
    validateMalwareScan(value);
    return true;
  } catch {
    return false;
  }
}

export function manifestBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function classifySourceRevision(previous, incoming) {
  const sameItem = String(previous.source_item_id) === String(incoming.source_item_id);
  const sameDigest = String(previous.source_sha256) === String(incoming.source_sha256);
  if (sameItem && sameDigest) return "unchanged";
  if (sameItem) return "source_revision_review";
  if (sameDigest) return "duplicate_content_review";
  return "distinct_source_item";
}

export function isPinnedManifestCurrent(expectedManifestSha256, currentManifest) {
  return /^[a-f0-9]{64}$/.test(String(expectedManifestSha256))
    && sha256(manifestBytes(currentManifest)) === expectedManifestSha256;
}

function validateManifestEnvelope(value) {
  if (value?.version !== 1 || value?.data_class !== "user_supplied_real" || value?.source_system !== "allo") {
    throw new Error("manifest_invalid");
  }
  if (!Array.isArray(value.workspaces) || value.workspaces.length < 1 || value.workspaces.length > 20_000) {
    throw new Error("workspace_count_invalid");
  }
  if (Number(value.workspace_count) !== value.workspaces.length) throw new Error("workspace_count_mismatch");
}

function validateWorkspace(workspace) {
  if (!safeText(workspace?.source_workspace_id, 256) || !safeText(workspace?.source_workspace_name, 500)
    || !safeText(workspace?.display_name, 300) || !Array.isArray(workspace.files)) {
    throw new Error("workspace_invalid");
  }
  if (!Number.isSafeInteger(workspace.material_count) || workspace.material_count < workspace.files.length) {
    throw new Error("workspace_material_count_invalid");
  }
}

function validateFile(file, requireHash) {
  if (!safeText(file?.source_item_id, 512) || !safeText(file?.source_file_name, 1000)
    || !safeText(file?.source_content_type, 255)
    || !Number.isSafeInteger(file?.source_byte_size) || file.source_byte_size < 1 || file.source_byte_size > 500 * 1024 * 1024) {
    throw new Error("material_invalid");
  }
  if (requireHash && !/^[a-f0-9]{64}$/.test(file?.source_sha256 ?? "")) throw new Error("material_digest_invalid");
  if (!requireHash && file?.source_sha256 && !/^[a-f0-9]{64}$/.test(file.source_sha256)) throw new Error("material_digest_invalid");
}

function validateMalwareScan(value) {
  const scan = value?.malware_scan;
  if (scan?.status !== "clean" || scan?.scanner !== "ClamAV"
    || !safeText(scan.scanner_version, 200) || !safeText(scan.scanned_at, 64)
    || !/^[a-f0-9]{64}$/.test(scan.base_manifest_sha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(scan.local_manifest_sha256 ?? "")) {
    throw new Error("malware_scan_attestation_invalid");
  }
  if (!Number.isSafeInteger(scan.file_count) || scan.file_count !== value.available_file_count) {
    throw new Error("malware_scan_file_count_mismatch");
  }
  const totalBytes = value.workspaces.reduce(
    (sum, workspace) => sum + workspace.files.reduce((fileSum, file) => fileSum + file.source_byte_size, 0),
    0,
  );
  if (!Number.isSafeInteger(scan.total_bytes) || scan.total_bytes !== totalBytes) {
    throw new Error("malware_scan_byte_count_mismatch");
  }
  const baseManifest = { ...value };
  delete baseManifest.malware_scan;
  if (sha256(manifestBytes(baseManifest)) !== scan.base_manifest_sha256) {
    throw new Error("malware_scan_manifest_mismatch");
  }
  if (!Number.isFinite(Date.parse(scan.scanned_at))) throw new Error("malware_scan_timestamp_invalid");
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeExtension(fileName) {
  const extension = path.extname(String(fileName)).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ".bin";
}

function safeText(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}
