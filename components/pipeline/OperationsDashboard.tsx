"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Download } from "lucide-react";

import { fetchPipelineApi, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type {
  OperationsReportColumn,
  OperationsReportDefinition,
  OperationsReportFilters,
  OperationsReportId,
  OperationsReportMetric,
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
  const displayedDefinition = response?.report.definition ?? selectedDefinition;
  const displayedFilters = response?.filters ?? filters;
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
    <main aria-label="Reports" className="h-full overflow-y-auto bg-white text-[#171917]">
      <div data-testid="operations-workspace" data-guide-target="operations-workspace" className="mx-auto w-full max-w-[1432px] px-4 pb-12 pt-3 sm:px-6 lg:px-8">
        <div className="grid min-w-0 gap-6 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-8">
          <aside aria-label="Report library" className="min-w-0">
            <p className="text-[11px] leading-4 text-[#595959]">Choose an analysis to review.</p>
            <div className="mt-3 flex snap-x gap-2 overflow-x-auto border-y border-[#171917] py-2 md:block md:overflow-visible md:border-b-0 md:py-0">
              {(response?.catalog ?? []).map((item) => {
                const selected = item.id === filters.report_id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={selected}
                    aria-label={`View ${item.label} report`}
                    data-guide-target={selected ? "operations-report-select" : undefined}
                    onClick={() => selectReport(item.id)}
                    className={`grid min-w-[210px] snap-start grid-cols-[3px_minmax(0,1fr)] gap-3 border border-[#d9d9d9] py-3 pr-2 text-left transition-colors md:w-full md:min-w-0 md:border-x-0 md:border-t-0 ${selected ? "bg-[#f5f4ef]" : "hover:bg-[#fafafa]"}`}
                  >
                    <span className={selected ? "bg-[#0f8b73]" : "bg-transparent"} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-bold leading-5">{item.label}</span>
                      <span className="mt-1 block text-[10px] leading-4 text-[#737373]">{item.cadence} | {item.audience}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0">
            <section data-guide-target="operations-summary" aria-label="Report controls" className="border-b border-[#d9d9d9] pb-4">
              <p className="max-w-[780px] text-[13px] leading-5 text-[#3f3f3f]">
                {selectedDefinition?.description ?? "Loading the report library."}
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                {selectedDefinition?.filters.includes("month") ? (
                  <Control label="Month">
                    <input
                      data-guide-target="operations-report-month"
                      aria-label="Report month"
                      type="month"
                      value={filters.month}
                      onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))}
                      className={`${selectClass} min-w-[165px]`}
                    />
                  </Control>
                ) : null}
                {selectedDefinition?.filters.includes("community") ? (
                  <Control label="Community">
                    <select aria-label="Report community" value={filters.community} onChange={(event) => setFilters((current) => ({ ...current, community: event.target.value }))} className={`${selectClass} min-w-[190px]`}>
                      <option value="">All communities</option>
                      {(response?.facets.communities ?? []).map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
                    </select>
                  </Control>
                ) : null}
                {selectedDefinition?.filters.includes("owner") ? (
                  <Control label="Owner">
                    <select aria-label="Report owner" value={filters.owner} onChange={(event) => setFilters((current) => ({ ...current, owner: event.target.value }))} className={`${selectClass} min-w-[180px]`}>
                      <option value="">All owners</option>
                      {(response?.facets.owners ?? []).map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
                    </select>
                  </Control>
                ) : null}
                <button
                  type="button"
                  onClick={() => void loadReport(filters)}
                  disabled={loading || !filtersChanged}
                  className="h-9 border border-[#171917] bg-[#171917] px-4 text-[11px] font-semibold text-white hover:bg-[#343734] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? "Running" : "Apply scope"}
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
            </section>

            {error ? (
              <div role="alert" className="mt-4 flex items-center justify-between gap-4 border-l-[3px] border-[#a9473d] bg-[#fff6f4] px-4 py-3 text-[12px] text-[#723d35]">
                <span>{error}</span>
                <button type="button" onClick={() => void loadReport(filters)} className="font-semibold underline underline-offset-2">Retry</button>
              </div>
            ) : null}

            <article aria-labelledby="pipeline-report-title" className="mt-5 min-w-0">
              <header className="grid items-start gap-5 border-b-2 border-[#171917] pb-5 xl:grid-cols-[minmax(0,8fr)_minmax(200px,3fr)] xl:gap-8">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#0f8b73]">{reportScopeLabel(displayedDefinition, displayedFilters)}</p>
                  <h1 id="pipeline-report-title" className="mt-2 text-[30px] font-bold leading-[1.05] sm:text-[36px]">{displayedDefinition?.label ?? "Report"}</h1>
                  <p className="mt-3 max-w-[820px] text-[14px] leading-6 text-[#3f3f3f]">{displayedDefinition?.description}</p>
                </div>
                <div className="border-l-[3px] border-[#0f8b73] pl-4 text-[10px] leading-4 text-[#595959]">
                  <p className="font-bold uppercase tracking-[0.12em] text-[#171917]">Coverage</p>
                  <p className="mt-1">{reportCoverage(displayedFilters)}</p>
                  <p className="mt-3 font-bold uppercase tracking-[0.12em] text-[#171917]">Generated</p>
                  <p className="mt-1">{response ? formatTimestamp(response.report.generated_at) : "Loading"}</p>
                </div>
              </header>

              {response ? <MetricGrid metrics={response.report.metrics} /> : null}

              <section data-guide-target="operations-report-results" className="mt-7 border-t-2 border-[#171917] pt-4" aria-label="Report results">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#0f8b73]">01</p>
                    <h2 className="mt-1 text-[23px] font-bold leading-tight">Source rows</h2>
                  </div>
                  <span className="text-[10px] font-semibold text-[#727a75]">
                    {response ? `${response.report.row_count.toLocaleString()} rows${response.report.truncated ? " · preview limited" : ""}` : "Loading"}
                  </span>
                </div>
                {loading && !response ? <ReportSkeleton /> : null}
                {response && response.report.rows.length === 0 && !loading ? (
                  <div className="border-y border-[#d9d9d9] py-12 text-center text-[12px] text-[#727a75]">No records match this report and scope.</div>
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
            </article>
          </div>
        </div>
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
    <div role="region" aria-label="Scrollable report table" tabIndex={0} className={`mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] ${refreshing ? "opacity-55" : ""}`}>
      <table className="w-full min-w-[850px] border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-[#171917]">
            {columns.map((column) => (
              <th key={column.key} className={`px-3 py-2.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#595959] first:pl-0 ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>
            ))}
            <th className="w-10 px-2 py-2.5"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const canOpen = Boolean(row.referral_id && row.client_name && row.community);
            return (
              <tr key={row.row_id} className={canOpen ? "transition-colors hover:bg-[#f7faf9]" : ""}>
                {columns.map((column) => (
                  <td key={column.key} className={`max-w-[360px] border-b border-[#d9d9d9] px-3 py-2.5 text-[11px] leading-5 text-[#4e5550] first:pl-0 ${column.align === "right" ? "text-right tabular-nums" : ""}`}>
                    <span className={column.key === "client" || column.key === "staff" || column.key === "issue" ? "font-semibold text-[#202320]" : ""}>
                      {formatCell(row.values[column.key], column)}
                    </span>
                  </td>
                ))}
                <td className="border-b border-[#d9d9d9] px-2 py-2 text-right">
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

function MetricGrid({ metrics }: { metrics: OperationsReportMetric[] }) {
  return (
    <div className="mt-5 grid border-y border-[#171917] sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={`min-w-0 py-4 sm:px-4 ${index > 0 ? "border-t border-[#d9d9d9]" : ""} ${index === 1 ? "sm:border-t-0" : ""} ${index % 2 ? "sm:border-l" : "sm:border-l-0"} ${index < 4 ? "xl:border-t-0" : "xl:border-t"} ${index % 4 ? "xl:border-l" : "xl:border-l-0"}`}
        >
          <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#595959]">{metric.label}</p>
          <p className="mt-1.5 text-[25px] font-bold leading-none tabular-nums">{metric.value}</p>
          <p className="mt-2 text-[10px] leading-4 text-[#666666]">{metric.detail}</p>
        </div>
      ))}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div aria-label="Loading report" aria-busy="true" className="animate-pulse divide-y divide-[#e8ebe9]">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-11 bg-white px-4 py-3"><div className="h-3 w-1/3 bg-[#edf0ee]" /></div>)}
    </div>
  );
}

const selectClass = "h-9 border border-[#b3b3b3] bg-white px-3 text-[11px] font-semibold normal-case tracking-normal text-[#202320] outline-none focus:border-[#0f8b73]";

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

function reportScopeLabel(definition: OperationsReportDefinition | null, filters: OperationsReportFilters) {
  if (definition?.filters.includes("month")) return formatMonth(filters.month);
  return "Current operations";
}

function reportCoverage(filters: OperationsReportFilters) {
  const parts = [filters.community || "All communities", filters.owner || "All owners"];
  return parts.join(" | ");
}

function formatMonth(value: string) {
  const date = new Date(`${value}-01T12:00:00`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : value;
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
  if (column.key === "age_days" || column.key === "oldest_days") return `${value}d`;
  return String(value);
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "Now";
}

function downloadName(response: Response, filters: OperationsReportFilters) {
  const match = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? `pipeline-${filters.report_id}-${filters.month}.csv`;
}
