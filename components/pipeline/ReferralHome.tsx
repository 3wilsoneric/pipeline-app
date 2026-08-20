"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  FileText,
  Files,
  FolderOpen,
  Hash,
  Eye,
  ListChecks,
  RefreshCw,
  Users,
  X,
} from "lucide-react";

import { pipelineCommunities } from "@/lib/pipeline/community-config";
import { boardStages, getStageLabel, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import type { ReferralFacets } from "@/lib/pipeline/referral-store";
import type { ReferralWorklistBucket, ReferralWorklistSnapshot } from "@/lib/pipeline/operations-types";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import {
  filterReferralWorklistItems,
  referralWorklistCategoryLabel,
} from "@/lib/pipeline/referral-worklist-filter";
import ReferralActionWorklist from "@/components/pipeline/ReferralActionWorklist";
import ReferralWorkflowTracker from "@/components/pipeline/ReferralWorkflowTracker";
import ReferralWorklist from "@/components/pipeline/ReferralWorklist";

type ReferralFilter =
  | { kind: "workflow" }
  | { kind: "work"; value: ReferralWorklistBucket }
  | { kind: "all" }
  | { kind: "files" }
  | { kind: "community"; value: string }
  | { kind: "month"; value: string }
  | { kind: "stage"; value: ReferralStage }
  | { kind: "owner"; value: string }
  | { kind: "priority"; value: Referral["priority"] }
  | { kind: "tag"; value: string };

type FilePreviewMetadata = {
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
  pages: Array<{
    page_number: number;
    content_type: string;
    byte_size: number | null;
    width: number | null;
    height: number | null;
    preview_url: string;
    thumbnail_url: string;
  }>;
  pagination: {
    after_page: number;
    limit: number;
    returned: number;
    has_more: boolean;
    first_page: number | null;
    last_page: number | null;
  };
  next_page_after?: number;
};

const emptyFacets: ReferralFacets = {
  communities: [],
  stages: [],
  owners: [],
  priorities: [],
  tags: [],
  months: [],
};

export default function ReferralHome({
  searchTerm,
  onOpenPacket,
}: {
  searchTerm: string;
  onOpenPacket: (referral?: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [progressByReferral, setProgressByReferral] = useState<Record<number, ReferralProgress>>({});
  const [referralTotal, setReferralTotal] = useState(0);
  const [referralNextCursor, setReferralNextCursor] = useState<string>();
  const [referralPage, setReferralPage] = useState(0);
  const [referralCursors, setReferralCursors] = useState<string[]>([""]);
  const [facets, setFacets] = useState<ReferralFacets>(emptyFacets);
  const [files, setFiles] = useState<ReferralFile[] | null>(null);
  const [allFileTotal, setAllFileTotal] = useState(0);
  const [fileTotal, setFileTotal] = useState(0);
  const [fileNextCursor, setFileNextCursor] = useState<string>();
  const [filePage, setFilePage] = useState(0);
  const [fileCursors, setFileCursors] = useState<string[]>([""]);
  const [filter, setFilter] = useState<ReferralFilter>({ kind: "workflow" });
  const [workflowTotal, setWorkflowTotal] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const workflowRefreshInFlight = useRef(false);
  const referralRevision = useRef(0);
  const summaryQuery = useRef<string | null>(null);
  const successfulReferralRequest = useRef("");
  const [worklist, setWorklist] = useState<ReferralWorklistSnapshot | null>(null);
  const [worklistLoading, setWorklistLoading] = useState(false);
  const [worklistError, setWorklistError] = useState("");
  const [showAllTags, setShowAllTags] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [previewFile, setPreviewFile] = useState<ReferralFile | null>(null);

  const loadWorklist = useCallback(async (signal?: AbortSignal) => {
    setWorklistLoading(true);
    setWorklistError("");
    try {
      const payload = await fetchPipelineJson<ReferralWorklistSnapshot>(
        "/api/operations/referral-worklist",
        { cache: "no-store", signal },
      );
      setWorklist(payload);
    } catch (error) {
      if (signal?.aborted) return;
      setWorklistError(error instanceof Error ? error.message : "The action worklist could not be loaded.");
    } finally {
      if (!signal?.aborted) setWorklistLoading(false);
    }
  }, []);

  const loadReferrals = useCallback(async (signal?: AbortSignal, background = false) => {
    if (filter.kind === "work" || filter.kind === "files") {
      setIsLoading(false);
      return;
    }
    if (background && workflowRefreshInFlight.current) return;
    if (background) {
      workflowRefreshInFlight.current = true;
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setLoadError("");
    let requestKey = "";
    try {
      const params = buildReferralParams(filter, searchTerm, referralCursors[referralPage]);
      requestKey = params.toString();
      const normalizedSearch = searchTerm.trim();
      const includeSummary = referralPage === 0 && (background || summaryQuery.current !== normalizedSearch);
      const payload = await fetchPipelineJson<{
        referrals?: Referral[];
        total?: number;
        revision?: number;
        next_cursor?: string;
        progress?: Record<number, ReferralProgress>;
        facets?: ReferralFacets;
        file_total?: number;
      }>(`${includeSummary ? "/api/referrals/directory" : "/api/referrals"}?${params.toString()}`, { cache: "no-store", signal });
      setReferrals(Array.isArray(payload.referrals) ? payload.referrals : []);
      setProgressByReferral(payload.progress ?? {});
      setReferralTotal(typeof payload.total === "number" ? payload.total : 0);
      if (Number.isSafeInteger(payload.revision) && Number(payload.revision) >= 0) {
        referralRevision.current = Number(payload.revision);
      }
      if (filter.kind === "workflow") {
        setWorkflowTotal(typeof payload.total === "number" ? payload.total : 0);
      }
      setReferralNextCursor(payload.next_cursor);
      if (includeSummary) {
        setFacets(payload.facets ?? emptyFacets);
        setAllFileTotal(typeof payload.file_total === "number" ? payload.file_total : 0);
        summaryQuery.current = normalizedSearch;
      }
      setLastRefreshedAt(Date.now());
      successfulReferralRequest.current = requestKey;
    } catch (error) {
      if (signal?.aborted) return;
      if (successfulReferralRequest.current !== requestKey) {
        setReferrals([]);
        setProgressByReferral({});
        setReferralTotal(0);
        setReferralNextCursor(undefined);
      }
      setLoadError(error instanceof Error ? error.message : "Referral packets could not be loaded.");
    } finally {
      if (background) workflowRefreshInFlight.current = false;
      if (!signal?.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [filter, referralCursors, referralPage, searchTerm]);

  useEffect(() => {
    const controller = new AbortController();
    void loadReferrals(controller.signal);
    return () => controller.abort();
  }, [loadReferrals]);

  useEffect(() => {
    if (filter.kind !== "workflow") return;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const payload = await fetchPipelineJson<{ changed?: boolean; sequence?: number }>(
          `/api/referrals/changes?after=${referralRevision.current}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (Number.isSafeInteger(payload.sequence) && Number(payload.sequence) >= 0) {
          referralRevision.current = Number(payload.sequence);
        }
        if (payload.changed) await loadReferrals(controller.signal, true);
        else setLastRefreshedAt(Date.now());
      } catch {
        // The last successful list remains visible; the next heartbeat retries.
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(() => void refresh(), 3000);
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      controller?.abort();
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [filter.kind, loadReferrals]);

  useEffect(() => {
    if (filter.kind !== "work") return;
    const controller = new AbortController();
    void loadWorklist(controller.signal);
    return () => controller.abort();
  }, [filter.kind, loadWorklist]);

  useEffect(() => {
    setReferralPage((current) => current === 0 ? current : 0);
    setReferralCursors((current) => current.length === 1 && current[0] === "" ? current : [""]);
  }, [filter, searchTerm]);

  useEffect(() => {
    if (filter.kind !== "files") return;

    let cancelled = false;
    const params = new URLSearchParams({
      limit: "100",
      q: searchTerm,
    });
    if (fileCursors[filePage]) params.set("cursor", fileCursors[filePage]);

    fetchPipelineJson<{ files?: ReferralFile[]; total?: number; next_cursor?: string }>(`/api/files?${params.toString()}`, { cache: "no-store" })
      .then((payload: { files?: ReferralFile[]; total?: number; next_cursor?: string } | null) => {
        if (!cancelled) {
          setFiles(Array.isArray(payload?.files) ? payload.files : []);
          setFileTotal(typeof payload?.total === "number" ? payload.total : 0);
          setFileNextCursor(payload?.next_cursor);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFiles([]);
          setFileTotal(0);
          setFileNextCursor(undefined);
        }
      })

    return () => {
      cancelled = true;
    };
  }, [fileCursors, filePage, filter.kind, searchTerm]);

  useEffect(() => {
    setFilePage(0);
    setFileCursors([""]);
    setFiles(null);
  }, [filter.kind, searchTerm]);

  const monthOptions = useMemo(() => getCreatedMonthOptions(), []);
  const ownerOptions = useMemo(() => facets.owners.map((entry) => entry.value), [facets.owners]);
  const tagOptions = useMemo(() => facets.tags.map((entry) => entry.value), [facets.tags]);
  const tagFacets = useMemo(
    () => [...facets.tags].sort((left, right) => right.count - left.count || left.value.localeCompare(right.value)),
    [facets.tags],
  );
  const visibleTagFacets = showAllTags ? tagFacets : tagFacets.slice(0, 6);
  const allPacketTotal = useMemo(
    () => facets.communities.reduce((total, entry) => total + entry.count, 0),
    [facets.communities],
  );
  const isFileLoading = filter.kind === "files" && files === null;
  const visibleFiles = files ?? [];

  const visibleReferrals = filter.kind === "files" || filter.kind === "work" ? [] : referrals;
  const emptyReferralState = getEmptyReferralState(filter, searchTerm);
  const selectedWorkBucket = filter.kind === "work" ? filter.value : "all_actionable";
  const visibleWorkCount = filterReferralWorklistItems(
    worklist?.items ?? [],
    selectedWorkBucket,
    searchTerm,
  ).length;

  const resultCountLabel = filter.kind === "work"
    ? worklistLoading
      ? "Loading..."
      : `${visibleWorkCount} referral${visibleWorkCount === 1 ? "" : "s"}`
    : filter.kind === "files"
    ? isFileLoading
      ? "Loading..."
      : `${fileTotal} file${fileTotal === 1 ? "" : "s"}`
    : isLoading
      ? "Loading..."
      : `${referralTotal} referral${referralTotal === 1 ? "" : "s"}`;

  const refreshLabel = lastRefreshedAt === null ? "" : formatRefreshAge(lastRefreshedAt);

  const packetToolbar = (
    <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-[#d9d9d9] px-2 py-2">
      <div className="flex items-center gap-2">
        <FileText size={16} className="text-[#0f8b73]" />
        <h2 className="text-[16px] font-black tracking-[0.01em] text-[#111111]">{getFilterLabel(filter)}</h2>
        <span className="text-[11px] text-[#737373]">{resultCountLabel}</span>
      </div>
      {filter.kind === "workflow" || filter.kind === "work" ? (
        <div className="flex items-center gap-2">
          {filter.kind === "workflow" && refreshLabel ? (
            <span className="hidden text-[9px] font-semibold text-[#737373] sm:inline">Live · {refreshLabel}</span>
          ) : null}
          <button
            type="button"
            aria-label={filter.kind === "workflow" ? "Refresh referral workflow" : "Refresh referral worklist"}
            title={filter.kind === "workflow" ? "Refresh referral workflow" : "Refresh referral worklist"}
            onClick={() => filter.kind === "workflow" ? void loadReferrals(undefined, true) : void loadWorklist()}
            disabled={filter.kind === "workflow" ? isLoading || isRefreshing : worklistLoading}
            className="flex h-9 w-9 items-center justify-center text-[#0c705f] hover:bg-[#effaf5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:text-[#b3b3b3]"
          >
            <RefreshCw size={15} className={(filter.kind === "workflow" ? isLoading || isRefreshing : worklistLoading) ? "animate-spin" : ""} />
          </button>
        </div>
      ) : null}
    </div>
  );

  const filterToolbar = (
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto px-2 py-3">
      <span className="mr-1 shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-[#0c705f]">Filter</span>
      <select
        aria-label="Filter by stage"
        value={filter.kind === "stage" ? filter.value : ""}
        onChange={(event) => setFilter(event.target.value ? { kind: "stage", value: event.target.value as ReferralStage } : { kind: "all" })}
        className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black tracking-[0.01em] text-[#111111] outline-none focus:border-[#0f8b73]"
      >
        <option value="">All stages</option>
        {boardStages.map((stage) => <option key={stage} value={stage}>{getStageLabel(stage)}</option>)}
      </select>
      <select
        aria-label="Filter by owner"
        value={filter.kind === "owner" ? filter.value : ""}
        onChange={(event) => setFilter(event.target.value ? { kind: "owner", value: event.target.value } : { kind: "all" })}
        className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black tracking-[0.01em] text-[#111111] outline-none focus:border-[#0f8b73]"
      >
        <option value="">All owners</option>
        {ownerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
      </select>
      <select
        aria-label="Filter by priority"
        value={filter.kind === "priority" ? filter.value : ""}
        onChange={(event) => setFilter(event.target.value ? { kind: "priority", value: event.target.value as Referral["priority"] } : { kind: "all" })}
        className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black tracking-[0.01em] text-[#111111] outline-none focus:border-[#0f8b73]"
      >
        <option value="">All priorities</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="standard">Standard</option>
      </select>
      {tagOptions.length > 0 ? (
        <select
          aria-label="Filter by tag"
          value={filter.kind === "tag" ? filter.value : ""}
          onChange={(event) => setFilter(event.target.value ? { kind: "tag", value: event.target.value } : { kind: "all" })}
          className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black tracking-[0.01em] text-[#111111] outline-none focus:border-[#0f8b73]"
        >
          <option value="">All tags</option>
          {tagOptions.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
        </select>
      ) : null}
    </div>
  );

  return (
    <main aria-label="Referral packets" className="h-full overflow-y-auto bg-white text-[#111111]">
      <div className="w-full px-5 pb-8 pt-3 md:px-8 lg:px-10">
        <h1 className="sr-only">Referral packets</h1>
        <div className="min-w-0">
          {packetToolbar}
          {filter.kind !== "work" && filter.kind !== "files" ? filterToolbar : null}
          {loadError && filter.kind !== "files" && filter.kind !== "work" ? (
            <div className="mb-3 flex items-center justify-between gap-3 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-4 py-3 text-[12px] font-semibold text-[#59332d]" role="alert">
              <span>{loadError}</span>
              <button type="button" onClick={() => void loadReferrals()} className="flex h-8 items-center gap-2 px-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#a63d2f]">
                <RefreshCw size={13} /> Retry
              </button>
            </div>
          ) : null}
        </div>
        <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)] md:gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
          <aside className="min-w-0 bg-white pt-0 md:sticky md:top-0 md:self-start">
            <div className="flex gap-1 overflow-x-auto border-b border-[#d9d9d9] pb-2 md:block md:border-b-0 md:pb-0">
            <button
              type="button"
              aria-label="Referral workflow"
              onClick={() => setFilter({ kind: "workflow" })}
              className={`flex h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-left text-[12px] font-black tracking-[0.01em] md:w-full md:border-b-0 md:border-l-[3px] ${
                filter.kind === "workflow" ? "border-[#0f8b73] bg-white text-[#111111] md:pl-[9px]" : "border-transparent text-[#595959] hover:bg-[#fafafa]"
              }`}
            >
              <ListChecks size={15} />
              Workflow
              <span className="ml-2 text-[11px] md:ml-auto">{workflowTotal}</span>
            </button>
            <button
              type="button"
              aria-label="Needs action"
              onClick={() => setFilter({ kind: "work", value: "all_actionable" })}
              className={`flex h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-left text-[12px] font-black tracking-[0.01em] md:mt-1 md:w-full md:border-b-0 md:border-l-[3px] ${
                filter.kind === "work" ? "border-[#0f8b73] bg-white text-[#111111] md:pl-[9px]" : "border-transparent text-[#595959] hover:bg-[#fafafa]"
              }`}
            >
              <CircleAlert size={15} />
              Needs action
              {worklist ? <span className="ml-2 text-[11px] md:ml-auto">{worklist.total}</span> : null}
            </button>
            <button
              type="button"
              aria-label="All packets"
              onClick={() => setFilter({ kind: "all" })}
              className={`flex h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-left text-[12px] font-black tracking-[0.01em] md:mt-1 md:w-full md:border-b-0 md:border-l-[3px] ${
                filter.kind === "all" ? "border-[#0f8b73] bg-white text-[#111111] md:pl-[9px]" : "border-transparent text-[#595959] hover:bg-[#fafafa]"
              }`}
            >
              <FolderOpen size={15} />
              All packets
              <span className="ml-2 text-[11px] md:ml-auto">{allPacketTotal}</span>
            </button>
            <button
              type="button"
              aria-label="All files"
              onClick={() => {
                setFilePage(0);
                setFiles(null);
                setFilter({ kind: "files" });
              }}
              className={`flex h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-left text-[12px] font-black tracking-[0.01em] md:mt-1 md:w-full md:border-b-0 md:border-l-[3px] ${
                filter.kind === "files" ? "border-[#0f8b73] bg-white text-[#111111] md:pl-[9px]" : "border-transparent text-[#595959] hover:bg-[#fafafa]"
              }`}
            >
              <Files size={15} />
              All files
              <span className="ml-2 text-[11px] md:ml-auto">{allFileTotal}</span>
            </button>
            </div>

            <div className="hidden md:block">
            <div className="mt-5 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-[#0c705f]"><Users size={14} /> Community</div>
            <div className="mt-2 space-y-0.5">
              {pipelineCommunities.map((community) => {
                const count = facets.communities.find((entry) => entry.value === community)?.count ?? 0;
                return (
                  <button
                    key={community}
                    type="button"
                    aria-label={`Filter by community ${community}, ${count} packet${count === 1 ? "" : "s"}`}
                    onClick={() => setFilter({ kind: "community", value: community })}
                    className={`flex min-h-8 w-full items-center justify-between px-3 text-left text-[12px] font-black tracking-[0.01em] ${
                      filter.kind === "community" && filter.value === community
                        ? "border-l-[3px] border-[#0f8b73] bg-white pl-[9px] font-black text-[#111111]"
                        : "border-l-[3px] border-transparent text-[#595959] hover:bg-[#fafafa]"
                    }`}
                  >
                    <span>{community}</span>
                    <span className="text-[11px]">{count}</span>
                  </button>
                );
              })}
            </div>

            {tagFacets.length > 0 ? (
              <>
                <div className="mt-5 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-[#0c705f]"><Hash size={14} /> Tags</div>
                <div className="mt-2 space-y-0.5">
                  {visibleTagFacets.map((tag) => (
                    <button
                      key={tag.value}
                      type="button"
                      aria-label={`Filter by tag ${tag.value}, ${tag.count} packet${tag.count === 1 ? "" : "s"}`}
                      onClick={() => setFilter({ kind: "tag", value: tag.value })}
                      className={`flex min-h-8 w-full items-center gap-2 px-3 text-left text-[12px] font-black tracking-[0.01em] ${
                        filter.kind === "tag" && filter.value === tag.value
                          ? "border-l-[3px] border-[#0f8b73] bg-white pl-[9px] text-[#111111]"
                          : "border-l-[3px] border-transparent text-[#595959] hover:bg-[#fafafa]"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">#{tag.value}</span>
                      <span className="text-[11px]">{tag.count}</span>
                    </button>
                  ))}
                  {tagFacets.length > 6 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllTags((expanded) => !expanded)}
                      className="min-h-8 w-full px-3 text-left text-[10px] font-black text-[#0c705f] hover:bg-[#fafafa]"
                    >
                      {showAllTags ? "Show fewer tags" : `Show ${tagFacets.length - 6} more`}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="mt-5 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-[#0c705f]"><CalendarDays size={14} /> Month</div>
            <div className="mt-2 space-y-0.5">
              {monthOptions.map((month) => (
                <button
                  key={month}
                  type="button"
                  aria-label={formatMonthKey(month)}
                  onClick={() => setFilter({ kind: "month", value: month })}
                  className={`flex min-h-8 w-full items-center px-3 text-left text-[12px] font-black tracking-[0.01em] ${
                      filter.kind === "month" && filter.value === month
                      ? "border-l-[3px] border-[#0f8b73] bg-white pl-[9px] font-black text-[#111111]"
                      : "border-l-[3px] border-transparent text-[#595959] hover:bg-[#fafafa]"
                  }`}
                >
                  <span>{formatMonthKey(month)}</span>
                  <span className="ml-auto text-[10px] text-[#737373]">{facets.months.find((entry) => entry.value === month)?.count ?? 0}</span>
                </button>
              ))}
            </div>
            </div>
          </aside>

          <section className="min-w-0 border-b border-[#d9d9d9] bg-white">
            {filter.kind === "workflow" ? (
              <ReferralWorkflowTracker
                referrals={visibleReferrals}
                progressByReferral={progressByReferral}
                loading={isLoading}
                onOpenPacket={onOpenPacket}
              />
            ) : filter.kind === "work" ? (
              <ReferralActionWorklist
                snapshot={worklist}
                selectedBucket={filter.value}
                searchTerm={searchTerm}
                loading={worklistLoading}
                error={worklistError}
                onSelectBucket={(bucket) => setFilter({ kind: "work", value: bucket })}
                onOpenPacket={onOpenPacket}
                onRetry={() => void loadWorklist()}
              />
            ) : filter.kind === "files" ? (
              visibleFiles.length > 0 ? (
                <>
                  <div className="divide-y divide-[#d9d9d9]">
                    {visibleFiles.map((file) => (
                      <div key={file.id} className="flex w-full items-center gap-2 px-5 py-1 hover:bg-[#f7faf9]">
                        <button
                          type="button"
                          onClick={() => onOpenPacket({ id: file.referralId, name: file.referralName, community: file.community })}
                          className="flex min-w-0 flex-1 items-center gap-4 py-3 text-left"
                        >
                        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden border border-[#b8dacf] bg-[#effaf5] text-[#0c705f]">
                          <FileText size={16} />
                          {file.thumbnailUrl ? (
                            <Image
                              src={file.thumbnailUrl}
                              alt=""
                              width={36}
                              height={36}
                              unoptimized
                              className="absolute inset-0 h-full w-full object-cover"
                              onError={(event) => event.currentTarget.classList.add("hidden")}
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-black text-[#111111]">{file.name}</span>
                          <span className="mt-1 block truncate text-[11px] font-normal text-[#737373]">
                            {file.referralName} · {file.community} · {formatMonthKey(getMonthKey(file.uploadedAt))}
                          </span>
                        </span>
                        <span className="hidden text-[11px] font-black text-[#737373] sm:block">{file.category}</span>
                          {!file.previewUrl ? (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#d9d9d9] text-[#111111]">
                              <ArrowRight size={15} />
                            </span>
                          ) : null}
                        </button>
                        {file.previewUrl ? (
                          <button
                            type="button"
                            onClick={() => setPreviewFile(file)}
                            aria-label={`Preview ${file.name}`}
                            title="Preview file"
                            className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#d9d9d9] text-[#111111] hover:border-[#0f8b73] hover:text-[#0f8b73]"
                          >
                            <Eye size={16} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {fileTotal > 100 ? (
                    <div className="flex items-center justify-between border-t border-[#d9d9d9] px-5 py-3">
                      <button
                        type="button"
                        disabled={filePage === 0}
                        onClick={() => {
                          setFiles(null);
                          setFilePage((page) => Math.max(0, page - 1));
                        }}
                        className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]"
                      >
                        Previous
                      </button>
                      <span className="text-[11px] font-normal text-[#737373]">Page {filePage + 1}</span>
                      <button
                        type="button"
                        disabled={!fileNextCursor}
                        onClick={() => {
                          setFiles(null);
                          if (!fileNextCursor) return;
                          setFileCursors((values) => [...values.slice(0, filePage + 1), fileNextCursor]);
                          setFilePage((page) => page + 1);
                        }}
                        className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]"
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                  <div className="px-5 py-16 text-center">
                  <div className="text-[15px] font-black text-[#111111]">
                    {isFileLoading
                      ? "Loading files"
                      : searchTerm.trim()
                        ? "No files match this search"
                        : "No uploaded files yet"}
                  </div>
                </div>
              )
            ) : visibleReferrals.length > 0 ? (
              <>
                <ReferralWorklist referrals={visibleReferrals} onOpenPacket={onOpenPacket} progressByReferral={progressByReferral} />
                {referralTotal > 100 ? (
                  <div className="flex items-center justify-between border-t border-[#d9d9d9] px-5 py-3">
                    <button
                      type="button"
                      disabled={referralPage === 0 || isLoading}
                      onClick={() => setReferralPage((page) => Math.max(0, page - 1))}
                      className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]"
                    >
                      Previous
                    </button>
                    <span className="text-[11px] text-[#737373]">Page {referralPage + 1}</span>
                    <button
                      type="button"
                      disabled={!referralNextCursor || isLoading}
                      onClick={() => {
                        if (!referralNextCursor) return;
                        setReferralCursors((values) => [...values.slice(0, referralPage + 1), referralNextCursor]);
                        setReferralPage((page) => page + 1);
                      }}
                      className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]"
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="px-5 py-16 text-center">
                <div className="text-[15px] font-black text-[#111111]">
                  {isLoading ? "Loading referral packets" : emptyReferralState.title}
                </div>
                {!isLoading ? (
                  <p className="mx-auto mt-2 max-w-[420px] text-[12px] leading-5 text-[#737373]">
                    {emptyReferralState.detail}
                  </p>
                ) : null}
                {!isLoading && filter.kind !== "all" ? (
                  <button
                    type="button"
                    onClick={() => setFilter({ kind: "all" })}
                    className="mt-4 h-9 border border-[#0f8b73] px-3 text-[11px] font-black text-[#0f8b73] hover:bg-[#effaf5]"
                  >
                    Show all packets
                  </button>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
      {previewFile ? <FilePreviewDialog key={previewFile.id} file={previewFile} onClose={() => setPreviewFile(null)} /> : null}
    </main>
  );
}

function FilePreviewDialog({ file, onClose }: { file: ReferralFile; onClose: () => void }) {
  const isLocalPacket = file.id.startsWith("referral-") && Boolean(file.previewUrl);
  const [metadata, setMetadata] = useState<FilePreviewMetadata | null>(null);
  const [cursorHistory, setCursorHistory] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!isLocalPacket);
  const afterPage = cursorHistory[pageIndex] ?? 0;

  useEffect(() => {
    if (isLocalPacket) {
      return;
    }
    const controller = new AbortController();
    fetchPipelineJson<{ file?: FilePreviewMetadata }>(
      `/api/files/${encodeURIComponent(file.id)}?after_page=${afterPage}&limit=24`,
      { cache: "no-store", signal: controller.signal },
    ).then((payload) => {
      if (!payload.file) throw new Error("File metadata was not returned.");
      setMetadata(payload.file);
    }).catch((loadError) => {
      if (!controller.signal.aborted) {
        setMetadata(null);
        setError(loadError instanceof Error ? loadError.message : "The file preview could not be loaded.");
      }
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

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/25" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}>
      <button type="button" aria-label="Close file preview" onClick={onClose} className="absolute inset-0 cursor-default" />
      <section className="relative flex h-full w-full max-w-[920px] flex-col bg-white shadow-2xl">
        <header className="flex min-h-20 items-center gap-4 border-b border-[#d9d9d9] px-5 py-3">
          <FileText size={20} className="shrink-0 text-[#0f8b73]" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-black text-[#111111]">{file.name}</h2>
            <p className="mt-1 text-[11px] text-[#737373]">
              {isLocalPacket
                ? `${file.category} · ${file.sizeBytes === undefined ? "Size unavailable" : formatFileSize(file.sizeBytes)}`
                : metadata
                ? `${formatDocumentCategory(metadata.category)} · ${formatFileSize(metadata.byte_size)} · ${metadata.page_count ?? metadata.pages.length} page${metadata.page_count === 1 ? "" : "s"}`
                : `${file.category} · Loading metadata`}
            </p>
          </div>
          {file.previewUrl ? (
            <a href={file.previewUrl} target="_blank" rel="noreferrer" className="h-9 border border-[#0f8b73] px-3 py-2 text-[10px] font-black text-[#0f8b73] hover:bg-[#effaf5]">
              Open original
            </a>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close preview" title="Close preview" className="flex h-9 w-9 items-center justify-center border border-[#d9d9d9] hover:border-[#111111]">
            <X size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f8f7] p-5">
          {isLocalPacket && file.previewUrl ? (
            <iframe
              src={file.previewUrl}
              title={`Preview ${file.name}`}
              className="h-full min-h-[640px] w-full border-0 bg-white"
            />
          ) : loading ? (
            <div className="py-20 text-center text-[13px] font-black text-[#737373]">Loading page previews</div>
          ) : error ? (
            <div className="border-l-2 border-[#a63d2f] bg-white px-4 py-3 text-[12px] font-semibold text-[#59332d]" role="alert">{error}</div>
          ) : metadata?.pages.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {metadata.pages.map((page) => (
                <a key={page.page_number} href={page.preview_url} target="_blank" rel="noreferrer" className="group bg-white shadow-sm hover:shadow-md">
                  <div className="relative aspect-[8.5/11] overflow-hidden border border-[#d9d9d9] bg-white">
                    <Image
                      src={page.thumbnail_url}
                      alt={`Page ${page.page_number}`}
                      fill
                      unoptimized
                      sizes="(max-width: 640px) 90vw, 280px"
                      className="object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 text-[11px]">
                    <span className="font-black text-[#111111]">Page {page.page_number}</span>
                    <span className="text-[#737373]">{page.byte_size === null ? "Preview" : formatFileSize(page.byte_size)}</span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="bg-white px-5 py-16 text-center">
              <div className="text-[14px] font-black text-[#111111]">Page previews are not ready yet</div>
              <p className="mt-2 text-[12px] text-[#737373]">Safety scanning and page rendering finish separately from the upload.</p>
            </div>
          )}
        </div>

        {metadata && (pageIndex > 0 || metadata.next_page_after !== undefined) ? (
          <footer className="flex items-center justify-between border-t border-[#d9d9d9] bg-white px-5 py-3">
            <button
              type="button"
              disabled={pageIndex === 0}
              onClick={() => {
                setLoading(true);
                setError("");
                setMetadata(null);
                setPageIndex((index) => Math.max(0, index - 1));
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
                setCursorHistory((values) => [...values.slice(0, pageIndex + 1), metadata.next_page_after!]);
                setMetadata(null);
                setPageIndex((index) => index + 1);
              }}
              className="h-8 px-2 text-[11px] font-black text-[#0f8b73] disabled:text-[#b3b3b3]"
            >
              Next pages
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function formatDocumentCategory(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word === "lic" ? "LIC" : word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getMonthKey(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getCreatedMonthOptions() {
  const start = new Date(2026, 5, 1);
  const current = new Date();
  const end = new Date(current.getFullYear(), current.getMonth(), 1);
  const months: string[] = [];

  for (const cursor = new Date(start); cursor <= (end < start ? start : end); cursor.setMonth(cursor.getMonth() + 1)) {
    months.push(getMonthKey(cursor.toISOString()));
  }

  return months.reverse();
}

function getEmptyReferralState(filter: ReferralFilter, searchTerm: string) {
  if (searchTerm.trim()) {
    return {
      title: "No packets match this search",
      detail: "Try a different client, community, stage, owner, or file name.",
    };
  }

  if (filter.kind === "community") {
    return {
      title: `No packets for ${filter.value}`,
      detail: "Choose another community or show all packets.",
    };
  }
  if (filter.kind === "month") {
    return {
      title: `No packets from ${formatMonthKey(filter.value)}`,
      detail: "Choose another month or show all packets.",
    };
  }
  if (filter.kind === "stage") {
    return {
      title: `No packets in ${getStageLabel(filter.value)}`,
      detail: "Choose another stage or show all packets.",
    };
  }
  if (filter.kind === "owner") {
    return {
      title: `No packets assigned to ${filter.value}`,
      detail: "Choose another owner or show all packets.",
    };
  }
  if (filter.kind === "priority") {
    return {
      title: `No ${filter.value} priority packets`,
      detail: "Choose another priority or show all packets.",
    };
  }
  if (filter.kind === "tag") {
    return {
      title: `No packets tagged #${filter.value}`,
      detail: "Choose another tag or show all packets.",
    };
  }
  if (filter.kind === "workflow") {
    return {
      title: "No active referrals",
      detail: "New packets will appear here until an admission decision closes them.",
    };
  }

  return {
    title: "No referral packets yet",
    detail: "Create a packet from an initial face sheet or referral document to get started.",
  };
}

function formatMonthKey(month: string) {
  if (month === "unknown") return "Unknown date";
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
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

function getFilterLabel(filter: ReferralFilter) {
  if (filter.kind === "workflow") return "Referral workflow";
  if (filter.kind === "work") {
    return filter.value === "all_actionable"
      ? "Needs action"
      : referralWorklistCategoryLabel(filter.value);
  }
  if (filter.kind === "files") return "All files";
  if (filter.kind === "community") return filter.value;
  if (filter.kind === "month") return formatMonthKey(filter.value);
  if (filter.kind === "stage") return getStageLabel(filter.value);
  if (filter.kind === "owner") return filter.value;
  if (filter.kind === "priority") return `${filter.value[0].toUpperCase()}${filter.value.slice(1)} priority`;
  if (filter.kind === "tag") return `#${filter.value}`;
  return "All packets";
}

function buildReferralParams(
  filter: ReferralFilter,
  searchTerm: string,
  cursor?: string,
) {
  const params = new URLSearchParams({ limit: "100" });
  const query = searchTerm.trim();
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);

  if (filter.kind === "community") params.set("community", filter.value);
  if (filter.kind === "month") params.set("month", filter.value);
  if (filter.kind === "stage") params.set("stage", filter.value);
  if (filter.kind === "owner") params.set("owner", filter.value);
  if (filter.kind === "priority") params.set("priority", filter.value);
  if (filter.kind === "tag") params.set("tag", filter.value);
  if (filter.kind === "workflow") params.set("active", "true");
  return params;
}

function formatRefreshAge(value: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 10) return "updated now";
  if (seconds < 60) return `updated ${seconds}s ago`;
  return `updated ${Math.floor(seconds / 60)}m ago`;
}
