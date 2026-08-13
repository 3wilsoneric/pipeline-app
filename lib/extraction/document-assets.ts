import "server-only";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { isValidHttpByteRange } from "@/lib/extraction/http-byte-range";

type Asset = { container: string; blobKey: string; contentType: string; byteSize?: number };

export type DocumentPreviewPage = {
  page_number: number;
  content_type: string;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  preview_url: string;
  thumbnail_url: string;
};

export type DocumentFileMetadata = {
  document_id: string;
  file_name: string;
  category: string;
  content_type: string;
  byte_size: number;
  processing_status: string;
  preview_status: string;
  malware_scan_status: string;
  page_count: number | null;
  uploaded_at: string;
  updated_at: string;
  pages: DocumentPreviewPage[];
  next_page_after?: number;
};

export async function getDocumentFileMetadata(
  documentId: string,
  options: { afterPage?: number; limit?: number } = {},
): Promise<DocumentFileMetadata | null> {
  if (!isDocumentId(documentId)) return null;
  const afterPage = options.afterPage ?? 0;
  const limit = Math.min(100, Math.max(1, options.limit ?? 24));
  const sql = getPipelineSql();
  const rows = await sql<{
    document_id: string;
    file_name: string;
    category: string;
    content_type: string;
    byte_size: number | string;
    processing_status: string;
    preview_status: string;
    malware_scan_status: string;
    page_count: number | string | null;
    uploaded_at: Date | string;
    updated_at: Date | string;
  }[]>`
    select document_id::text, file_name, category, content_type, byte_size,
      processing_status, preview_status, malware_scan_status, page_count,
      uploaded_at, updated_at
    from pipeline.documents
    where document_id = ${documentId}::uuid and deleted_at is null
    limit 1
  `;
  if (!rows[0]) return null;
  const pageRows = await sql<{
    page_number: number;
    content_type: string;
    byte_size: number | string | null;
    width: number | null;
    height: number | null;
  }[]>`
    select page_number, content_type, byte_size, width, height
    from pipeline.document_preview_pages
    where document_id = ${documentId}::uuid and page_number > ${afterPage}
    order by page_number
    limit ${limit + 1}
  `;
  const visiblePages = pageRows.slice(0, limit);
  const row = rows[0];
  return {
    document_id: row.document_id,
    file_name: row.file_name,
    category: row.category,
    content_type: row.content_type,
    byte_size: Number(row.byte_size),
    processing_status: row.processing_status,
    preview_status: row.preview_status,
    malware_scan_status: row.malware_scan_status,
    page_count: row.page_count === null ? null : Number(row.page_count),
    uploaded_at: toIso(row.uploaded_at),
    updated_at: toIso(row.updated_at),
    pages: visiblePages.map((page) => ({
      page_number: page.page_number,
      content_type: page.content_type,
      byte_size: page.byte_size === null ? null : Number(page.byte_size),
      width: page.width,
      height: page.height,
      preview_url: `/api/files/${documentId}/preview?page=${page.page_number}`,
      thumbnail_url: `/api/files/${documentId}/preview?page=${page.page_number}`,
    })),
    ...(pageRows.length > limit && visiblePages.at(-1)
      ? { next_page_after: visiblePages.at(-1)!.page_number }
      : {}),
  };
}

export async function getDocumentPreviewAsset(documentId: string, pageNumber?: number): Promise<Asset | null> {
  if (!isDocumentId(documentId)) return null;
  const sql = getPipelineSql();
  if (pageNumber !== undefined) {
    const pages = await sql<{
      blob_container: string; blob_key: string; content_type: string; byte_size: number | string | null;
      malware_scan_status: string;
    }[]>`
      select p.blob_container, p.blob_key, p.content_type, p.byte_size, d.malware_scan_status
      from pipeline.document_preview_pages p join pipeline.documents d on d.document_id = p.document_id
      where p.document_id = ${documentId}::uuid and p.page_number = ${pageNumber}
        and d.deleted_at is null limit 1
    `;
    if (!pages[0]) return null;
    requireClean(pages[0].malware_scan_status);
    return {
      container: pages[0].blob_container,
      blobKey: pages[0].blob_key,
      contentType: pages[0].content_type,
      byteSize: pages[0].byte_size === null ? undefined : Number(pages[0].byte_size),
    };
  }
  const rows = await sql<{
    blob_container: string; blob_key: string; content_type: string; byte_size: number | string;
    preview_status: string; preview_blob_key: string | null; preview_content_type: string | null;
    malware_scan_status: string;
  }[]>`
    select blob_container, blob_key, content_type, byte_size, preview_status,
      preview_blob_key, preview_content_type, malware_scan_status
    from pipeline.documents where document_id = ${documentId}::uuid and deleted_at is null limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  requireClean(row.malware_scan_status);
  if (row.preview_status === "ready" && row.preview_blob_key) {
    return {
      container: process.env.AZURE_STORAGE_CONTAINER_ARTIFACTS?.trim() || "artifacts",
      blobKey: row.preview_blob_key,
      contentType: row.preview_content_type ?? "application/pdf",
    };
  }
  if (isBrowserPreviewable(row.content_type)) {
    return { container: row.blob_container, blobKey: row.blob_key, contentType: row.content_type, byteSize: Number(row.byte_size) };
  }
  throw new DocumentProcessingError("preview_not_ready", 409, "A safe preview is not ready yet.");
}

export async function getFieldEvidenceAsset(packetId: string, fieldKey: string): Promise<Asset | null> {
  if (!isDocumentId(packetId) || !fieldKey || fieldKey.length > 160) return null;
  const sql = getPipelineSql();
  const rows = await sql<{ evidence_blob_key: string; malware_scan_status: string }[]>`
    select rf.evidence_blob_key, d.malware_scan_status
    from pipeline.packet_upload_files pf
    join pipeline.documents d on d.document_id = pf.document_id
    join pipeline.referral_fields rf on rf.source_document_id = d.document_id
    where pf.packet_id = ${packetId}::uuid
      and (rf.field_key = ${fieldKey} or rf.referral_field_id::text = ${fieldKey})
      and rf.evidence_blob_key is not null and d.deleted_at is null
    limit 1
  `;
  if (!rows[0]) return null;
  requireClean(rows[0].malware_scan_status);
  return {
    container: process.env.AZURE_STORAGE_CONTAINER_EVIDENCE?.trim() || "evidence",
    blobKey: rows[0].evidence_blob_key,
    contentType: "image/png",
  };
}

export async function proxyDocumentAsset(request: Request, asset: Asset) {
  const maximumBytes = maxAssetBytes();
  if (asset.byteSize !== undefined && asset.byteSize > maximumBytes) {
    return Response.json({ error: "Preview exceeds the display size limit. Use page previews instead." }, { status: 413 });
  }
  const signer = getAzureBlobUploadSigner();
  const url = await signer.createReadUrl(asset.container, asset.blobKey, 300);
  const range = request.headers.get("range");
  if (range && !isValidHttpByteRange(range)) {
    return Response.json({ error: "Invalid byte range." }, { status: 416 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: range ? { Range: range } : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    throw new DocumentProcessingError("asset_storage_unavailable", 503, "The preview is temporarily unavailable.");
  } finally {
    clearTimeout(timeout);
  }
  if (upstream.status === 404) return Response.json({ error: "Preview not found." }, { status: 404 });
  if (!upstream.ok && upstream.status !== 206) throw new DocumentProcessingError("asset_storage_failed", 502, "The preview could not be loaded.");
  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    return Response.json({ error: "Preview exceeds the display size limit. Use page previews instead." }, { status: 413 });
  }
  const headers = new Headers({
    "Content-Type": asset.contentType,
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Frame-Options": "SAMEORIGIN",
  });
  for (const name of ["content-length", "content-range", "accept-ranges", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(boundedBody(upstream.body, maximumBytes), { status: upstream.status, headers });
}

function requireClean(value: string) {
  if (value === "infected") throw new DocumentProcessingError("malware_detected", 410, "This file is unavailable.");
  if (value !== "clean") throw new DocumentProcessingError("malware_scan_pending", 409, "The file safety scan is not complete.");
}

function isBrowserPreviewable(contentType: string) {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

function maxAssetBytes() {
  const parsed = Number.parseInt(process.env.PIPELINE_PREVIEW_MAX_BYTES ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(100 * 1024 * 1024, Math.max(1024 * 1024, parsed)) : 25 * 1024 * 1024;
}

function boundedBody(body: ReadableStream<Uint8Array> | null, maximumBytes: number) {
  if (!body) return null;
  const reader = body.getReader();
  let bytesRead = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          return;
        }
        bytesRead += result.value.byteLength;
        if (bytesRead > maximumBytes) {
          await reader.cancel("preview_size_limit");
          controller.error(new Error("Preview exceeded the response limit."));
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function isDocumentId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
