"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileText,
  Files,
  FolderOpen,
  Check,
  Eye,
  Link2,
  ListChecks,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { pipelineCommunities } from "@/lib/pipeline/community-config";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import type { ClientWorkspaceDirectoryItem } from "@/lib/pipeline/client-workspace-contracts";
import type { ClientFileImportReviewItem } from "@/lib/pipeline/client-file-import-contracts";
import type { ReferralFacets } from "@/lib/pipeline/referral-store";
import type { ReferralSort } from "@/lib/pipeline/referral-sort";
import { isInternalWorkspaceTag, isRecordedWorkspaceCommunity } from "@/lib/pipeline/workspace-presentation";
import {
  formatClientIdentityDetail,
  formatClientIdentityTitle,
  resolveClientCommunity,
  resolveClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import FilePreviewDialog from "@/components/pipeline/ReferralFilePreviewDialog";
import ReferralWorkflowTracker from "@/components/pipeline/ReferralWorkflowTracker";
import ReferralWorklist from "@/components/pipeline/ReferralWorklist";

type ReferralFilter =
  | { kind: "workflow" }
  | { kind: "all" }
  | { kind: "files" }
  | { kind: "community"; value: string }
  | { kind: "monthCommunity"; month: string; community: string }
  | { kind: "county"; value: string }
  | { kind: "month"; value: string }
  | { kind: "owner"; value: string }
  | { kind: "priority"; value: Referral["priority"] }
  | { kind: "tag"; value: string };

const emptyFacets: ReferralFacets = {
  communities: [],
  counties: [],
  stages: [],
  owners: [],
  priorities: [],
  tags: [],
  months: [],
};

const fileCategories: ReferralFile["category"][] = [
  "Referral packet",
  "Face sheet",
  "Assessment",
  "Medication list",
  "TB test",
  "Admission agreement",
  "Conservatorship",
  "LIC 602",
  "LIC 601/603",
  "Provider form",
  "Payer verification",
  "Responsible party",
  "Other",
];

export default function ReferralHome({
  searchTerm,
  onSearchTermChange,
  onOpenPacket,
  onOpenProfile,
}: {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onOpenPacket: (referral?: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenProfile: (canonicalClientId: string) => void;
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
  const [fileCategory, setFileCategory] = useState("");
  const [fileCommunity, setFileCommunity] = useState("");
  const [fileOwner, setFileOwner] = useState("");
  const [fileMonth, setFileMonth] = useState("");
  const [fileSource, setFileSource] = useState("");
  const [reviewIdentity, setReviewIdentity] = useState(false);
  const [importItems, setImportItems] = useState<ClientFileImportReviewItem[] | null>(null);
  const [importTotal, setImportTotal] = useState(0);
  const [reviewItem, setReviewItem] = useState<ClientFileImportReviewItem | null>(null);
  const [filter, setFilter] = useState<ReferralFilter>({ kind: "all" });
  const [sort, setSort] = useState<ReferralSort>("updated_desc");
  const [workflowTotal, setWorkflowTotal] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const workflowRefreshInFlight = useRef(false);
  const referralRevision = useRef(0);
  const summaryQuery = useRef<string | null>(null);
  const successfulReferralRequest = useRef("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [previewFile, setPreviewFile] = useState<ReferralFile | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState("");

  const loadReferrals = useCallback(async (signal?: AbortSignal, background = false) => {
    if (filter.kind === "files") {
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
      const params = buildReferralParams(filter, searchTerm, sort, referralCursors[referralPage]);
      requestKey = params.toString();
      const normalizedSearch = searchTerm.trim();
      const workspaceScope = filter.kind === "workflow" ? "active" : "all";
      const summaryKey = `${workspaceScope}:${normalizedSearch}`;
      const includeSummary = referralPage === 0 && (background || summaryQuery.current !== summaryKey);
      const payload = await fetchPipelineJson<{
        referrals?: Referral[];
        total?: number;
        revision?: number;
        next_cursor?: string;
        progress?: Record<number, ReferralProgress>;
        facets?: ReferralFacets;
        file_total?: number;
      }>(
        `${includeSummary ? "/api/referrals/directory" : "/api/referrals"}?${params.toString()}`,
        { cache: "no-store", signal },
        { cacheTtlMs: background ? 0 : 3_000 },
      );
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
        summaryQuery.current = summaryKey;
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
      setLoadError(error instanceof Error ? error.message : "Referral workspaces could not be loaded.");
    } finally {
      if (background) workflowRefreshInFlight.current = false;
      if (!signal?.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [filter, referralCursors, referralPage, searchTerm, sort]);

  useEffect(() => {
    const controller = new AbortController();
    void loadReferrals(controller.signal);
    return () => controller.abort();
  }, [loadReferrals]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ active: "true", limit: "1", sort: "updated_desc" });
    fetchPipelineJson<{ total?: number }>(`/api/referrals?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    }, { cacheTtlMs: 3_000 }).then((payload) => {
      if (typeof payload.total === "number") setWorkflowTotal(payload.total);
    }).catch(() => {
      // Keep the last known count; opening Current work retries through the normal list request.
    });
    return () => controller.abort();
  }, []);

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
    setReferralPage((current) => current === 0 ? current : 0);
    setReferralCursors((current) => current.length === 1 && current[0] === "" ? current : [""]);
  }, [filter, searchTerm, sort]);

  useEffect(() => {
    if (searchTerm.trim() && filter.kind === "workflow") setFilter({ kind: "all" });
  }, [filter.kind, searchTerm]);

  useEffect(() => {
    if (filter.kind !== "files" || reviewIdentity) return;

    let cancelled = false;
    const params = new URLSearchParams({
      limit: "100",
      q: searchTerm,
      identity_status: "linked",
    });
    if (fileCursors[filePage]) params.set("cursor", fileCursors[filePage]);
    if (fileCategory) params.set("category", fileCategory);
    if (fileCommunity) params.set("community", fileCommunity);
    if (fileOwner) params.set("owner", fileOwner);
    if (fileMonth) {
      const bounds = calendarMonthBounds(fileMonth);
      params.set("uploaded_after", bounds.from);
      params.set("uploaded_before", bounds.to);
    }
    if (fileSource) params.set("source_system", fileSource);

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
  }, [fileCategory, fileCommunity, fileCursors, fileMonth, fileOwner, filePage, fileSource, filter.kind, reviewIdentity, searchTerm]);

  useEffect(() => {
    if (filter.kind !== "files" || !reviewIdentity) return;
    let cancelled = false;
    setImportItems(null);
    const params = new URLSearchParams({ status: "unmatched", limit: "100", q: searchTerm });
    fetchPipelineJson<{ items?: ClientFileImportReviewItem[]; total?: number }>(`/api/files/import-review?${params}`, { cache: "no-store" })
      .then((payload) => {
        if (cancelled) return;
        setImportItems(Array.isArray(payload.items) ? payload.items : []);
        setImportTotal(typeof payload.total === "number" ? payload.total : 0);
      })
      .catch(() => {
        if (!cancelled) {
          setImportItems([]);
          setImportTotal(0);
        }
      });
    return () => { cancelled = true; };
  }, [filter.kind, reviewIdentity, searchTerm]);

  useEffect(() => {
    setFilePage(0);
    setFileCursors([""]);
    setFiles(null);
  }, [fileCategory, fileCommunity, fileMonth, fileOwner, fileSource, filter.kind, reviewIdentity, searchTerm]);

  const monthOptions = useMemo(() => facets.months.map((entry) => entry.value), [facets.months]);
  const ownerOptions = useMemo(() => facets.owners.map((entry) => entry.value), [facets.owners]);
  const recordedCommunityFacets = useMemo(
    () => facets.communities.filter((entry) => isRecordedWorkspaceCommunity(entry.value)),
    [facets.communities],
  );
  const fileOwnerOptions = useMemo(
    () => [...new Set([...ownerOptions, ...(files ?? []).map((file) => file.owner ?? "Unassigned")])].filter(Boolean).sort((left, right) => left.localeCompare(right)),
    [files, ownerOptions],
  );
  const fileMonthOptions = useMemo(() => recentMonthKeys(48), []);
  const tagOptions = useMemo(
    () => facets.tags.map((entry) => entry.value).filter((tag) => !isInternalWorkspaceTag(tag)),
    [facets.tags],
  );
  const activeMonth = referralFilterMonth(filter);
  const activeCommunity = referralFilterCommunity(filter);

  useEffect(() => {
    if (activeMonth) {
      setExpandedMonth(activeMonth);
      return;
    }
    setExpandedMonth((current) => monthOptions.includes(current) ? current : monthOptions[0] ?? "");
  }, [activeMonth, monthOptions]);
  const allPacketTotal = useMemo(
    () => facets.communities.reduce((total, entry) => total + entry.count, 0),
    [facets.communities],
  );
  const isFileLoading = filter.kind === "files" && files === null;
  const visibleFiles = files ?? [];
  const visibleImportItems = importItems ?? [];
  const isImportLoading = filter.kind === "files" && reviewIdentity && importItems === null;

  const visibleReferrals = filter.kind === "files" ? [] : referrals;
  const emptyReferralState = getEmptyReferralState(filter, searchTerm);
  const resultCountLabel = filter.kind === "files"
    ? reviewIdentity
      ? isImportLoading ? "Loading..." : `${formatDirectoryCount(importTotal)} need${importTotal === 1 ? "s" : ""} identity review`
      : isFileLoading
      ? "Loading..."
      : `${formatDirectoryCount(fileTotal)} file${fileTotal === 1 ? "" : "s"}`
    : isLoading
      ? "Loading..."
      : filter.kind === "workflow"
        ? `${formatDirectoryCount(referralTotal)} active referral${referralTotal === 1 ? "" : "s"}`
      : `${formatDirectoryCount(referralTotal)} referral${referralTotal === 1 ? "" : "s"}`;

  const refreshLabel = lastRefreshedAt === null ? "" : formatRefreshAge(lastRefreshedAt);
  const sidebarCommunities = pipelineCommunities
    .filter((community) => isRecordedWorkspaceCommunity(community))
    .map((community) => ({
      name: community,
      count: facets.communities.find((entry) => entry.value === community)?.count ?? 0,
    }));
  const workspaceSearch = (
    <div data-guide-target="workspace-search" className="flex h-11 min-w-0 items-center gap-3 border-b border-[#bdbdbd] px-2 focus-within:border-[#0f8b73] xl:h-10">
      <Search size={16} className="shrink-0 text-[#0f8b73]" />
      <label htmlFor="workspace-directory-search" className="sr-only">{filter.kind === "files" ? "Search all uploaded files" : "Search all workspaces"}</label>
      <input
        id="workspace-directory-search"
        type="search"
        aria-label={filter.kind === "files" ? "Search all uploaded files" : "Search all workspaces"}
        value={searchTerm}
        onChange={(event) => {
          const value = event.target.value;
          onSearchTermChange(value);
          if (value.trim() && filter.kind === "workflow") setFilter({ kind: "all" });
        }}
        placeholder={filter.kind === "files" ? "Search files by name, client, community, owner, or type" : "Search all workspaces by client, community, county, owner, or source"}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-[#111111] outline-none placeholder:text-[#8a8a8a]"
      />
      {searchTerm ? (
        <button
          type="button"
          aria-label="Clear workspace search"
          onClick={() => onSearchTermChange("")}
          className="flex h-8 w-8 shrink-0 items-center justify-center text-[#737373] hover:text-[#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
        >
          <X size={15} />
        </button>
      ) : null}
      <span className="hidden shrink-0 text-[9px] font-bold text-[#737373] md:inline">{resultCountLabel}</span>
      {filter.kind === "workflow" ? (
        <>
          {refreshLabel ? <span className="hidden shrink-0 text-[10px] text-[#595959] xl:inline">{refreshLabel}</span> : null}
          <button
            type="button"
            aria-label="Refresh referral workflow"
            title="Refresh"
            onClick={() => void loadReferrals(undefined, true)}
            disabled={isLoading || isRefreshing}
            className="flex h-8 w-8 shrink-0 items-center justify-center text-[#0c705f] hover:bg-[#effaf5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:text-[#b3b3b3]"
          >
            <RefreshCw size={14} className={isLoading || isRefreshing ? "animate-spin" : ""} />
          </button>
        </>
      ) : null}
    </div>
  );

  const renderReferralFilterControls = () => (
    <>
      <select
        aria-label="Filter workspaces by community"
        value={activeCommunity}
        onChange={(event) => setFilter(referralFilterWithCommunity(filter, event.target.value))}
        className="h-10 min-w-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black text-[#303638] outline-none focus:border-[#0f8b73]"
      >
        <option value="">All communities</option>
        {recordedCommunityFacets.map((community) => <option key={community.value} value={community.value}>{presentCommunity(community.value)}</option>)}
      </select>
      <select
        aria-label="Filter workspaces by county"
        value={filter.kind === "county" ? filter.value : ""}
        onChange={(event) => setFilter(event.target.value ? { kind: "county", value: event.target.value } : { kind: "all" })}
        className="h-10 min-w-0 border border-[#9fcfc2] bg-[#f7fbf9] px-2 text-[12px] font-black text-[#0c705f] outline-none focus:border-[#0f8b73]"
      >
        <option value="">All counties</option>
        {facets.counties.map((county) => <option key={county.value} value={county.value}>{county.value} ({formatDirectoryCount(county.count)})</option>)}
      </select>
      <select
        aria-label="Filter by owner"
        value={filter.kind === "owner" ? filter.value : ""}
        onChange={(event) => setFilter(event.target.value ? { kind: "owner", value: event.target.value } : { kind: "all" })}
        className="h-10 min-w-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black text-[#303638] outline-none focus:border-[#0f8b73]"
      >
        <option value="">All owners</option>
        {ownerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
      </select>
      <select
        aria-label="Filter by priority"
        value={filter.kind === "priority" ? filter.value : ""}
        onChange={(event) => setFilter(event.target.value ? { kind: "priority", value: event.target.value as Referral["priority"] } : { kind: "all" })}
        className="h-10 min-w-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black text-[#303638] outline-none focus:border-[#0f8b73]"
      >
        <option value="">All priorities</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="standard">Standard</option>
      </select>
      <select
        aria-label="Filter by workspace month"
        value={activeMonth}
        onChange={(event) => setFilter(referralFilterWithMonth(filter, event.target.value))}
        className="h-10 min-w-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black text-[#303638] outline-none focus:border-[#0f8b73]"
      >
        <option value="">All workspace months</option>
        {monthOptions.map((month) => (
          <option key={month} value={month}>
            {formatMonthKey(month)} ({formatDirectoryCount(facets.months.find((entry) => entry.value === month)?.count ?? 0)})
          </option>
        ))}
      </select>
      {tagOptions.length > 0 ? (
        <select
          aria-label="Filter by tag"
          value={filter.kind === "tag" ? filter.value : ""}
          onChange={(event) => setFilter(event.target.value ? { kind: "tag", value: event.target.value } : { kind: "all" })}
          className="h-10 min-w-0 border border-[#d9d9d9] bg-white px-2 text-[12px] font-black text-[#303638] outline-none focus:border-[#0f8b73]"
        >
          <option value="">All tags</option>
          {tagOptions.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
        </select>
      ) : null}
      <select
        aria-label="Sort workspaces"
        value={sort}
        onChange={(event) => setSort(event.target.value as ReferralSort)}
        className="h-10 min-w-0 border border-[#88b8aa] bg-white px-2 text-[12px] font-black text-[#0c705f] outline-none focus:border-[#0f8b73]"
      >
        <option value="updated_desc">Recently updated</option>
        <option value="created_desc">Newest created</option>
        <option value="created_asc">Oldest created</option>
        <option value="owner_asc">Owner A-Z</option>
        <option value="community_asc">Community A-Z</option>
        <option value="client_asc">Client A-Z</option>
      </select>
    </>
  );
  const activeFilterCount = referralFilterCount(filter, sort);
  const filterToolbar = (
    <div>
      <button
        type="button"
        aria-expanded={filtersOpen}
        aria-controls="referral-filter-controls"
        onClick={() => setFiltersOpen((open) => !open)}
        className="flex h-11 w-full items-center gap-2 px-2 text-left text-[12px] font-black text-[#303638] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] sm:hidden"
      >
        <SlidersHorizontal size={15} className="text-[#0c705f]" aria-hidden="true" />
        <span className="flex-1">Filters</span>
        {activeFilterCount > 0 ? <span className="flex h-5 min-w-5 items-center justify-center bg-[#0f8b73] px-1 text-[9px] text-white">{activeFilterCount}</span> : null}
        <ChevronDown size={15} className={`text-[#737373] transition-transform ${filtersOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {filtersOpen ? (
        <div id="referral-filter-controls" className="grid grid-cols-1 gap-2 px-2 pb-3 sm:hidden">
          {renderReferralFilterControls()}
        </div>
      ) : null}
      <div className="hidden gap-2 px-2 py-2 sm:grid sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {renderReferralFilterControls()}
      </div>
    </div>
  );

  const fileFilterToolbar = (
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto px-2 py-2 md:py-3">
      <span className="mr-1 shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-[#0c705f]">Files</span>
      <button
        type="button"
        onClick={() => setReviewIdentity(false)}
        className={`h-9 shrink-0 border px-3 text-[11px] font-black ${!reviewIdentity ? "border-[#0f8b73] bg-[#effaf5] text-[#0c705f]" : "border-[#d9d9d9] text-[#595959]"}`}
      >
        Linked files
      </button>
      <button
        type="button"
        onClick={() => setReviewIdentity(true)}
        className={`h-9 shrink-0 border px-3 text-[11px] font-black ${reviewIdentity ? "border-[#b07b21] bg-[#fffaf0] text-[#8a5a10]" : "border-[#d9d9d9] text-[#595959]"}`}
      >
        Needs identity
      </button>
      {!reviewIdentity ? (
        <>
          <select aria-label="Filter files by category" value={fileCategory} onChange={(event) => setFileCategory(event.target.value)} className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]">
            <option value="">All categories</option>
            {fileCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select aria-label="Filter files by community" value={fileCommunity} onChange={(event) => setFileCommunity(event.target.value)} className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]">
            <option value="">All communities</option>
            {pipelineCommunities.map((community) => <option key={community} value={community}>{community}</option>)}
          </select>
          <select aria-label="Filter files by owner" value={fileOwner} onChange={(event) => setFileOwner(event.target.value)} className="h-9 max-w-[160px] shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]">
            <option value="">All owners</option>
            {fileOwnerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
          </select>
          <select aria-label="Filter files by upload month" value={fileMonth} onChange={(event) => setFileMonth(event.target.value)} className="h-9 max-w-[170px] shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]">
            <option value="">All months</option>
            {fileMonthOptions.map((month) => <option key={month} value={month}>{formatMonthKey(month)}</option>)}
          </select>
          <select aria-label="Filter files by source" value={fileSource} onChange={(event) => setFileSource(event.target.value)} className="h-9 shrink-0 border border-[#d9d9d9] bg-white px-2 text-[11px] font-black outline-none focus:border-[#0f8b73]">
            <option value="">All sources</option>
            <option value="pipeline">Pipeline</option>
            <option value="allo">Allo import</option>
            <option value="alamo_platform">Alamo Platform</option>
            <option value="import">Other import</option>
          </select>
          {fileCategory || fileCommunity || fileOwner || fileMonth || fileSource ? (
            <button type="button" onClick={() => { setFileCategory(""); setFileCommunity(""); setFileOwner(""); setFileMonth(""); setFileSource(""); }} className="h-9 shrink-0 px-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#737373] hover:text-[#a63d2f]">Clear</button>
          ) : null}
        </>
      ) : null}
    </div>
  );

  return (
    <main data-guide-target="workspace-directory" aria-label="Referral workspaces" className="h-full overflow-y-auto bg-white text-[#111111]">
      <div className="w-full px-4 pb-8 pt-0 sm:px-5 md:px-6 lg:px-8 xl:px-10">
        <h1 className="sr-only">Referral workspaces</h1>
        <div className="min-w-0">
          {workspaceSearch}
          {filter.kind === "files" ? fileFilterToolbar : filter.kind === "workflow" ? null : filterToolbar}
          {loadError && filter.kind !== "files" ? (
            <div className="mb-3 flex items-center justify-between gap-3 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-4 py-3 text-[12px] font-semibold text-[#59332d]" role="alert">
              <span>{loadError}</span>
              <button type="button" onClick={() => void loadReferrals()} className="flex h-8 items-center gap-2 px-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#a63d2f]">
                <RefreshCw size={13} /> Retry
              </button>
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)] xl:gap-5">
          <aside aria-label="Workspace navigation" className="min-w-0 bg-white pt-0 xl:sticky xl:top-0 xl:self-start">
            <nav
              data-guide-target="workspace-views"
              aria-label="Workspace views"
              className="grid grid-cols-3 gap-2 pb-2 xl:block xl:space-y-1 xl:pb-0"
            >
              <WorkspaceNavItem
                icon={ListChecks}
                label="Current work"
                compactLabel="Work"
                count={workflowTotal}
                active={filter.kind === "workflow"}
                onClick={() => setFilter({ kind: "workflow" })}
              />
              <WorkspaceNavItem
                icon={FolderOpen}
                label="All workspaces"
                compactLabel="All"
                count={allPacketTotal}
                active={filter.kind === "all" || ["community", "monthCommunity", "county", "month", "owner", "priority", "tag"].includes(filter.kind)}
                onClick={() => setFilter({ kind: "all" })}
              />
              <WorkspaceNavItem
                icon={Files}
                label="All files"
                compactLabel="Files"
                count={allFileTotal}
                active={filter.kind === "files"}
                onClick={() => {
                  setFilePage(0);
                  setFiles(null);
                  setReviewIdentity(false);
                  setFilter({ kind: "files" });
                }}
              />
            </nav>
            <button
              type="button"
              aria-label="Browse workspaces by month and community"
              onClick={() => setBrowseOpen(true)}
              className="mt-1 flex h-11 w-full items-center gap-3 border border-[#d9dfdc] bg-[#f8faf9] px-3 text-left text-[#303638] outline-none hover:border-[#9fcfc2] hover:bg-[#f2f8f6] focus-visible:ring-2 focus-visible:ring-[#0f8b73] xl:hidden"
            >
              <CalendarDays size={16} className="shrink-0 text-[#0c705f]" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-black">{referralScopeLabel(filter)}</span>
              <ChevronRight size={15} className="shrink-0 text-[#737373]" aria-hidden="true" />
            </button>

            <div className="mt-5 hidden xl:block">
              <WorkspaceArchiveNavigation
                months={facets.months}
                communities={sidebarCommunities}
                filter={filter}
                expandedMonth={expandedMonth}
                onExpandedMonthChange={setExpandedMonth}
                onFilterChange={setFilter}
              />
            </div>
          </aside>

          <section className="min-w-0 bg-white">
            {filter.kind === "workflow" ? (
              <ReferralWorkflowTracker
                referrals={visibleReferrals}
                progressByReferral={progressByReferral}
                loading={isLoading}
                onOpenPacket={onOpenPacket}
              />
            ) : filter.kind === "files" ? (
              reviewIdentity ? (
                visibleImportItems.length > 0 ? (
                  <div className="divide-y divide-[#d9d9d9]">
                    {visibleImportItems.map((item) => (
                      <div key={item.import_item_id} className="flex items-center gap-4 px-5 py-4 hover:bg-[#fffaf0]">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#e2ca9f] bg-[#fffaf0] text-[#8a5a10]"><Link2 size={16} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-black text-[#111111]">{item.source_file_name}</span>
                          <span className="mt-1 block truncate text-[11px] text-[#737373]">{formatClientIdentityTitle({ name: item.source_client_name, community: item.source_community })}{item.source_community ? ` · ${item.source_community}` : ""} · {item.source_system}</span>
                        </span>
                        <button type="button" onClick={() => setReviewItem(item)} className="h-9 border border-[#b07b21] px-3 text-[10px] font-black text-[#8a5a10] hover:bg-white">Review identity</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-16 text-center">
                    <div className="text-[15px] font-black text-[#111111]">{isImportLoading ? "Loading identity review" : "No files need identity review"}</div>
                    {!isImportLoading ? <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-[#737373]">Staged imports appear here until a person confirms the correct client workspace.</p> : null}
                  </div>
                )
              ) : visibleFiles.length > 0 ? (
                <>
                  <div className="divide-y divide-[#d9d9d9]">
                    {visibleFiles.map((file) => (
                      <div key={file.id} className="flex w-full items-center gap-2 px-5 py-1 hover:bg-[#f7faf9]">
                        <button
                          type="button"
                          onClick={() => {
                            if (!file.id.startsWith("referral-")) setPreviewFile(file);
                            else openFileWorkspace(file, onOpenProfile, onOpenPacket);
                          }}
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
                            {fileMetadata(file)}
                          </span>
                        </span>
                        <span className="hidden text-[11px] font-black text-[#737373] sm:block">{file.category}</span>
                          {file.id.startsWith("referral-") ? (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#d9d9d9] text-[#111111]">
                              <ArrowRight size={15} />
                            </span>
                          ) : <Eye size={16} className="shrink-0 text-[#0f8b73]" />}
                        </button>
                        {!file.id.startsWith("referral-") ? (
                          <button
                            type="button"
                            onClick={() => openFileWorkspace(file, onOpenProfile, onOpenPacket)}
                            aria-label={`Open ${fileClientName(file)} workspace`}
                            title="Open client workspace"
                            className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#d9d9d9] text-[#111111] hover:border-[#0f8b73] hover:text-[#0f8b73]"
                          >
                            <ArrowRight size={16} />
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
                  {isLoading ? "Loading workspaces" : emptyReferralState.title}
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
                    Show all workspaces
                  </button>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
      {previewFile ? <FilePreviewDialog key={previewFile.id} file={previewFile} onClose={() => setPreviewFile(null)} /> : null}
      {reviewItem ? (
        <ImportIdentityReviewDialog
          key={reviewItem.import_item_id}
          item={reviewItem}
          onClose={() => setReviewItem(null)}
          onSaved={() => {
            setImportItems((current) => current?.filter((item) => item.import_item_id !== reviewItem.import_item_id) ?? []);
            setImportTotal((current) => Math.max(0, current - 1));
            setReviewItem(null);
          }}
        />
      ) : null}
      {browseOpen ? (
        <WorkspaceBrowseDialog
          months={facets.months}
          communities={sidebarCommunities}
          filter={filter}
          expandedMonth={expandedMonth}
          onExpandedMonthChange={setExpandedMonth}
          onClose={() => setBrowseOpen(false)}
          onFilterChange={(nextFilter, dismiss) => {
            setFilter(nextFilter);
            if (dismiss) setBrowseOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

function WorkspaceArchiveNavigation({
  months,
  communities,
  filter,
  expandedMonth,
  onExpandedMonthChange,
  onFilterChange,
}: {
  months: ReferralFacets["months"];
  communities: Array<{ name: string; count: number }>;
  filter: ReferralFilter;
  expandedMonth: string;
  onExpandedMonthChange: (month: string) => void;
  onFilterChange: (filter: ReferralFilter, dismiss?: boolean) => void;
}) {
  const selectedMonth = referralFilterMonth(filter);
  const selectedCommunity = referralFilterCommunity(filter);

  return (
    <nav aria-label="Browse workspaces by date and community">
      <div>
        {months.length === 0 ? (
          <div className="px-3 py-4 text-[11px] leading-5 text-[#737373]">Dated workspaces will appear here.</div>
        ) : months.map((month) => {
          const expanded = expandedMonth === month.value;
          const monthSelected = selectedMonth === month.value;
          return (
            <div key={month.value} className="mb-1">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => {
                  onExpandedMonthChange(expanded ? "" : month.value);
                  onFilterChange({ kind: "month", value: month.value });
                }}
                className={`flex h-10 w-full items-center gap-2 border px-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${
                  monthSelected
                    ? "border-[#9fcfc2] bg-[#effaf5] text-[#0c705f]"
                    : "border-transparent text-[#444a47] hover:border-[#e0e5e2] hover:bg-[#f8faf9]"
                }`}
              >
                {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate text-[11px] font-black">{formatMonthKey(month.value)}</span>
                <span className="shrink-0 text-[9px] font-black tabular-nums text-[#595959]">{formatDirectoryCount(month.count)}</span>
              </button>
              {expanded ? (
                <div className="ml-4 border-l border-[#dce3e0] pl-2 pt-1">
                  <button
                    type="button"
                    aria-current={monthSelected && !selectedCommunity ? "page" : undefined}
                    onClick={() => onFilterChange({ kind: "month", value: month.value }, true)}
                    className={`flex min-h-9 w-full items-center px-2 text-left text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${
                      monthSelected && !selectedCommunity ? "bg-[#effaf5] text-[#0c705f]" : "text-[#646b67] hover:bg-[#f8faf9] hover:text-[#202320]"
                    }`}
                  >
                    All communities
                  </button>
                  {communities.map(({ name }) => {
                    const active = monthSelected && selectedCommunity === name;
                    return (
                      <button
                        key={`${month.value}-${name}`}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => onFilterChange({ kind: "monthCommunity", month: month.value, community: name }, true)}
                        className={`flex min-h-9 w-full items-center px-2 text-left text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${
                          active ? "bg-[#effaf5] text-[#0c705f]" : "text-[#646b67] hover:bg-[#f8faf9] hover:text-[#202320]"
                        }`}
                      >
                        <span className="truncate">{presentCommunity(name)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function WorkspaceBrowseDialog({
  months,
  communities,
  filter,
  expandedMonth,
  onExpandedMonthChange,
  onFilterChange,
  onClose,
}: {
  months: ReferralFacets["months"];
  communities: Array<{ name: string; count: number }>;
  filter: ReferralFilter;
  expandedMonth: string;
  onExpandedMonthChange: (month: string) => void;
  onFilterChange: (filter: ReferralFilter, dismiss?: boolean) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex justify-end bg-black/30"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-label="Browse workspaces" className="flex h-[100dvh] w-full max-w-[390px] flex-col border-l border-[#cbd5d1] bg-white shadow-[-16px_0_40px_rgba(20,35,30,0.16)]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#d9dfdc] px-5">
          <div>
            <h2 className="text-[16px] font-black text-[#202320]">Browse workspaces</h2>
            <div className="mt-0.5 text-[10px] text-[#737373]">Choose a month, then a community.</div>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Close referral browser" onClick={onClose} className="flex h-10 w-10 items-center justify-center border border-[#d9dfdc] text-[#595959] hover:border-[#0f8b73] hover:text-[#0f8b73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <WorkspaceArchiveNavigation
            months={months}
            communities={communities}
            filter={filter}
            expandedMonth={expandedMonth}
            onExpandedMonthChange={onExpandedMonthChange}
            onFilterChange={onFilterChange}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}

function WorkspaceNavItem({
  icon: Icon,
  label,
  compactLabel,
  count,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  compactLabel?: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex h-11 min-w-0 items-center gap-2 border px-3 text-left text-[12px] font-black tracking-[0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] max-[479px]:gap-1.5 max-[479px]:px-2 max-[479px]:text-[11px] xl:h-9 xl:w-full ${
        active
          ? "border-[#9fcfc2] bg-[#effaf5] text-[#0c705f]"
          : "border-transparent text-[#595959] hover:border-[#e2e2e2] hover:bg-[#fafafa] hover:text-[#111111]"
      }`}
    >
      <Icon size={16} className="shrink-0 max-[479px]:hidden" />
      <span className="truncate sm:hidden">{compactLabel ?? label}</span>
      <span className="hidden truncate sm:inline">{label}</span>
      {typeof count === "number" ? <span className="ml-auto hidden shrink-0 text-[9px] font-black tabular-nums xl:inline">{formatDirectoryCount(count)}</span> : null}
    </button>
  );
}

function ImportIdentityReviewDialog({
  item,
  onClose,
  onSaved,
}: {
  item: ClientFileImportReviewItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState(formatClientIdentityTitle({ name: item.source_client_name, community: item.source_community }));
  const [clients, setClients] = useState<ClientWorkspaceDirectoryItem[]>([]);
  const [selected, setSelected] = useState<ClientWorkspaceDirectoryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.trim().length < 2) {
      setClients([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchPipelineJson<{ clients?: ClientWorkspaceDirectoryItem[] }>(`/api/profiles/directory?limit=20&q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal })
        .then((payload) => setClients(Array.isArray(payload.clients) ? payload.clients : []))
        .catch((loadError) => {
          if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Client search is unavailable.");
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const save = async (action: "confirm" | "create_client" | "reject") => {
    if (action === "confirm" && !selected) return;
    setSaving(true);
    setError("");
    try {
      await fetchPipelineJson(`/api/files/import-review/${encodeURIComponent(item.import_item_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          if_match: item.version,
          ...(action === "confirm" && selected ? { target_client_id: selected.canonical_client_id } : {}),
        }),
      });
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Identity review could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={`Review identity for ${item.source_file_name}`}>
      <div className="max-h-[88vh] w-full max-w-[720px] overflow-y-auto bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-[#d9d9d9] pb-4">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#8a5a10]">Identity review</div>
            <h2 className="mt-2 truncate text-[20px] font-black text-[#111111]">{item.source_file_name}</h2>
            <p className="mt-1 text-[12px] text-[#737373]">Exported for {formatClientIdentityTitle({ name: item.source_client_name, community: item.source_community })}{item.source_community ? ` · ${item.source_community}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close identity review" className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#d9d9d9]"><X size={16} /></button>
        </div>
        <label className="mt-5 flex h-11 items-center gap-2 border border-[#bdbdbd] px-3 focus-within:border-[#0f8b73]">
          <Search size={15} className="text-[#737373]" />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} aria-label="Find the matching client" placeholder="Find the exact client" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        </label>
        <div className="mt-3 max-h-72 overflow-y-auto border-y border-[#d9d9d9]">
          {clients.map((client) => {
            const active = selected?.canonical_client_id === client.canonical_client_id;
            return (
              <button key={client.canonical_client_id} type="button" onClick={() => setSelected(client)} className={`flex w-full items-center justify-between gap-4 border-b border-[#eeeeee] px-4 py-3 text-left last:border-b-0 ${active ? "bg-[#effaf5]" : "hover:bg-[#f8f8f8]"}`}>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-black" title={formatClientIdentityTitle({ name: client.display_name, gender: client.gender, community: client.current_community || client.community_names[0] })}>{formatClientIdentityTitle({ name: client.display_name, gender: client.gender, community: client.current_community || client.community_names[0] })}</span>
                  <span className="mt-1 block truncate text-[10px] text-[#737373]">{formatClientIdentityDetail(resolveClientGender(client.gender), resolveClientCommunity(client.current_community, client.community_names[0]), client.workspace_origin === "pipeline" ? "Pipeline client workspace" : "Alamo client")}</span>
                </span>
                {active ? <Check size={16} className="shrink-0 text-[#0f8b73]" /> : null}
              </button>
            );
          })}
          {loading ? <div className="px-4 py-5 text-center text-[11px] text-[#737373]">Searching clients...</div> : null}
          {!loading && clients.length === 0 ? <div className="px-4 py-5 text-center text-[11px] text-[#737373]">No matching client workspaces.</div> : null}
        </div>
        {error ? <div className="mt-3 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-3 py-2 text-[11px] text-[#59332d]" role="alert">{error}</div> : null}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button type="button" disabled={saving} onClick={() => void save("reject")} className="h-10 border border-[#a63d2f] px-3 text-[11px] font-black text-[#a63d2f] disabled:opacity-50">Reject import item</button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={saving || Boolean(selected)} onClick={() => void save("create_client")} className="h-10 border border-[#0f8b73] px-3 text-[11px] font-black text-[#0c705f] disabled:border-[#d9d9d9] disabled:text-[#a0a0a0]">Create client workspace</button>
            <button type="button" disabled={!selected || saving} onClick={() => void save("confirm")} className="h-10 bg-[#0f8b73] px-4 text-[11px] font-black text-white disabled:bg-[#d9d9d9]">{saving ? "Saving..." : "Confirm client"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}


function getMonthKey(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const directoryCountFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatDirectoryCount(value: number) {
  return directoryCountFormatter.format(value);
}

function presentCommunity(value?: string | null) {
  return isRecordedWorkspaceCommunity(value) ? value!.trim() : "";
}

function fileMetadata(file: ReferralFile) {
  return [
    fileClientName(file),
    presentCommunity(file.community),
    file.owner || "Unassigned",
    formatMonthKey(getMonthKey(file.uploadedAt)),
  ].filter(Boolean).join(" · ");
}

function openFileWorkspace(
  file: ReferralFile,
  onOpenProfile: (canonicalClientId: string) => void,
  onOpenPacket: (referral?: Pick<Referral, "id" | "name" | "community">) => void,
) {
  if (file.canonicalClientId) {
    onOpenProfile(file.canonicalClientId);
  } else if (file.referralId && file.community) {
    onOpenPacket({ id: file.referralId, name: fileClientName(file), community: file.community });
  } else if (file.clientId) {
    onOpenProfile(`pipeline:${file.clientId}`);
  }
}

function fileClientName(file: Pick<ReferralFile, "referralName" | "community">) {
  return formatClientIdentityTitle({ name: file.referralName, community: file.community });
}

function referralFilterMonth(filter: ReferralFilter) {
  if (filter.kind === "month") return filter.value;
  if (filter.kind === "monthCommunity") return filter.month;
  return "";
}

function referralFilterCommunity(filter: ReferralFilter) {
  if (filter.kind === "community") return filter.value;
  if (filter.kind === "monthCommunity") return filter.community;
  return "";
}

function referralFilterWithMonth(filter: ReferralFilter, month: string): ReferralFilter {
  const community = referralFilterCommunity(filter);
  if (!month) return community ? { kind: "community", value: community } : { kind: "all" };
  return community ? { kind: "monthCommunity", month, community } : { kind: "month", value: month };
}

function referralFilterWithCommunity(filter: ReferralFilter, community: string): ReferralFilter {
  const month = referralFilterMonth(filter);
  if (!community) return month ? { kind: "month", value: month } : { kind: "all" };
  return month ? { kind: "monthCommunity", month, community } : { kind: "community", value: community };
}

function referralScopeLabel(filter: ReferralFilter) {
  if (filter.kind === "monthCommunity") {
    return `${formatMonthKey(filter.month)} · ${presentCommunity(filter.community)}`;
  }
  if (filter.kind === "month") return formatMonthKey(filter.value);
  if (filter.kind === "community") return `All months · ${presentCommunity(filter.value)}`;
  return "Browse by month and community";
}

function referralFilterCount(filter: ReferralFilter, sort: ReferralSort) {
  const scopeCount = filter.kind === "monthCommunity"
    ? 2
    : ["all", "workflow", "files"].includes(filter.kind) ? 0 : 1;
  return scopeCount + (sort === "updated_desc" ? 0 : 1);
}

function getEmptyReferralState(filter: ReferralFilter, searchTerm: string) {
  if (searchTerm.trim()) {
    return {
      title: "No workspaces match this search",
      detail: "Try a different client, community, owner, or file name.",
    };
  }

  if (filter.kind === "monthCommunity") {
    return {
      title: `No workspaces for ${presentCommunity(filter.community)} in ${formatMonthKey(filter.month)}`,
      detail: "Choose another community, month, or show all workspaces.",
    };
  }
  if (filter.kind === "community") {
    return {
      title: `No workspaces for ${presentCommunity(filter.value)}`,
      detail: "Choose another community or show all workspaces.",
    };
  }
  if (filter.kind === "county") {
    return {
      title: `No workspaces from ${filter.value}`,
      detail: "Choose another county or show all workspaces.",
    };
  }
  if (filter.kind === "month") {
    return {
      title: `No workspaces from ${formatMonthKey(filter.value)}`,
      detail: "Choose another month or show all workspaces.",
    };
  }
  if (filter.kind === "owner") {
    return {
      title: `No workspaces assigned to ${filter.value}`,
      detail: "Choose another owner or show all workspaces.",
    };
  }
  if (filter.kind === "priority") {
    return {
      title: `No ${filter.value} priority workspaces`,
      detail: "Choose another priority or show all workspaces.",
    };
  }
  if (filter.kind === "tag") {
    return {
      title: `No workspaces tagged #${filter.value}`,
      detail: "Choose another tag or show all workspaces.",
    };
  }
  if (filter.kind === "workflow") {
    return {
      title: "No active workspaces",
      detail: "New referral workspaces remain here while intake or assessment work is active.",
    };
  }

  return {
    title: "No workspaces yet",
    detail: "Create a referral workspace from an initial face sheet or referral packet to get started.",
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

function recentMonthKeys(count: number) {
  const start = new Date();
  start.setUTCDate(1);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCMonth(date.getUTCMonth() - index);
    return date.toISOString().slice(0, 7);
  });
}

function calendarMonthBounds(month: string) {
  const first = new Date(`${month}-01T00:00:00.000Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  return { from: `${month}-01`, to: last.toISOString().slice(0, 10) };
}

function buildReferralParams(
  filter: ReferralFilter,
  searchTerm: string,
  sort: ReferralSort,
  cursor?: string,
) {
  const params = new URLSearchParams({ limit: "100", sort });
  const query = searchTerm.trim();
  if (query) {
    params.set("q", query);
    params.set("workspace", "all");
  }
  if (cursor) params.set("cursor", cursor);

  if (filter.kind === "community") params.set("community", filter.value);
  if (filter.kind === "monthCommunity") {
    params.set("month", filter.month);
    params.set("community", filter.community);
  }
  if (filter.kind === "county") params.set("county", filter.value);
  if (filter.kind === "month") params.set("month", filter.value);
  if (filter.kind === "owner") params.set("owner", filter.value);
  if (filter.kind === "priority") params.set("priority", filter.value);
  if (filter.kind === "tag") params.set("tag", filter.value);
  if (filter.kind === "workflow" && !query) params.set("active", "true");
  else if (filter.kind !== "files") params.set("workspace", "all");
  return params;
}

function formatRefreshAge(value: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 10) return "updated now";
  if (seconds < 60) return `updated ${seconds}s ago`;
  return `updated ${Math.floor(seconds / 60)}m ago`;
}
