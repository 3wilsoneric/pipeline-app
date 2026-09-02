"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Download, FileSpreadsheet } from "lucide-react";

import { fetchPipelineApi, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type {
  OperationsReportColumn,
  OperationsReportFilters,
  OperationsReportId,
  OperationsReportResponse,
  OperationsReportRow,
} from "@/lib/pipeline/operations-report-types";
import type { Referral } from "@/lib/pipeline/referral-types";

export default function OperationsDashboard({
  onOpenPacket,
}: {
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const [filters, setFilters] = useState<OperationsReportFilters>(defaultFilters);
  const [response, setResponse] = useState<OperationsReportResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadReport = useCallback(async (nextFilters: OperationsReportFilters, signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        report_id: nextFilters.report_id,
        month: nextFilters.month,
        ...(nextFilters.community ? { community: nextFilters.community } : {}),
        ...(nextFilters.owner ? { owner: nextFilters.owner } : {}),
      });
      const payload = await fetchPipelineJson<OperationsReportResponse>(`/api/operations/reports?${params}`, {
        cache: "no-store",
        signal,
      });
      setResponse(payload);
      setFilters(payload.filters);
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : "The report could not be loaded.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadReport(defaultFilters(), controller.signal);
    return () => controller.abort();
  }, [loadReport]);

  const selectedDefinition = useMemo(
    () => response?.catalog.find((item) => item.id === filters.report_id) ?? response?.report.definition ?? null,
    [filters.report_id, response],
  );
  const filtersChanged = response ? !sameFilters(filters, response.filters) : false;

  const selectReport = (reportId: OperationsReportId) => {
    const next = { ...filters, report_id: reportId, community: "", owner: "" };
    setFilters(next);
    void loadReport(next);
  };

  const exportReport = async () => {
    if (!response || filtersChanged) return;
    setExporting(true);
    setError("");
    try {
      const exportResponse = await fetchPipelineApi("/api/operations/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response.filters),
      });
      if (!exportResponse.ok) {
        const payload = await exportResponse.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "The export could not be created.");
      }
      const blob = await exportResponse.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(exportResponse, response.filters);
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "The export could not be created.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main aria-label="Reports" className="h-full overflow-y-auto bg-[#fbfcfb] text-[#202320]">
      <div data-testid="operations-workspace" data-guide-target="operations-workspace" className="mx-auto w-full max-w-[1480px] px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <header data-guide-target="operations-summary" className="flex min-h-[62px] flex-wrap items-end justify-between gap-3 border-b border-[#d8dedb] pb-4">
          <div>
            <h1 className="flex items-center gap-2 text-[28px] font-semibold tracking-[-0.035em] sm:text-[32px]">
              <FileSpreadsheet size={24} className="text-[#0f8b73]" /> Reports
            </h1>
            <div className="mt-1 text-[11px] text-[#727a75]">Referral, assessment, decision, and handoff records</div>
          </div>
          {response ? <div className="text-[10px] text-[#727a75]">Updated {formatTime(response.report.generated_at)}</div> : null}
        </header>

        <section className="mt-4 border border-[#d8dedb] bg-white" aria-label="Report controls">
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.3fr)_repeat(3,minmax(170px,0.75fr))_auto_auto] xl:items-end">
            <Control label="Report">
              <select
                data-guide-target="operations-report-select"
                aria-label="Report"
                value={filters.report_id}
                onChange={(event) => selectReport(event.target.value as OperationsReportId)}
                className={selectClass}
              >
                {(response?.catalog ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Control>
            {selectedDefinition?.filters.includes("month") ? (
              <Control label="Month">
                <input
                  data-guide-target="operations-report-month"
                  aria-label="Report month"
                  type="month"
                  value={filters.month}
                  onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))}
                  className={selectClass}
                />
              </Control>
            ) : <ControlSpacer />}
            {selectedDefinition?.filters.includes("community") ? (
              <Control label="Community">
                <select aria-label="Report community" value={filters.community} onChange={(event) => setFilters((current) => ({ ...current, community: event.target.value }))} className={selectClass}>
                  <option value="">All communities</option>
                  {(response?.facets.communities ?? []).map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
                </select>
              </Control>
            ) : <ControlSpacer />}
            {selectedDefinition?.filters.includes("owner") ? (
              <Control label="Owner">
                <select aria-label="Report owner" value={filters.owner} onChange={(event) => setFilters((current) => ({ ...current, owner: event.target.value }))} className={selectClass}>
                  <option value="">All owners</option>
                  {(response?.facets.owners ?? []).map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
                </select>
              </Control>
            ) : <ControlSpacer />}
            <button
              type="button"
              onClick={() => void loadReport(filters)}
              disabled={loading}
              className="h-9 border border-[#0f8b73] bg-[#0f8b73] px-4 text-[11px] font-semibold text-white hover:bg-[#0c745f] disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "Running" : "Run report"}
            </button>
            <button
              type="button"
              data-guide-target="operations-report-export"
              onClick={() => void exportReport()}
              disabled={!response || filtersChanged || exporting}
              className="flex h-9 items-center justify-center gap-2 border border-[#b9c6c1] bg-white px-4 text-[11px] font-semibold text-[#176f60] hover:border-[#0f8b73] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Download size={14} /> {exporting ? "Exporting" : "Export CSV"}
            </button>
          </div>
          {selectedDefinition ? (
            <div className="border-t border-[#e3e7e5] px-4 py-2 text-[11px] text-[#6e746f]">{selectedDefinition.description}</div>
          ) : null}
        </section>

        {error ? (
          <div role="alert" className="mt-4 flex items-center justify-between gap-4 border-l-2 border-[#a9473d] bg-[#fff6f4] px-4 py-3 text-[12px] text-[#723d35]">
            <span>{error}</span>
            <button type="button" onClick={() => void loadReport(filters)} className="font-semibold underline underline-offset-2">Retry</button>
          </div>
        ) : null}

        <section data-guide-target="operations-report-results" className="mt-4 border border-[#d8dedb] bg-white" aria-label="Report results">
          <div className="flex h-11 items-center justify-between gap-3 border-b border-[#d8dedb] px-4 sm:px-5">
            <h2 className="text-[13px] font-semibold">{response?.report.definition.label ?? "Results"}</h2>
            <span className="text-[10px] font-semibold text-[#727a75]">
              {response ? `${response.report.row_count.toLocaleString()} rows${response.report.truncated ? " · preview limited" : ""}` : "Loading"}
            </span>
          </div>
          {loading && !response ? <ReportSkeleton /> : null}
          {response && response.report.rows.length === 0 && !loading ? (
            <div className="px-5 py-16 text-center text-[12px] text-[#727a75]">No records match the selected report and filters.</div>
          ) : null}
          {response && response.report.rows.length > 0 ? (
            <ReportTable
              columns={response.report.columns}
              rows={response.report.rows}
              onOpenPacket={onOpenPacket}
              refreshing={loading}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function ReportTable({
  columns,
  rows,
  onOpenPacket,
  refreshing,
}: {
  columns: OperationsReportColumn[];
  rows: OperationsReportRow[];
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  refreshing: boolean;
}) {
  return (
    <div className={`overflow-x-auto ${refreshing ? "opacity-55" : ""}`}>
      <table className="w-full min-w-[900px] border-collapse text-left">
        <thead>
          <tr className="border-b border-[#d8dedb] bg-[#f7f9f8]">
            {columns.map((column) => (
              <th key={column.key} className={`px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#6f7671] ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>
            ))}
            <th className="w-10 px-2 py-2.5"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e5e9e7]">
          {rows.map((row) => {
            const canOpen = Boolean(row.referral_id && row.client_name && row.community);
            return (
              <tr key={row.row_id} className={canOpen ? "hover:bg-[#f5faf8]" : ""}>
                {columns.map((column) => (
                  <td key={column.key} className={`max-w-[360px] px-4 py-3 text-[11px] text-[#4e5550] ${column.align === "right" ? "text-right tabular-nums" : ""}`}>
                    <span className={column.key === "client" || column.key === "staff" || column.key === "issue" ? "font-semibold text-[#202320]" : ""}>
                      {formatCell(row.values[column.key], column)}
                    </span>
                  </td>
                ))}
                <td className="px-2 py-2 text-right">
                  {canOpen ? (
                    <button
                      type="button"
                      aria-label={`Open ${row.client_name}`}
                      onClick={() => onOpenPacket({ id: row.referral_id!, name: row.client_name!, community: row.community as Referral["community"] })}
                      className="flex h-7 w-7 items-center justify-center text-[#0f8b73] hover:bg-[#e8f5f0]"
                    >
                      <ArrowRight size={14} />
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#6f7671]">{label}{children}</label>;
}

function ControlSpacer() {
  return <div className="hidden xl:block" aria-hidden="true" />;
}

function ReportSkeleton() {
  return (
    <div aria-label="Loading report" aria-busy="true" className="animate-pulse divide-y divide-[#e8ebe9]">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-11 bg-white px-4 py-3"><div className="h-3 w-1/3 bg-[#edf0ee]" /></div>)}
    </div>
  );
}

const selectClass = "h-9 w-full border border-[#c7cfcb] bg-white px-2.5 text-[11px] font-semibold normal-case tracking-normal text-[#202320] outline-none focus:border-[#0f8b73]";

function defaultFilters(): OperationsReportFilters {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return {
    report_id: "active_referrals",
    month,
    community: "",
    owner: "",
  };
}

function sameFilters(left: OperationsReportFilters, right: OperationsReportFilters) {
  return left.report_id === right.report_id && left.month === right.month && left.community === right.community && left.owner === right.owner;
}

function formatCell(value: string | number | null | undefined, column: OperationsReportColumn) {
  if (value === null || value === undefined || value === "") return "—";
  if (column.format === "datetime") {
    const date = new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : String(value);
  }
  if (column.format === "date") {
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : String(value);
  }
  if (column.format === "duration") {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return "—";
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim();
  }
  if (column.key === "age_days") return `${value}d`;
  return String(value);
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "now";
}

function downloadName(response: Response, filters: OperationsReportFilters) {
  const match = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? `pipeline-${filters.report_id}-${filters.month}.csv`;
}
