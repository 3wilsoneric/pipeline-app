"use client";
import { pipelineSurfaceReady } from "@/lib/observability/browser-performance-contract";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Download } from "lucide-react";

import { fetchPipelineApi, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type {
  OperationsReportColumn,
  OperationsReportFilters,
  OperationsReportId,
  OperationsReportMetric,
  OperationsReportResponse,
  OperationsReportRow,
} from "@/lib/pipeline/operations-report-types";
import { careReportTopics, isClientDataReport } from "@/lib/pipeline/operations-report-types";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import { pushPipelineHistory, usePipelineLocationSearch } from "@/lib/pipeline/client-navigation";
import type { Referral } from "@/lib/pipeline/referral-types";
import SupervisorCommandCenter from "@/components/pipeline/SupervisorCommandCenter";
import FeedbackCue from "@/components/pipeline/FeedbackCue";

type ReportsView = "reports" | "exceptions";

export default function OperationsDashboard({
  onOpenPacket,
  onOpenProfile,
  onOpenProfiles,
}: {
  onOpenPacket: (referral: { id: number; name?: string; community?: Referral["community"] }) => void;
  onOpenProfile: (profileId: string) => void;
  onOpenProfiles: () => void;
}) {
  const [filters, setFilters] = useState<OperationsReportFilters>(defaultFilters);
  const [response, setResponse] = useState<OperationsReportResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const searchParams = useSearchParams();
  const locationSearch = usePipelineLocationSearch(searchParams?.toString() ?? "");
  const view: ReportsView = new URLSearchParams(locationSearch).get("reportView") === "exceptions" ? "exceptions" : "reports";

  const loadReport = useCallback(async (nextFilters: OperationsReportFilters, signal?: AbortSignal) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        report_id: nextFilters.report_id,
        month: nextFilters.month,
        ...(nextFilters.community ? { community: nextFilters.community } : {}),
        ...(nextFilters.owner ? { owner: nextFilters.owner } : {}),
        ...(nextFilters.county ? { county: nextFilters.county } : {}),
        ...(nextFilters.client_scope ? { client_scope: nextFilters.client_scope } : {}),
        ...(nextFilters.care_topic ? { care_topic: nextFilters.care_topic } : {}),
      });
      const payload = await fetchPipelineJson<OperationsReportResponse>(`/api/operations/reports?${params}`, {
        cache: "no-store",
        signal: requestSignal,
      }, { cacheTtlMs: 15_000 });
      if (requestSignal.aborted) return;
      setResponse(payload);
      setFilters((current) => sameFilters(current, nextFilters) ? payload.filters : current);
    } catch (loadError) {
      if (!requestSignal.aborted) {
        setError(loadError instanceof Error ? loadError.message : "The report could not be loaded.");
      }
    } finally {
      if (!requestSignal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadReport(defaultFilters(), controller.signal);
    return () => { controller.abort(); activeRequest.current?.abort(); };
  }, [loadReport]);

  const selectedDefinition = useMemo(
    () => response?.catalog.find((item) => item.id === filters.report_id) ?? response?.report.definition ?? null,
    [filters.report_id, response],
  );
  const filtersChanged = response ? !sameFilters(filters, response.filters) : false;

  const selectReport = (reportId: OperationsReportId) => {
    const next: OperationsReportFilters = { ...filters, report_id: reportId, community: "", owner: "", county: "", month: isClientDataReport(reportId) ? "" : currentMonth(), client_scope: reportId === "clients_by_community" || reportId === "client_care_needs" ? "current" : "all" };
    setFilters(next);
    void loadReport(next);
  };

  const selectView = (nextView: ReportsView) => {
    if (nextView === view) return;
    const params = new URLSearchParams(window.location.search);
    if (nextView === "exceptions") params.set("reportView", "exceptions");
    else params.delete("reportView");
    pushPipelineHistory(`/?${params.toString()}`);
  };

  const exportReport = async () => {
    if (!response || filtersChanged || loading || error) return;
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
    <OperationsDashboardView
      view={view}
      filters={filters}
      response={response}
      selectedDefinition={selectedDefinition}
      error={error}
      loading={loading}
      exporting={exporting}
      filtersChanged={filtersChanged}
      onSelectView={selectView}
      onSelectReport={selectReport}
      onSetFilters={setFilters}
      onReload={() => void loadReport(filters)}
      onExport={() => void exportReport()}
      onOpenPacket={onOpenPacket}
      onOpenProfile={onOpenProfile}
      onOpenProfiles={onOpenProfiles}
    />
  );
}

function OperationsDashboardView({
  view,
  filters,
  response,
  selectedDefinition,
  error,
  loading,
  exporting,
  filtersChanged,
  onSelectView,
  onSelectReport,
  onSetFilters,
  onReload,
  onExport,
  onOpenPacket,
  onOpenProfile,
  onOpenProfiles,
}: {
  view: ReportsView;
  filters: OperationsReportFilters;
  response: OperationsReportResponse | null;
  selectedDefinition: OperationsReportResponse["report"]["definition"] | null;
  error: string;
  loading: boolean;
  exporting: boolean;
  filtersChanged: boolean;
  onSelectView: (view: ReportsView) => void;
  onSelectReport: (reportId: OperationsReportId) => void;
  onSetFilters: Dispatch<SetStateAction<OperationsReportFilters>>;
  onReload: () => void;
  onExport: () => void;
  onOpenPacket: (referral: { id: number; name?: string; community?: Referral["community"] }) => void;
  onOpenProfile: (profileId: string) => void;
  onOpenProfiles: () => void;
}) {
  return (
    <main aria-label="Reports" className="h-full overflow-y-auto bg-white text-[#171917]">
      <div data-testid="operations-workspace" data-guide-target="operations-workspace" data-performance-ready={pipelineSurfaceReady("operations", loading, error)} className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-2 sm:px-6 lg:px-8">
        <div className="flex items-center py-3">
          <div role="group" aria-label="Reports view" className="pipeline-segmented inline-flex rounded-md bg-[#eef1ef] p-1">
            <ViewToggle selected={view === "reports"} onClick={() => onSelectView("reports")}>Reports</ViewToggle>
            <ViewToggle selected={view === "exceptions"} onClick={() => onSelectView("exceptions")}>Exceptions</ViewToggle>
          </div>
        </div>

        {view === "exceptions" ? (
          <SupervisorCommandCenter onOpenPacket={onOpenPacket} onOpenProfile={onOpenProfile} onOpenProfiles={onOpenProfiles} />
        ) : (
          <>
            <ReportsPanel
              filters={filters}
              response={response}
              selectedDefinition={selectedDefinition}
              error={error}
              loading={loading}
              exporting={exporting}
              filtersChanged={filtersChanged}
              onSelectReport={onSelectReport}
              onSetFilters={onSetFilters}
              onReload={onReload}
              onExport={onExport}
              onOpenPacket={onOpenPacket}
              onOpenProfile={onOpenProfile}
            />
          </>
        )}
      </div>
    </main>
  );
}

function ReportsPanel({
  filters,
  response,
  selectedDefinition,
  error,
  loading,
  exporting,
  filtersChanged,
  onSelectReport,
  onSetFilters,
  onReload,
  onExport,
  onOpenPacket,
  onOpenProfile,
}: {
  filters: OperationsReportFilters;
  response: OperationsReportResponse | null;
  selectedDefinition: OperationsReportResponse["report"]["definition"] | null;
  error: string;
  loading: boolean;
  exporting: boolean;
  filtersChanged: boolean;
  onSelectReport: (reportId: OperationsReportId) => void;
  onSetFilters: Dispatch<SetStateAction<OperationsReportFilters>>;
  onReload: () => void;
  onExport: () => void;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenProfile: (profileId: string) => void;
}) {
  return (
    <>
      <ReportControls filters={filters} response={response} selectedDefinition={selectedDefinition} loading={loading} exporting={exporting} filtersChanged={filtersChanged} error={error} onSelectReport={onSelectReport} onSetFilters={onSetFilters} onReload={onReload} onExport={onExport} />
      {error ? <div role="alert" className="mt-4 flex items-center justify-between gap-4 border-l-[3px] border-[#a9473d] bg-[#fff6f4] px-4 py-3 text-[12px] text-[#723d35]"><span>{error}</span><button type="button" onClick={onReload} className="font-semibold underline underline-offset-2">Retry</button></div> : null}
      <ReportResults key={response ? JSON.stringify(response.filters) : "loading"} response={response} selectedDefinition={selectedDefinition} loading={loading} error={error} onOpenPacket={onOpenPacket} onOpenProfile={onOpenProfile} />
    </>
  );
}

function ReportControls({ filters, response, selectedDefinition, loading, exporting, filtersChanged, error, onSelectReport, onSetFilters, onReload, onExport }: {
  filters: OperationsReportFilters;
  response: OperationsReportResponse | null;
  selectedDefinition: OperationsReportResponse["report"]["definition"] | null;
  loading: boolean;
  exporting: boolean;
  filtersChanged: boolean;
  error: string;
  onSelectReport: (reportId: OperationsReportId) => void;
  onSetFilters: Dispatch<SetStateAction<OperationsReportFilters>>;
  onReload: () => void;
  onExport: () => void;
}) {
  return (
    <section data-guide-target="operations-summary" aria-label="Report controls" className="pipeline-commands flex flex-wrap items-end gap-3 py-3">
      <Control label="Report"><select data-guide-target="operations-report-select" aria-label="Report" value={filters.report_id} onChange={(event) => onSelectReport(event.target.value as OperationsReportId)} className={`${selectClass} sm:min-w-[230px]`}>{(response?.catalog ?? [{ id: "clients_by_community", label: "Clients by community" }]).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Control>
      {selectedDefinition?.filters.includes("client_scope") ? <Control label="Clients"><select aria-label="Report clients" value={filters.client_scope ?? "all"} onChange={(event) => onSetFilters((current) => ({ ...current, client_scope: event.target.value as OperationsReportFilters["client_scope"] }))} className={selectClass}>{["clients_by_community", "client_care_needs"].includes(filters.report_id) ? <option value="current">Current residents</option> : null}<option value="all">All clients and potential clients</option><option value="admitted">Documented admissions</option></select></Control> : null}
      {selectedDefinition?.filters.includes("month") && isClientDataReport(filters.report_id) ? <Control label="Period"><select aria-label="Report period" value={filters.month ? "month" : "all"} onChange={(event) => onSetFilters((current) => ({ ...current, month: event.target.value === "all" ? "" : currentMonth() }))} className={selectClass}><option value="all">All dates</option><option value="month">By month</option></select></Control> : null}
      {selectedDefinition?.filters.includes("month") && (!isClientDataReport(filters.report_id) || filters.month) ? <Control label={filters.report_id === "clients_by_community" ? "Admission month" : "Month"}><input data-guide-target="operations-report-month" aria-label="Report month" type="month" value={filters.month} onChange={(event) => onSetFilters((current) => ({ ...current, month: event.target.value }))} className={selectClass} /></Control> : null}
      {selectedDefinition?.filters.includes("community") ? <Control label="Community"><select aria-label="Report community" value={filters.community} onChange={(event) => onSetFilters((current) => ({ ...current, community: event.target.value }))} className={`${selectClass} min-w-[190px]`}><option value="">All communities</option>{(response?.facets.communities ?? []).map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></Control> : null}
      {selectedDefinition?.filters.includes("owner") ? <Control label="Owner"><select aria-label="Report owner" value={filters.owner} onChange={(event) => onSetFilters((current) => ({ ...current, owner: event.target.value }))} className={`${selectClass} min-w-[180px]`}><option value="">All owners</option>{(response?.facets.owners ?? []).map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></Control> : null}
      {selectedDefinition?.filters.includes("county") ? <Control label="County"><select aria-label="Report county" value={filters.county ?? ""} onChange={(event) => onSetFilters((current) => ({ ...current, county: event.target.value }))} className={selectClass}><option value="">All counties</option>{(response?.facets.counties ?? []).map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></Control> : null}
      {selectedDefinition?.filters.includes("care_topic") ? <Control label="Care topic"><select aria-label="Report care topic" value={filters.care_topic ?? "primary_diagnosis"} onChange={(event) => onSetFilters((current) => ({ ...current, care_topic: event.target.value as OperationsReportFilters["care_topic"] }))} className={selectClass}>{careReportTopics.map((topic) => <option key={topic.value} value={topic.value}>{topic.label}</option>)}</select></Control> : null}
      <button type="button" onClick={onReload} disabled={loading || !filtersChanged} className="h-9 border border-[#171917] bg-[#171917] px-4 text-[11px] font-semibold text-white hover:bg-[#343734] disabled:cursor-not-allowed disabled:opacity-40">{loading ? "Loading" : "Apply"}</button>
      <button type="button" data-guide-target="operations-report-export" onClick={onExport} disabled={!response || filtersChanged || exporting || loading || Boolean(error)} className="flex h-9 items-center justify-center gap-2 border border-[#b9c6c1] bg-white px-4 text-[12px] font-semibold text-[#176f60] hover:border-[#0f8b73] disabled:cursor-not-allowed disabled:opacity-45"><Download size={14} /> {exporting ? "Exporting" : "Export CSV"}</button>
    </section>
  );
}

function ReportResults({ response, selectedDefinition, loading, error, onOpenPacket, onOpenProfile }: {
  response: OperationsReportResponse | null;
  selectedDefinition: OperationsReportResponse["report"]["definition"] | null;
  loading: boolean;
  error: string;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenProfile: (profileId: string) => void;
}) {
  const [group, setGroup] = useState<string | null>(null);
  const [resultView, setResultView] = useState<"summary" | "clients">("summary");
  const summary = response?.report.summary;
  const showSummary = Boolean(summary && resultView === "summary" && group === null);
  const rows = showSummary ? summary!.rows : (response?.report.rows ?? []).filter((row) => group === null || String(row.values.group).toLocaleLowerCase() === group.toLocaleLowerCase());
  return (
    <article aria-label={`${selectedDefinition?.label ?? "Selected"} report`} className="min-w-0">
      {response ? <MetricGrid metrics={response.report.metrics} /> : null}
      {response?.report.notes?.length ? <div className="mt-3 space-y-1 text-[12px] leading-5 text-[#68706b]">{response.report.notes.map((note) => <p key={note}>{note}</p>)}</div> : null}
      <section data-guide-target="operations-report-results" className="mt-5" aria-label="Report results">
        {summary ? <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Report detail" className="pipeline-segmented inline-flex rounded-md bg-[#eef1ef] p-1"><ViewToggle selected={showSummary} onClick={() => { setGroup(null); setResultView("summary"); }}>Summary</ViewToggle><ViewToggle selected={!showSummary} onClick={() => { setGroup(null); setResultView("clients"); }}>Clients</ViewToggle></div>
          {group !== null ? <button type="button" onClick={() => { setGroup(null); setResultView("summary"); }} className="flex items-center gap-2 text-[13px] font-semibold text-[#176f60]"><ArrowLeft size={16} />{group}</button> : null}
        </div> : null}
        <ReportResultStatus response={response} loading={loading} error={error} />
        {loading && !response ? <ReportSkeleton /> : null}
        {response && response.report.rows.length === 0 && !loading ? <div className="border-b border-[#d9d9d9] py-12 text-center text-[12px] text-[#727a75]">No recorded data matches this scope.</div> : null}
        {response && rows.length > 0 ? <ReportTable key={`${resultView}:${group}`} columns={showSummary ? summary!.columns : response.report.columns} rows={rows} onOpenPacket={onOpenPacket} onOpenProfile={onOpenProfile} onOpenGroup={showSummary ? (next) => { setGroup(next); setResultView("clients"); } : undefined} refreshing={loading} /> : null}
      </section>
    </article>
  );
}

function ReportResultStatus({ response, loading, error }: {
  response: OperationsReportResponse | null;
  loading: boolean;
  error: string;
}) {
  return (
    <div className="flex justify-end"><span role="status" className="relative text-[10px] font-semibold text-[#727a75]">
      {loading ? "Updating report..." : response ? `${response.report.row_count.toLocaleString()} total${response.report.truncated ? " · first 500 shown" : ""}` : "Loading"}
      {response && !loading ? <time title="Report generated at" dateTime={response.report.generated_at}> · {new Date(response.report.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time> : null}
      <FeedbackCue value={response?.report.generated_at ?? ""} enabled={!loading && !error && Boolean(response)} />
    </span></div>
  );
}

function ViewToggle({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-8 rounded px-4 text-[11px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-1 ${selected ? "bg-white text-[#111111] shadow-sm" : "text-[#68706b] hover:text-[#111111]"}`}
    >
      {children}
    </button>
  );
}

function ReportTable({
  columns,
  rows,
  onOpenPacket,
  onOpenProfile,
  onOpenGroup,
  refreshing,
}: {
  columns: OperationsReportColumn[];
  rows: OperationsReportRow[];
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenProfile: (profileId: string) => void;
  onOpenGroup?: (group: string) => void;
  refreshing: boolean;
}) {
  const [requestedPage, setPage] = useState(0);
  const pageSize = 50;
  const pageCount = Math.ceil(rows.length / pageSize);
  const page = Math.min(requestedPage, Math.max(0, pageCount - 1));
  return (
    <>
    <div role="region" aria-label="Scrollable report table" tabIndex={0} className={`mt-2 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] ${refreshing ? "opacity-55 pointer-events-none" : ""}`} aria-busy={refreshing}>
      <table className={`w-full border-collapse text-left ${onOpenGroup ? "min-w-[320px]" : "min-w-[850px]"}`}>
        <thead>
          <tr className="border-b border-[#cfd4d1] bg-[#f4f6f5]">
            {columns.map((column) => (
              <th scope="col" key={column.key} className={`px-3 py-3 text-[11px] font-bold text-[#595959] ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>
            ))}
            <th className="w-10 px-2 py-2.5"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(page * pageSize, (page + 1) * pageSize).map((row) => {
            const canOpen = Boolean(onOpenGroup || row.values.profile_id || row.referral_id && row.client_name);
            return (
              <tr key={row.row_id} className={canOpen ? "transition-colors hover:bg-[#f7faf9]" : ""}>
                {columns.map((column) => (
                  <td key={column.key} className={`max-w-[360px] break-words border-b border-[#e3e7e4] px-3 py-3 text-[13px] leading-5 text-[#4e5550] ${column.align === "right" ? "text-right tabular-nums" : ""}`}>
                    <span className={column.key === "client" || column.key === "staff" || column.key === "issue" || column.key === "group" || column.align === "right" ? "font-semibold text-[#202320]" : ""}>
                      {formatCell(row.values[column.key], column, row.community)}
                    </span>
                  </td>
                ))}
                <td className="border-b border-[#d9d9d9] px-2 py-2 text-right">
                  {canOpen ? (
                    <button
                      type="button"
                      aria-label={onOpenGroup ? `Show clients: ${row.values.group}` : `Open ${reportClientName(row.client_name!, row.community)}`}
                      title={onOpenGroup ? "Show clients" : "Open client"}
                      disabled={refreshing}
                      onClick={() => onOpenGroup ? onOpenGroup(String(row.values.group)) : row.values.profile_id ? onOpenProfile(String(row.values.profile_id)) : onOpenPacket({ id: row.referral_id!, name: reportClientName(row.client_name!, row.community), community: row.community as Referral["community"] })}
                      className="flex h-9 w-9 items-center justify-center rounded text-[#0f8b73] hover:bg-[#e8f5f0] focus-visible:outline-2 focus-visible:outline-[#0f8b73]"
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
    {pageCount > 1 ? <nav aria-label="Report pages" className="mt-4 flex items-center justify-end gap-3 text-[12px] font-semibold text-[#68706b]"><span>{(page * pageSize + 1).toLocaleString()}-{Math.min((page + 1) * pageSize, rows.length).toLocaleString()} of {rows.length.toLocaleString()}</span><button type="button" aria-label="Previous report page" title="Previous page" disabled={page === 0 || refreshing} onClick={() => setPage(page - 1)} className="flex h-9 w-9 items-center justify-center rounded hover:bg-[#eef1ef] disabled:opacity-35"><ChevronLeft size={18} /></button><button type="button" aria-label="Next report page" title="Next page" disabled={page === pageCount - 1 || refreshing} onClick={() => setPage(page + 1)} className="flex h-9 w-9 items-center justify-center rounded hover:bg-[#eef1ef] disabled:opacity-35"><ChevronRight size={18} /></button></nav> : null}
    </>
  );
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid min-w-0 max-w-full gap-1.5 text-[11px] font-bold text-[#6f7671]">{label}{children}</label>;
}

function MetricGrid({ metrics }: { metrics: OperationsReportMetric[] }) {
  return (
    <div aria-label="Report totals" className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
      {metrics.map((metric) => (
        <div key={metric.label} title={metric.detail} className="flex items-baseline gap-2">
          <p className="text-[20px] font-bold leading-none tabular-nums">{metric.value}</p>
          <p className="text-[12px] font-semibold text-[#68706b]">{metric.label}</p>
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

const selectClass = "h-9 min-w-0 max-w-full rounded border border-[#bcc6c0] bg-white px-3 text-[12px] font-semibold normal-case tracking-normal text-[#202320] outline-none focus:border-[#0f8b73] focus-visible:ring-1 focus-visible:ring-[#0f8b73]";

function defaultFilters(): OperationsReportFilters {
  return {
    report_id: "clients_by_community",
    month: "",
    community: "",
    owner: "",
    county: "",
    client_scope: "current",
    care_topic: "primary_diagnosis",
  };
}

function sameFilters(left: OperationsReportFilters, right: OperationsReportFilters) {
  return left.report_id === right.report_id && left.month === right.month && left.community === right.community && left.owner === right.owner && (left.county ?? "") === (right.county ?? "") && (left.client_scope ?? "all") === (right.client_scope ?? "all") && (left.care_topic ?? "primary_diagnosis") === (right.care_topic ?? "primary_diagnosis");
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function formatCell(value: string | number | null | undefined, column: OperationsReportColumn, community?: string | null) {
  if (value === null || value === undefined || value === "") return "";
  if (column.key === "client") return reportClientName(String(value), community);
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
  return typeof value === "number" ? value.toLocaleString() : String(value);
}

function reportClientName(name: string, community?: string | null) {
  return formatClientIdentityTitle({ name, community });
}

function downloadName(response: Response, filters: OperationsReportFilters) {
  const match = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? `pipeline-${filters.report_id}-${filters.month}.csv`;
}
