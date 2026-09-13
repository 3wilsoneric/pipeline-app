"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Download, FileSearch, LoaderCircle, Upload } from "lucide-react";

import { fetchCurrentPipelineUser, fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import {
  contactImportMaxBytes,
  contactImportTemplate,
  type ContactImportPreview,
  type ContactImportResult,
  type ContactImportSummary,
} from "@/lib/pipeline/contact-import";
import { contactDisplayName } from "@/lib/pipeline/contact-types";
import { canAccessOperationsReports } from "@/lib/pipeline/report-access";

export type ContactDirectoryImportProps = {
  roles?: readonly string[];
  className?: string;
  onImported?: (summary: ContactImportSummary) => void;
};

export default function ContactDirectoryImport({ roles, className = "", onImported }: ContactDirectoryImportProps = {}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ContactImportPreview | null>(null);
  const [summary, setSummary] = useState<ContactImportSummary | null>(null);
  const [operation, setOperation] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedRoles, setResolvedRoles] = useState<readonly string[] | null>(null);
  const mutationId = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (roles) return;
    let cancelled = false;
    fetchCurrentPipelineUser().then(({ user }) => {
      if (!cancelled) setResolvedRoles(user.roles);
    }).catch((failure) => {
      if (!cancelled) setError(failure instanceof PipelineApiError ? failure.message : "Directory permissions could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [roles]);

  const effectiveRoles = roles ?? resolvedRoles;
  if (!effectiveRoles) return <p role={error ? "alert" : "status"} className={`bg-white py-4 text-[12px] ${error ? "text-[#a42d2d]" : "text-[#626b65]"}`}>{error ?? "Loading directory..."}</p>;
  if (!canAccessOperationsReports(effectiveRoles)) return null;

  const chooseFile = (selected: File | null) => {
    setPreview(null);
    setSummary(null);
    setError(null);
    setFile(null);
    mutationId.current = null;
    if (!selected) return;
    if (!/\.csv$/iu.test(selected.name)) { setError("Choose a CSV file."); return; }
    if (!selected.size || selected.size > contactImportMaxBytes) { setError("CSV must be non-empty and at most 1 MiB."); return; }
    setFile(selected);
    mutationId.current = crypto.randomUUID();
  };

  const run = async (mode: "preview" | "commit") => {
    if (!file || pending.current || !mutationId.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setOperation(mode);
    setError(null);
    if (mode === "preview") { setSummary(null); setPreview(null); }
    let imported: ContactImportSummary | undefined;
    try {
      if (mode === "preview") {
        const payload = await fetchPipelineJson<{ ok: true; preview: ContactImportPreview }>("/api/contacts/import?mode=preview", {
          method: "POST", headers: { "Content-Type": "text/csv" }, body: file, signal: controller.signal,
        }, { timeoutMs: 60_000 });
        setPreview(payload.preview);
      } else {
        const payload = await fetchPipelineJson<ContactImportResult>("/api/contacts/import?mode=commit", {
          method: "POST", headers: { "Content-Type": "text/csv", "x-client-mutation-id": mutationId.current },
          body: file, signal: controller.signal,
        }, { timeoutMs: 60_000 });
        if (!payload.ok) throw new PipelineApiError(payload.error, payload.status, undefined, payload);
        imported = payload.summary;
        setSummary(payload.summary);
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        const updated = failure instanceof PipelineApiError
          ? (failure.payload as { preview?: ContactImportPreview } | undefined)?.preview
          : undefined;
        if (updated) setPreview(updated);
        setError(failure instanceof PipelineApiError ? failure.message : "The contact import could not be completed.");
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setOperation(null);
    }
    if (imported) onImported?.(imported);
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([contactImportTemplate], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "contact-directory-template.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const buttonClass = "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded border border-[#d8ddda] bg-white px-3 text-[12px] font-semibold text-[#202622] hover:bg-[#f4f6f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16734a] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section aria-labelledby={`${id}-heading`} className={`min-w-0 border-t border-[#e2e6e3] bg-white py-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-[15px] font-bold text-[#151a17]">Contact and facility directory</h2>
        <button type="button" onClick={downloadTemplate} className={buttonClass} title="Download CSV template">
          <Download size={15} aria-hidden="true" /> CSV template
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor={`${id}-file`} className="mb-1.5 block text-[12px] font-semibold text-[#424a45]">Contacts or referral facilities CSV</label>
          <input id={`${id}-file`} type="file" accept=".csv,text/csv" disabled={!!operation}
            aria-describedby={`${id}-limits${error ? ` ${id}-error` : ""}`} aria-invalid={!!error}
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            className="block w-full min-w-0 rounded border border-[#d8ddda] bg-white p-2 text-[12px] text-[#424a45] file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-[#eef2f0] file:px-3 file:py-1 file:text-[12px] file:font-semibold focus-visible:outline-2 focus-visible:outline-[#16734a] disabled:opacity-50" />
        </div>
        <button type="button" className={buttonClass} disabled={!file || !!operation} onClick={() => void run("preview")} title="Preview CSV">
          {operation === "preview" ? <LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> : <FileSearch size={15} aria-hidden="true" />} Preview
        </button>
      </div>
      <p id={`${id}-limits`} className="mt-2 text-[11px] text-[#626b65]">UTF-8 CSV. Maximum 1 MiB / 500 rows. Directory information only; no patient information.</p>
      {error && <p id={`${id}-error`} role="alert" className="mt-3 break-words text-[12px] font-medium text-[#a42d2d]">{error}</p>}
      {preview && !summary && (
        <div className="mt-4 min-w-0">
          <p role="status" className="text-[12px] font-semibold text-[#303a33]">
            {preview.counts.total} rows: {preview.counts.ready} new, {preview.counts.duplicates} skipped duplicates, {preview.counts.invalid} invalid
          </p>
          <div className="mt-3 max-h-64 overflow-auto border-y border-[#e2e6e3]" tabIndex={0} role="region" aria-label="Contact import preview">
            <table className="w-full min-w-[560px] table-fixed text-left text-[12px]">
              <thead className="sticky top-0 bg-[#f4f6f5] text-[#505952]">
                <tr><th scope="col" className="w-14 px-2 py-2">Line</th><th scope="col" className="w-[30%] px-2 py-2">Contact / facility</th><th scope="col" className="w-[25%] px-2 py-2">Phone / email</th><th scope="col" className="px-2 py-2">Validation</th></tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => <tr key={row.row} className="border-t border-[#edf0ee] align-top">
                  <td className="px-2 py-2 text-[#626b65]">{row.row}</td>
                  <td className="break-words px-2 py-2 text-[#202622]">{row.contact ? contactDisplayName(row.contact) : "Invalid row"}
                    {row.contact?.organization && (row.contact.firstName || row.contact.lastName) && <div className="text-[#626b65]">{row.contact.organization}</div>}
                  </td>
                  <td className="break-words px-2 py-2 text-[#505952]">{row.contact?.phone}<div>{row.contact?.email}</div></td>
                  <td className={`break-words px-2 py-2 ${row.status === "invalid" ? "text-[#a42d2d]" : row.status === "ready" ? "text-[#16734a]" : "text-[#626b65]"}`}>
                    <span className="font-semibold">{row.status === "invalid" ? "Invalid" : row.status === "duplicate" ? "Skipped" : "New"}</span><div>{row.message}</div>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {preview.counts.invalid > 0 && <p role="alert" className="mt-2 text-[12px] text-[#a42d2d]">Fix invalid rows and select the corrected file. No entries have been added.</p>}
          <button type="button" className={`${buttonClass} mt-3`} disabled={!!operation || !!preview.counts.invalid || !preview.counts.ready}
            onClick={() => void run("commit")} title="Import new directory entries">
            {operation === "commit" ? <LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
            {operation === "commit" ? "Importing..." : `Import ${preview.counts.ready} new entries`}
          </button>
        </div>
      )}
      {summary && <p role="status" className="mt-4 flex items-start gap-2 text-[12px] font-semibold text-[#16734a]">
        <Check size={16} className="shrink-0" aria-hidden="true" />
        <span>{summary.counts.imported} entries imported. {summary.counts.duplicates} duplicates skipped. Existing entries unchanged.</span>
      </p>}
    </section>
  );
}
