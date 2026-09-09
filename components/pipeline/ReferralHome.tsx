"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";

import { ReferralHomeDirectory } from "@/components/pipeline/ReferralHomeDirectory";
import FilePreviewDialog from "@/components/pipeline/ReferralFilePreviewDialog";
import {
  buildReferralParams,
  calendarMonthBounds,
  directoryLoadingLabel,
  formatDirectoryCount,
  recentMonthKeys,
  referralFilterMonth,
} from "@/components/pipeline/referral-home-directory-model";
import type { ReferralFilter, WorkspaceLayout, WorkspaceSection } from "@/components/pipeline/referral-home-directory-model";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ClientFileImportReviewItem } from "@/lib/pipeline/client-file-import-contracts";
import {
  formatClientIdentityDetail,
  formatClientIdentityTitle,
  resolveClientCommunity,
  resolveClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import type { ClientWorkspaceDirectoryItem } from "@/lib/pipeline/client-workspace-contracts";
import { pipelineCommunities } from "@/lib/pipeline/community-config";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import type { ReferralFacets } from "@/lib/pipeline/referral-store";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import { isRecordedWorkspaceCommunity } from "@/lib/pipeline/workspace-presentation";

const workspaceLayoutStorageKey = "pipeline:workspace-layout";
const workspaceSearchSettleMs = 180;

const emptyFacets: ReferralFacets = {
  communities: [],
  counties: [],
  stages: [],
  owners: [],
  priorities: [],
  tags: [],
  months: [],
};

export default function ReferralHome({
  searchTerm,
  onSearchTermChange,
  onOpenPacket,
  onOpenProfile,
  onResumeDraft,
  canViewTeam = false,
}: {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onOpenPacket: (referral?: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenProfile: (canonicalClientId: string) => void;
  onResumeDraft: (draftKey: `new-${string}`) => void;
  canViewTeam?: boolean;
}) {
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>("workspaces");
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>("list");
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
  const summaryQuery = useRef<string | null>(null);
  const successfulReferralRequest = useRef("");
  const referralRevision = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [previewFile, setPreviewFile] = useState<ReferralFile | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState("");
  const [requestSearchTerm, setRequestSearchTerm] = useState(searchTerm);

  useEffect(() => {
    const timeout = window.setTimeout(() => setRequestSearchTerm(searchTerm), workspaceSearchSettleMs);
    return () => window.clearTimeout(timeout);
  }, [searchTerm]);

  useEffect(() => {
    const saved = window.localStorage.getItem(workspaceLayoutStorageKey);
    if (saved === "list" || saved === "gallery") setWorkspaceLayout(saved);
  }, []);

  const selectWorkspaceLayout = (layout: WorkspaceLayout) => {
    setWorkspaceLayout(layout);
    window.localStorage.setItem(workspaceLayoutStorageKey, layout);
  };

  const loadReferrals = useCallback(async (signal?: AbortSignal, silent = false) => {
    if (filter.kind === "files") {
      setIsLoading(false);
      return;
    }
    if (!silent) setIsLoading(true);
    setLoadError("");
    let requestKey = "";
    try {
      const params = buildReferralParams(filter, requestSearchTerm, referralCursors[referralPage]);
      requestKey = params.toString();
      const normalizedSearch = requestSearchTerm.trim();
      const summaryKey = `all:${normalizedSearch}`;
      const includeSummary = referralPage === 0 && summaryQuery.current !== summaryKey;
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
        { cacheTtlMs: 3_000 },
      );
      setReferrals(Array.isArray(payload.referrals) ? payload.referrals : []);
      setProgressByReferral(payload.progress ?? {});
      setReferralTotal(typeof payload.total === "number" ? payload.total : 0);
      setReferralNextCursor(payload.next_cursor);
      if (typeof payload.revision === "number") referralRevision.current = payload.revision;
      if (includeSummary) {
        setFacets(payload.facets ?? emptyFacets);
        setAllFileTotal(typeof payload.file_total === "number" ? payload.file_total : 0);
        summaryQuery.current = summaryKey;
      }
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
      if (!signal?.aborted && !silent) setIsLoading(false);
    }
  }, [filter, referralCursors, referralPage, requestSearchTerm]);

  useEffect(() => {
    const controller = new AbortController();
    void loadReferrals(controller.signal);
    return () => controller.abort();
  }, [loadReferrals]);

  useEffect(() => {
    if (filter.kind === "files") return;
    let cancelled = false;
    let checking = false;
    const checkForChanges = async () => {
      const after = referralRevision.current;
      if (cancelled || checking || after === null) return;
      checking = true;
      try {
        const payload = await fetchPipelineJson<{ changed: boolean; sequence: number }>(`/api/referrals/changes?after=${after}`, { cache: "no-store" });
        if (cancelled) return;
        referralRevision.current = payload.sequence;
        if (payload.changed) {
          summaryQuery.current = null;
          await loadReferrals(undefined, true);
        }
      } catch {
        // The next revision check retries without disturbing the current directory.
      } finally {
        checking = false;
      }
    };
    const refreshOnFocus = () => void checkForChanges();
    const interval = window.setInterval(checkForChanges, 10_000);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [filter.kind, loadReferrals]);

  useEffect(() => {
    setReferralPage((current) => current === 0 ? current : 0);
    setReferralCursors((current) => current.length === 1 && current[0] === "" ? current : [""]);
  }, [filter, requestSearchTerm]);

  useEffect(() => {
    if (filter.kind !== "files" || reviewIdentity) return;
    let cancelled = false;
    const params = new URLSearchParams({ limit: "100", q: requestSearchTerm, identity_status: "linked" });
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
      .then((payload) => {
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
      });
    return () => { cancelled = true; };
  }, [fileCategory, fileCommunity, fileCursors, fileMonth, fileOwner, filePage, fileSource, filter.kind, requestSearchTerm, reviewIdentity]);

  useEffect(() => {
    if (filter.kind !== "files" || !reviewIdentity) return;
    let cancelled = false;
    setImportItems(null);
    const params = new URLSearchParams({ status: "unmatched", limit: "100", q: requestSearchTerm });
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
  }, [filter.kind, requestSearchTerm, reviewIdentity]);

  useEffect(() => {
    setFilePage(0);
    setFileCursors([""]);
    setFiles(null);
  }, [fileCategory, fileCommunity, fileMonth, fileOwner, fileSource, filter.kind, requestSearchTerm, reviewIdentity]);

  const monthOptions = useMemo(() => facets.months.map((entry) => entry.value), [facets.months]);
  const ownerOptions = useMemo(() => facets.owners.map((entry) => entry.value), [facets.owners]);
  const recordedCommunityFacets = useMemo(() => facets.communities.filter((entry) => isRecordedWorkspaceCommunity(entry.value)), [facets.communities]);
  const fileOwnerOptions = useMemo(() => [...new Set([...ownerOptions, ...(files ?? []).map((file) => file.owner ?? "Unassigned")])].filter(Boolean).sort((left, right) => left.localeCompare(right)), [files, ownerOptions]);
  const fileMonthOptions = useMemo(() => recentMonthKeys(48), []);
  const activeMonth = referralFilterMonth(filter);

  useEffect(() => {
    if (activeMonth) {
      setExpandedMonth(activeMonth);
      return;
    }
    setExpandedMonth((current) => monthOptions.includes(current) ? current : monthOptions[0] ?? "");
  }, [activeMonth, monthOptions]);

  const allPacketTotal = useMemo(() => facets.months.reduce((total, entry) => total + entry.count, 0), [facets.months]);
  const isFileLoading = filter.kind === "files" && files === null;
  const visibleFiles = files ?? [];
  const visibleImportItems = importItems ?? [];
  const isImportLoading = filter.kind === "files" && reviewIdentity && importItems === null;
  const workspaceLoading = isLoading || requestSearchTerm !== searchTerm;
  const visibleReferrals = filter.kind === "files" ? [] : referrals;
  const resultCountLabel = filter.kind === "files"
    ? reviewIdentity
      ? isImportLoading ? "Loading..." : `${formatDirectoryCount(importTotal)} need${importTotal === 1 ? "s" : ""} identity review`
      : isFileLoading ? "Loading..." : `${formatDirectoryCount(fileTotal)} file${fileTotal === 1 ? "" : "s"}`
    : workspaceLoading ? "Loading..." : `${formatDirectoryCount(referralTotal)} referral${referralTotal === 1 ? "" : "s"}`;
  const sidebarCommunities = pipelineCommunities
    .filter((community) => isRecordedWorkspaceCommunity(community))
    .map((community) => ({ name: community, count: facets.communities.find((entry) => entry.value === community)?.count ?? 0 }));

  const selectFilter = (nextFilter: ReferralFilter) => {
    if (nextFilter.kind === "files" && filter.kind !== "files") {
      setFilePage(0);
      setFiles(null);
      setReviewIdentity(false);
    }
    setFilter(nextFilter);
  };

  return (
    <ReferralHomeDirectory
      searchTerm={searchTerm}
      onSearchTermChange={onSearchTermChange}
      onOpenPacket={onOpenPacket}
      onOpenProfile={onOpenProfile}
      onResumeDraft={onResumeDraft}
      canViewTeam={canViewTeam}
      workspaceSection={workspaceSection}
      onWorkspaceSectionChange={setWorkspaceSection}
      workspaceLayout={workspaceLayout}
      onWorkspaceLayoutChange={selectWorkspaceLayout}
      filter={filter}
      onFilterChange={selectFilter}
      onShowFiles={() => {
        setFilePage(0);
        setFiles(null);
        setReviewIdentity(false);
        setFilter({ kind: "files" });
      }}
      facets={facets}
      recordedCommunityFacets={recordedCommunityFacets}
      ownerOptions={ownerOptions}
      fileOwnerOptions={fileOwnerOptions}
      fileMonthOptions={fileMonthOptions}
      allPacketTotal={allPacketTotal}
      allFileTotal={allFileTotal}
      reviewIdentity={reviewIdentity}
      onReviewIdentityChange={setReviewIdentity}
      fileCategory={fileCategory}
      onFileCategoryChange={setFileCategory}
      fileCommunity={fileCommunity}
      onFileCommunityChange={setFileCommunity}
      fileOwner={fileOwner}
      onFileOwnerChange={setFileOwner}
      fileMonth={fileMonth}
      onFileMonthChange={setFileMonth}
      fileSource={fileSource}
      onFileSourceChange={setFileSource}
      onClearFileFilters={() => { setFileCategory(""); setFileCommunity(""); setFileOwner(""); setFileMonth(""); setFileSource(""); }}
      visibleReferrals={visibleReferrals}
      progressByReferral={progressByReferral}
      visibleFiles={visibleFiles}
      visibleImportItems={visibleImportItems}
      isImportLoading={isImportLoading}
      isFileLoading={isFileLoading}
      workspaceLoading={workspaceLoading}
      resultCountLabel={resultCountLabel}
      loadingLabel={directoryLoadingLabel(filter)}
      loadError={loadError}
      onRetry={() => void loadReferrals()}
      referralPage={referralPage}
      referralNextCursor={referralNextCursor}
      isLoading={isLoading}
      onReferralPrevious={() => setReferralPage((page) => Math.max(0, page - 1))}
      onReferralNext={() => {
        if (!referralNextCursor) return;
        setReferralCursors((values) => [...values.slice(0, referralPage + 1), referralNextCursor]);
        setReferralPage((page) => page + 1);
      }}
      fileTotal={fileTotal}
      filePage={filePage}
      fileNextCursor={fileNextCursor}
      onFilePrevious={() => { setFiles(null); setFilePage((page) => Math.max(0, page - 1)); }}
      onFileNext={() => {
        setFiles(null);
        if (!fileNextCursor) return;
        setFileCursors((values) => [...values.slice(0, filePage + 1), fileNextCursor]);
        setFilePage((page) => page + 1);
      }}
      browseOpen={browseOpen}
      onBrowseOpenChange={setBrowseOpen}
      filtersOpen={filtersOpen}
      onFiltersOpenChange={setFiltersOpen}
      expandedMonth={expandedMonth}
      onExpandedMonthChange={setExpandedMonth}
      sidebarCommunities={sidebarCommunities}
      onReviewItem={setReviewItem}
      onPreviewFile={setPreviewFile}
      previewDialog={previewFile ? <FilePreviewDialog key={previewFile.id} file={previewFile} onClose={() => setPreviewFile(null)} /> : null}
      reviewDialog={reviewItem ? (
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
    />
  );
}

function ImportIdentityReviewDialog({ item, onClose, onSaved }: {
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
