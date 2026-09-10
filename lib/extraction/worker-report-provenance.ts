import { DocumentProcessingError } from "@/lib/extraction/document-processing-error";
import type { ExtractionFieldInput, WorkerReport } from "@/lib/extraction/worker-report-validation";

type Artifact = NonNullable<WorkerReport["artifacts"]>[number];

export function toPreviewPageRows(pages: NonNullable<NonNullable<WorkerReport["preview"]>["pages"]>) {
  return pages.map((page) => ({
    page_number: page.page_number,
    blob_container: page.blob_container,
    blob_key: page.blob_key,
    content_type: page.content_type,
    byte_size: page.byte_size ?? null,
    width: page.width ?? null,
    height: page.height ?? null,
  }));
}

export function toArtifactRows(artifacts: Artifact[]) {
  return artifacts.map((artifact) => ({
    artifact_kind: artifact.kind,
    blob_container: artifact.blob_container,
    blob_key: artifact.blob_key,
    content_type: artifact.content_type ?? null,
    byte_size: artifact.byte_size ?? null,
  }));
}

export function toExtractedFieldRows(fields: ExtractionFieldInput[]) {
  return fields.map((field) => ({
    field_key: field.field_key,
    proposed_value: field.proposed_value ?? null,
    confidence: field.confidence,
    source_page: field.source_page ?? null,
    evidence_blob_key: field.evidence_blob_key ?? null,
    evidence_bbox: field.evidence_bbox ?? null,
  }));
}

export function toCandidateRows(fields: ExtractionFieldInput[], fieldIdByKey: ReadonlyMap<string, string>) {
  return fields.flatMap((field) => {
    const referralFieldId = fieldIdByKey.get(field.field_key);
    if (!referralFieldId) throw new DocumentProcessingError("field_upsert_failed", 503);
    return (field.candidates ?? []).map((candidate) => ({
      referral_field_id: referralFieldId,
      source: candidate.source,
      candidate_value: candidate.value ?? null,
      confidence: candidate.confidence,
      source_page: candidate.source_page ?? null,
      evidence_blob_key: candidate.evidence_blob_key ?? null,
      evidence_bbox: candidate.evidence_bbox ?? null,
    }));
  });
}

export function collectReportedArtifacts(input: WorkerReport, evidenceContainer: string) {
  const byLocation = new Map<string, Artifact>();
  const add = (artifact: Artifact) => byLocation.set(`${artifact.blob_container}/${artifact.blob_key}`, artifact);
  input.artifacts?.forEach(add);
  if (input.preview) {
    add({ kind: "preview", blob_container: input.preview.blob_container, blob_key: input.preview.blob_key, content_type: input.preview.content_type });
    input.preview.pages?.forEach((page) => add({
      kind: "preview",
      blob_container: page.blob_container,
      blob_key: page.blob_key,
      content_type: page.content_type,
      byte_size: page.byte_size,
    }));
  }
  for (const field of input.fields ?? []) {
    if (field.evidence_blob_key) add({ kind: "evidence", blob_container: evidenceContainer, blob_key: field.evidence_blob_key });
    for (const candidate of field.candidates ?? []) {
      if (candidate.evidence_blob_key) add({ kind: "evidence", blob_container: evidenceContainer, blob_key: candidate.evidence_blob_key });
    }
  }
  return [...byLocation.values()];
}
