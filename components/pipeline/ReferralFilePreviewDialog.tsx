"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { isBrowserPreviewable, isDocumentContentAvailable } from "@/lib/extraction/document-access-policy";
import type { ReferralFile } from "@/lib/pipeline/referral-types";
import { toPipelinePath } from "@/lib/pipeline/base-path";

type FilePreviewMetadata = {
  content_type: string;
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
  const [retryVersion, setRetryVersion] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const afterPage = cursorHistory[pageIndex] ?? 0;

  useEffect(() => {
    if (isLocalPacket) return;
    const controller = new AbortController();
    fetchPipelineJson<{ file?: FilePreviewMetadata }>(
      `/api/files/${encodeURIComponent(file.id)}?after_page=${afterPage}&limit=24`,
      { cache: "no-store", signal: controller.signal },
    ).then((payload) => {
      if (controller.signal.aborted) return;
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
  }, [afterPage, file.id, isLocalPacket, retryVersion]);

  useEffect(() => {
    const current = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    current?.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      current?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const retryPreview = () => {
    setError("");
    setLoading(true);
    setRetryVersion((version) => version + 1);
  };

  const showPagination = Boolean(metadata && (pageIndex > 0 || metadata.next_page_after !== undefined));
  const originalUrl = originalFileUrl(file, metadata);
  return createPortal(
    <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 open:flex items-stretch justify-end backdrop:bg-black/25" aria-label={`Preview ${file.name}`}>
      <button type="button" tabIndex={-1} aria-label="Close file preview" onClick={onClose} className="absolute inset-0 cursor-default" />
      <section className="relative flex h-full w-full max-w-[920px] flex-col bg-white shadow-2xl">
        <header className="flex min-h-20 flex-wrap items-center gap-3 border-b border-[#d9d9d9] px-4 py-3 sm:px-5">
          <FileText size={20} className="shrink-0 text-[#0f8b73]" />
          <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-104px)]">
            <h2 title={file.name} className="truncate text-[15px] font-black text-[#111111]">{file.name}</h2>
            <p className="mt-1 text-[12px] text-[#737373]">{error ? "Preview unavailable" : previewDetail(file, metadata, isLocalPacket)}</p>
          </div>
          {originalUrl ? (
            <a href={originalUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 shrink-0 items-center rounded border border-[#0f8b73] px-3 text-[13px] font-semibold text-[#0f8b73] hover:bg-[#effaf5] max-sm:order-last">
              Open original
            </a>
          ) : null}
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close preview" title="Close preview" className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-[#d9d9d9] hover:border-[#111111] focus-visible:outline-2 focus-visible:outline-[#087d66]">
            <X size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f8f7] p-5">
          <PreviewBody file={file} metadata={metadata} isLocalPacket={isLocalPacket} loading={loading} error={error} onRetry={retryPreview} />
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
              className="min-h-11 px-2 text-[13px] font-semibold text-[#0f8b73] disabled:text-[#737373]"
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
              className="min-h-11 px-2 text-[13px] font-semibold text-[#0f8b73] disabled:text-[#737373]"
            >
              Next pages
            </button>
          </footer>
        ) : null}
      </section>
    </dialog>,
    document.body,
  );
}

function originalFileUrl(file: ReferralFile, metadata: FilePreviewMetadata | null) {
  return file.downloadUrl ?? file.previewUrl
    ?? (isDocumentContentAvailable(metadata?.malware_scan_status) ? toPipelinePath(`/api/files/${file.id}/download`) : undefined);
}

function PreviewBody({
  file,
  metadata,
  isLocalPacket,
  loading,
  error,
  onRetry,
}: {
  file: ReferralFile;
  metadata: FilePreviewMetadata | null;
  isLocalPacket: boolean;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  if (isLocalPacket && file.previewUrl) {
    return <iframe src={file.previewUrl} title={`Preview ${file.name}`} className="h-full min-h-[640px] w-full border-0 bg-white" />;
  }
  if (loading) return <div role="status" className="py-20 text-center text-[13px] font-black text-[#737373]">Loading page previews</div>;
  if (error) return <div className="rounded border border-[#c8d5ce] bg-white p-4 text-sm text-[#253b34]" role="alert">
    <p className="font-semibold">The preview could not be loaded.</p>
    <p className="mt-1">{error}</p>
    <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded border border-[#adbbb3] px-4 font-semibold text-[#08735e]">Retry preview</button>
  </div>;
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
  if (isDocumentContentAvailable(metadata?.malware_scan_status)) {
    return <OriginalFilePreview file={file} metadata={metadata} />;
  }
  return (
    <div className="bg-white px-5 py-16 text-center">
      <div className="text-[14px] font-black text-[#111111]">Page previews are not ready yet</div>
      <p className="mt-2 text-[12px] text-[#737373]">
        Preview preparation runs in the background. You can keep working in the workspace.
      </p>
    </div>
  );
}

function OriginalFilePreview({ file, metadata }: { file: ReferralFile; metadata: FilePreviewMetadata | null }) {
  const contentType = metadata?.content_type ?? file.contentType;
  const previewUrl = file.previewUrl ?? toPipelinePath(`/api/files/${file.id}/preview`);
  if (isBrowserPreviewable(contentType)) {
    if (contentType?.startsWith("image/")) return <Image src={previewUrl} alt={`Preview ${file.name}`} width={1200} height={1600} unoptimized className="h-auto w-full bg-white" />;
    return <iframe src={previewUrl} title={`Preview ${file.name}`} className="h-full min-h-[640px] w-full border-0 bg-white" />;
  }
  return <div className="bg-white px-5 py-16 text-center">
    <div className="text-[14px] font-black text-[#111111]">File saved</div>
    <p className="mt-2 text-[12px] text-[#737373]">This file type opens in its original application.</p>
    <a href={originalFileUrl(file, metadata)} target="_blank" rel="noreferrer" className="mt-4 inline-block font-bold text-[#0f8b73]">Open or download original</a>
  </div>;
}

function previewDetail(file: ReferralFile, metadata: FilePreviewMetadata | null, isLocalPacket: boolean) {
  if (isLocalPacket) return `${file.category} · ${file.sizeBytes === undefined ? "Size unavailable" : formatFileSize(file.sizeBytes)}`;
  if (!metadata) return `${file.category} · Loading metadata`;
  const pages = metadata.page_count ?? metadata.pages.length;
  return `${formatDocumentCategory(metadata.category)} · ${formatFileSize(metadata.byte_size)}${pages ? ` · ${pages} page${pages === 1 ? "" : "s"}` : ""}`;
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
