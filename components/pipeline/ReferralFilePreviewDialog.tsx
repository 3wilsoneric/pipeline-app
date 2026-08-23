"use client";

import Image from "next/image";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ReferralFile } from "@/lib/pipeline/referral-types";

type FilePreviewMetadata = {
  category: string;
  byte_size: number;
  malware_scan_status: string;
  page_count: number | null;
  pages: Array<{
    page_number: number;
    byte_size: number | null;
    preview_url: string;
    thumbnail_url: string;
  }>;
  next_page_after?: number;
};

export default function ReferralFilePreviewDialog({ file, onClose }: { file: ReferralFile; onClose: () => void }) {
  const isLocalPacket = file.id.startsWith("referral-") && Boolean(file.previewUrl);
  const [metadata, setMetadata] = useState<FilePreviewMetadata | null>(null);
  const [cursorHistory, setCursorHistory] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!isLocalPacket);
  const afterPage = cursorHistory[pageIndex] ?? 0;

  useEffect(() => {
    if (isLocalPacket) return;
    const controller = new AbortController();
    fetchPipelineJson<{ file?: FilePreviewMetadata }>(
      `/api/files/${encodeURIComponent(file.id)}?after_page=${afterPage}&limit=24`,
      { cache: "no-store", signal: controller.signal },
    ).then((payload) => {
      if (!payload.file) throw new Error("File metadata was not returned.");
      setMetadata(payload.file);
    }).catch((loadError) => {
      if (controller.signal.aborted) return;
      setMetadata(null);
      setError(loadError instanceof Error ? loadError.message : "The file preview could not be loaded.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [afterPage, file.id, isLocalPacket]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const showPagination = Boolean(metadata && (pageIndex > 0 || metadata.next_page_after !== undefined));
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-stretch justify-end bg-black/25" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}>
      <button type="button" aria-label="Close file preview" onClick={onClose} className="absolute inset-0 cursor-default" />
      <section className="relative flex h-full w-full max-w-[920px] flex-col bg-white shadow-2xl">
        <header className="flex min-h-20 items-center gap-4 border-b border-[#d9d9d9] px-5 py-3">
          <FileText size={20} className="shrink-0 text-[#0f8b73]" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-black text-[#111111]">{file.name}</h2>
            <p className="mt-1 text-[11px] text-[#737373]">{previewDetail(file, metadata, isLocalPacket)}</p>
          </div>
          {file.downloadUrl || file.previewUrl ? (
            <a href={file.downloadUrl ?? file.previewUrl} target="_blank" rel="noreferrer" className="h-9 border border-[#0f8b73] px-3 py-2 text-[10px] font-black text-[#0f8b73] hover:bg-[#effaf5]">
              Open original
            </a>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close preview" title="Close preview" className="flex h-9 w-9 items-center justify-center border border-[#d9d9d9] hover:border-[#111111]">
            <X size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f8f7] p-5">
          <PreviewBody file={file} metadata={metadata} isLocalPacket={isLocalPacket} loading={loading} error={error} />
        </div>

        {showPagination && metadata ? (
          <footer className="flex items-center justify-between border-t border-[#d9d9d9] bg-white px-5 py-3">
            <button
              type="button"
              disabled={pageIndex === 0}
              onClick={() => {
                setLoading(true);
                setError("");
                changePage(setMetadata, setPageIndex, -1);
              }}
              className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]"
            >
              Previous pages
            </button>
            <span className="text-[11px] text-[#737373]">Pages {afterPage + 1}-{metadata.pages.at(-1)?.page_number ?? afterPage}</span>
            <button
              type="button"
              disabled={metadata.next_page_after === undefined}
              onClick={() => {
                if (metadata.next_page_after === undefined) return;
                setLoading(true);
                setError("");
                setMetadata(null);
                setCursorHistory((values) => [...values.slice(0, pageIndex + 1), metadata.next_page_after!]);
                setPageIndex((index) => index + 1);
              }}
              className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]"
            >
              Next pages
            </button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function PreviewBody({
  file,
  metadata,
  isLocalPacket,
  loading,
  error,
}: {
  file: ReferralFile;
  metadata: FilePreviewMetadata | null;
  isLocalPacket: boolean;
  loading: boolean;
  error: string;
}) {
  if (isLocalPacket && file.previewUrl) {
    return <iframe src={file.previewUrl} title={`Preview ${file.name}`} className="h-full min-h-[640px] w-full border-0 bg-white" />;
  }
  if (loading) return <div className="py-20 text-center text-[13px] font-black text-[#737373]">Loading page previews</div>;
  if (error) return <div className="border-l-2 border-[#a63d2f] bg-white px-4 py-3 text-[12px] font-semibold text-[#59332d]" role="alert">{error}</div>;
  if (metadata?.pages.length) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {metadata.pages.map((page) => (
          <a key={page.page_number} href={page.preview_url} target="_blank" rel="noreferrer" className="group bg-white shadow-sm hover:shadow-md">
            <div className="relative aspect-[8.5/11] overflow-hidden border border-[#d9d9d9] bg-white">
              <Image src={page.thumbnail_url} alt={`Page ${page.page_number}`} fill unoptimized sizes="(max-width: 640px) 90vw, 280px" className="object-contain" />
            </div>
            <div className="flex items-center justify-between px-3 py-2 text-[11px]">
              <span className="font-black text-[#111111]">Page {page.page_number}</span>
              <span className="text-[#737373]">{page.byte_size === null ? "Preview" : formatFileSize(page.byte_size)}</span>
            </div>
          </a>
        ))}
      </div>
    );
  }
  const scanPending = metadata?.malware_scan_status === "pending";
  return (
    <div className="bg-white px-5 py-16 text-center">
      <div className="text-[14px] font-black text-[#111111]">{scanPending ? "Safety scan pending" : "Page previews are not ready yet"}</div>
      <p className="mt-2 text-[12px] text-[#737373]">
        {scanPending
          ? "Pipeline will not display uploaded bytes until the file passes its safety scan. The client workspace and metadata remain available."
          : "Safety scanning and page rendering finish separately from the upload."}
      </p>
    </div>
  );
}

function previewDetail(file: ReferralFile, metadata: FilePreviewMetadata | null, isLocalPacket: boolean) {
  if (isLocalPacket) return `${file.category} · ${file.sizeBytes === undefined ? "Size unavailable" : formatFileSize(file.sizeBytes)}`;
  if (!metadata) return `${file.category} · Loading metadata`;
  const pages = metadata.page_count ?? metadata.pages.length;
  return `${formatDocumentCategory(metadata.category)} · ${formatFileSize(metadata.byte_size)} · ${pages} page${pages === 1 ? "" : "s"}`;
}

function changePage(
  setMetadata: (value: FilePreviewMetadata | null) => void,
  setPageIndex: Dispatch<SetStateAction<number>>,
  delta: number,
) {
  setMetadata(null);
  setPageIndex((index) => Math.max(0, index + delta));
}

function formatDocumentCategory(value: string) {
  return value.split("_").filter(Boolean).map((word) => word === "lic" ? "LIC" : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}
