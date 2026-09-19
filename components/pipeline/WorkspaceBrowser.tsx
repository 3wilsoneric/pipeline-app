"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FolderOpen, Search, SlidersHorizontal, X } from "lucide-react";
import HomeDialog from "./HomeDialog";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { ReferralFacets } from "@/lib/pipeline/referral-store";
import { referralReceivedDate } from "@/lib/pipeline/referral-sort";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { getStageLabel, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import { workflowStatusLabels } from "@/lib/pipeline/workflow-status";
import styles from "./WorkspaceBrowser.module.css";

type WorkspaceFile = Pick<Referral, "id" | "name" | "community" | "owner" | "date" | "createdAt" | "stage" | "workflowStatus" | "workspaceStatus">;
type PageResult = { referrals: WorkspaceFile[]; total: number; next_cursor?: string };

export default function WorkspaceBrowser({ open, onClose, onOpenWorkspace, onOpenTrash }: {
  open: boolean;
  onClose: () => void;
  onOpenWorkspace: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenTrash: () => void;
}) {
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [sort, setSort] = useState("received_desc");
  const [initial, setInitial] = useState("");
  const [community, setCommunity] = useState("");
  const [owner, setOwner] = useState("");
  const [stage, setStage] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [facets, setFacets] = useState<ReferralFacets | null>(null);
  const [result, setResult] = useState<PageResult>({ referrals: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const scrollTop = useRef(0);
  const request = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const resultKey = useRef("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(query.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPipelineJson<{ facets: ReferralFacets }>("/api/referrals/facets?workspace=all", { signal: controller.signal })
      .then((payload) => setFacets(payload.facets)).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const params = useMemo(() => {
    const value = new URLSearchParams({ scope: "team", workspace: "all", projection: "summary", limit: "50", sort });
    if (settledQuery) value.set("q", settledQuery);
    if (community) value.set("community", community);
    if (owner) value.set("owner", owner);
    if (stage) value.set("stage", stage);
    if (sort === "client_asc" && initial) value.set("initial", initial);
    return value.toString();
  }, [settledQuery, community, owner, stage, sort, initial]);

  const load = useCallback(async (cursor?: string) => {
    if (cursor && pending.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    pending.current = true;
    setLoading(true);
    setError("");
    if (!cursor) {
      setResult({ referrals: [], total: 0 });
      if (scroller.current) scroller.current.scrollTop = 0;
      scrollTop.current = 0;
    }
    const pageParams = new URLSearchParams(params);
    if (cursor) pageParams.set("cursor", cursor);
    try {
      const payload = await fetchPipelineJson<PageResult>(`/api/referrals?${pageParams}`, { signal: controller.signal, cache: "no-store" });
      if (controller.signal.aborted) return;
      resultKey.current = params;
      setResult((current) => ({ ...payload, referrals: cursor
        ? [...current.referrals, ...payload.referrals.filter((file) => !current.referrals.some((existing) => existing.id === file.id))]
        : payload.referrals }));
    } catch {
      if (!controller.signal.aborted) setError(cursor ? "More workspaces could not be loaded. Your results are still here." : "Workspaces could not be loaded. Try again.");
    } finally {
      if (!controller.signal.aborted) { pending.current = false; setLoading(false); }
    }
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; request.current?.abort(); pending.current = false; };
  }, [load, retry]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (scroller.current) scroller.current.scrollTop = scrollTop.current;
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      else if (window.matchMedia("(min-width: 640px) and (pointer: fine)").matches) searchInput.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const hasMore = Boolean(result.next_cursor);
  useEffect(() => {
    if (!open || loading || error || !hasMore || resultKey.current !== params || query.trim() !== settledQuery) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void load(result.next_cursor);
    }, { root: scroller.current, rootMargin: "160px" });
    const target = sentinel.current;
    if (target) observer.observe(target);
    return () => observer.disconnect();
  }, [open, loading, error, hasMore, params, query, settledQuery, load, result.next_cursor]);

  const filterCount = [community, owner, stage, initial].filter(Boolean).length;
  const clear = () => { setQuery(""); setInitial(""); setCommunity(""); setOwner(""); setStage(""); };
  const files = result.referrals;

  return <HomeDialog className={styles.dialog} open={open} label="All workspaces" title="All workspaces" description="All owners · all dates · active and completed" size="browser" onClose={onClose}>
    <div className={styles.toolbar}>
      <div className={styles.searchRow}>
        <label className={styles.search}>
          <Search size={18} aria-hidden="true" />
          <input ref={searchInput} type="search" aria-label="Find any workspace" placeholder="Find a client, community, assessor…" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} />
          {query ? <button type="button" aria-label="Clear workspace search" onClick={() => setQuery("")}><X size={16} /></button> : null}
        </label>
        <select aria-label="Sort all workspaces" value={sort} onChange={(event) => { setSort(event.target.value); setInitial(""); }}>
          <option value="received_desc">Newest received</option><option value="client_asc">Name A–Z</option>
        </select>
        <button type="button" className={styles.filterButton} aria-expanded={filtersOpen} aria-controls="workspace-browser-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} />Filters{filterCount > 0 ? ` (${filterCount})` : ""}</button>
      </div>
      {filtersOpen ? <div id="workspace-browser-filters" className={styles.filters}>
        <select aria-label="Workspace community" value={community} onChange={(event) => setCommunity(event.target.value)}><option value="">All communities</option>{facets?.communities.map(({ value, count }) => <option key={value} value={value}>{value} ({count})</option>)}</select>
        <select aria-label="Workspace assessor" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">All assessors</option>{facets?.owners.map(({ value, count }) => <option key={value} value={value}>{value} ({count})</option>)}</select>
        <select aria-label="Workspace stage" value={stage} onChange={(event) => setStage(event.target.value)}><option value="">All stages</option>{facets?.stages.map(({ value, count }) => <option key={value} value={value}>{getStageLabel(value as ReferralStage)} ({count})</option>)}</select>
      </div> : null}
      {sort === "client_asc" ? <nav aria-label="Workspace name index" className={styles.alphabet}>{["", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => <button type="button" key={letter} aria-label={letter ? `Names beginning with ${letter}` : "All names"} aria-pressed={initial === letter} onClick={() => setInitial(letter)}>{letter || "All"}</button>)}</nav> : null}
      <div className={styles.resultBar}>
        <span role="status">{loading && !files.length ? "Loading workspaces…" : error && !files.length ? "Search unavailable" : `${result.total.toLocaleString()} workspace${result.total === 1 ? "" : "s"}${files.length < result.total ? ` · ${files.length} shown` : ""}`}</span>
        {filterCount || query ? <button type="button" onClick={clear}>Clear search & filters</button> : null}
        <button type="button" className={styles.refresh} onClick={() => setRetry((value) => value + 1)}>Refresh</button>
      </div>
    </div>
    <div ref={scroller} data-workspace-browser-scroll className={styles.scroller} onScroll={(event) => { scrollTop.current = event.currentTarget.scrollTop; }}>
      <div className={styles.files} role="list" aria-label="Workspace files">
        {files.map((file) => <div role="listitem" key={file.id}>
          <button type="button" className={styles.file} aria-label={`Open workspace for ${file.name}`} onClick={(event) => { opener.current = event.currentTarget; onOpenWorkspace(file); }}>
            <span className={styles.tab}><FolderOpen size={15} aria-hidden="true" /><strong>{file.name}</strong><span>#{file.id}</span></span>
            <span className={styles.paper}>
              <span className={styles.identity}><span>{file.community}</span><span>Assessor: {file.owner || "Unassigned"}</span></span>
              <span className={styles.status}>{file.workflowStatus ? workflowStatusLabels[file.workflowStatus] : getStageLabel(file.stage)}{file.workspaceStatus === "historical" ? " · Historical" : file.workspaceStatus === "archived" ? " · Archived" : ""}</span>
              <span className={styles.date}>Received {formatProfileDate(referralReceivedDate(file))}</span><ArrowRight className={styles.arrow} size={17} aria-hidden="true" />
            </span>
          </button>
        </div>)}
      </div>
      {error ? <div role="status" className={styles.empty}><p>{error}</p><button type="button" onClick={() => void load(files.length ? result.next_cursor : undefined)}>Retry</button></div> : !loading && !files.length ? <div className={styles.empty}><FolderOpen size={28} aria-hidden="true" /><h3>No matching workspaces</h3><p>Try part of a name, clear the filters, or check Trash for a deleted workspace.</p><button type="button" onClick={clear}>Clear search & filters</button><button type="button" onClick={onOpenTrash}>Check Trash</button></div> : null}
      <div ref={sentinel} className={styles.more}>{loading ? <span role="status">Loading…</span> : hasMore && !error ? <button type="button" onClick={() => void load(result.next_cursor)}>Load more workspaces</button> : null}</div>
    </div>
    <footer className={styles.footer}><span>Open a file to work on it. Assignments stay the same.</span><button type="button" onClick={onOpenTrash}>Trash</button></footer>
  </HomeDialog>;
}
