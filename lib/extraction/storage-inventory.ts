import "server-only";

import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";

type StorageInventoryRow = {
  active_documents: number | string;
  deleted_documents: number | string;
  source_bytes: number | string;
  preview_bytes: number | string;
  artifact_bytes: number | string;
  stale_reservations: number | string;
  retention_candidates: number | string;
  processing_counts: Record<string, number | string> | null;
};

export type StorageInventory = {
  available: true;
  generated_at: string;
  documents: {
    active: number;
    deleted: number;
    stale_reservations: number;
    retention_candidates: number;
    by_processing_status: Record<string, number>;
  };
  bytes: {
    source: number;
    preview: number;
    artifacts: number;
    tracked_total: number;
  };
} | {
  available: false;
  generated_at: string;
  reason: "database_unavailable" | "inventory_query_failed";
};

export async function getStorageInventory(): Promise<StorageInventory> {
  const generatedAt = new Date().toISOString();
  if (!getPipelineDatabaseReadiness().ready) {
    return { available: false, generated_at: generatedAt, reason: "database_unavailable" };
  }

  try {
    const sql = getPipelineSql();
    const rows = await sql<StorageInventoryRow[]>`
      with active_documents as (
        select document_id, byte_size, processing_status, retention_until, uploaded_at
        from pipeline.documents
        where deleted_at is null
      ), processing_counts as (
        select processing_status, count(*)::bigint as count
        from active_documents
        group by processing_status
      ), preview_totals as (
        select coalesce(sum(p.byte_size), 0)::bigint as bytes
        from pipeline.document_preview_pages p
        join active_documents d on d.document_id = p.document_id
      ), artifact_totals as (
        select coalesce(sum(a.byte_size), 0)::bigint as bytes
        from pipeline.document_artifacts a
        join active_documents d on d.document_id = a.document_id
      )
      select
        (select count(*)::bigint from active_documents) as active_documents,
        (select count(*)::bigint from pipeline.documents where deleted_at is not null) as deleted_documents,
        (select coalesce(sum(byte_size), 0)::bigint from active_documents) as source_bytes,
        (select bytes from preview_totals) as preview_bytes,
        (select bytes from artifact_totals) as artifact_bytes,
        (select count(*)::bigint from active_documents
          where processing_status = 'reserved' and uploaded_at < now() - interval '24 hours') as stale_reservations,
        (select count(*)::bigint from active_documents
          where retention_until is not null and retention_until < now()) as retention_candidates,
        coalesce((select jsonb_object_agg(processing_status, count) from processing_counts), '{}'::jsonb) as processing_counts
    `;
    const row = rows[0];
    if (!row) throw new Error("storage_inventory_empty");

    const source = safeNumber(row.source_bytes);
    const preview = safeNumber(row.preview_bytes);
    const artifacts = safeNumber(row.artifact_bytes);
    const inventory: StorageInventory = {
      available: true,
      generated_at: generatedAt,
      documents: {
        active: safeNumber(row.active_documents),
        deleted: safeNumber(row.deleted_documents),
        stale_reservations: safeNumber(row.stale_reservations),
        retention_candidates: safeNumber(row.retention_candidates),
        by_processing_status: Object.fromEntries(
          Object.entries(row.processing_counts ?? {}).map(([status, count]) => [status, safeNumber(count)]),
        ),
      },
      bytes: {
        source,
        preview,
        artifacts,
        tracked_total: source + preview + artifacts,
      },
    };
    emitInventoryMetrics(inventory);
    return inventory;
  } catch {
    recordPipelineMetric("pipeline.storage.inventory_failures", 1, "count", {
      operation: "inventory",
      result: "failed",
    });
    return { available: false, generated_at: generatedAt, reason: "inventory_query_failed" };
  }
}

function emitInventoryMetrics(inventory: Extract<StorageInventory, { available: true }>) {
  recordPipelineMetric("pipeline.storage.source_bytes", inventory.bytes.source, "bytes", { operation: "inventory" });
  recordPipelineMetric("pipeline.storage.preview_bytes", inventory.bytes.preview, "bytes", { operation: "inventory" });
  recordPipelineMetric("pipeline.storage.artifact_bytes", inventory.bytes.artifacts, "bytes", { operation: "inventory" });
  recordPipelineMetric("pipeline.storage.documents", inventory.documents.active, "count", {
    operation: "inventory",
    result: "active",
  });
  recordPipelineMetric("pipeline.storage.documents", inventory.documents.stale_reservations, "count", {
    operation: "inventory",
    result: "stale_reservations",
  });
}

function safeNumber(value: number | string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
