"use client";
import { pipelineSurfaceReady } from "@/lib/observability/browser-performance-contract";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  FileText,
  FolderOpen,
  MapPin,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import type {
  ClinicalFreshness,
} from "@/lib/clinical/clinical-contracts";
import type { ClientWorkspaceDirectoryItem } from "@/lib/pipeline/client-workspace-contracts";
import {
  formatClientIdentityTitle,
  presentClientCommunity,
  resolveClientCommunity,
  resolveClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import { fetchCurrentPipelineUser, fetchPipelineJson, readPipelineJsonCache, getPipelineClientCacheGeneration } from "@/lib/auth/authenticated-fetch";
import { readCachedPipelineSessionUser } from "@/lib/auth/browser-session";
import PipelineArcadeLoader from "@/components/pipeline/PipelineArcadeLoader";
import FeedbackCue from "@/components/pipeline/FeedbackCue";
import { cancelPipelineWarmup, prefetchPipelineProfile } from "@/lib/pipeline/client-navigation";
import styles from "./ClientFolder.module.css";

type DirectoryClient = ClientWorkspaceDirectoryItem;

type ClientDirectoryPayload = {
  clients: DirectoryClient[];
  total: number;
  next_cursor: string | null;
  data_as_of: string;
  freshness: ClinicalFreshness;
};

type AdmissionFilter = "any" | "last_30_days" | "last_3_months" | "last_6_months" | "last_12_months" | "older_than_12_months" | "missing";
type SortOption = "name" | "community" | "recent_admission" | "pipeline_activity";
type CommunityOption = { id: string; name: string };

const PAGE_SIZE = 200;
const DISPLAY_INCREMENT = 100;
const MAX_DIRECTORY_PAGES = 50;
const DIRECTORY_CACHE_TTL_MS = 120_000;
const MAX_DIRECTORY_CACHE_ENTRIES = 8;

type DirectoryCacheEntry = ClientDirectoryPayload & {
  cached_at: number;
  generation: number;
};

const directoryCache = new Map<string, DirectoryCacheEntry>();
let directoryRefreshVersion = 0;

export default function ClientProfileDirectory({
  onOpenProfile,
}: {
  onOpenProfile: (residentKey: string) => void;
}) {
  const [initialDirectory] = useState(readInitialDirectory);
  const [clients, setClients] = useState<DirectoryClient[]>(() => initialDirectory?.clients ?? []);
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(() => initialDirectory?.total ?? 0);
  const [dataAsOf, setDataAsOf] = useState(() => initialDirectory?.data_as_of ?? "");
  const [freshness, setFreshness] = useState<ClinicalFreshness | null>(() => initialDirectory?.freshness ?? null);
  const [isLoading, setIsLoading] = useState(!initialDirectory);
  const [isCompletingRoster, setIsCompletingRoster] = useState(false);
  const [, setDirectoryComplete] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_INCREMENT);
  const [knownCommunities, setKnownCommunities] = useState<CommunityOption[]>(() => collectCommunities(initialDirectory?.clients ?? []));
  const [communityFilter, setCommunityFilter] = useState("");
  const [admissionFilter, setAdmissionFilter] = useState<AdmissionFilter>("any");
  const [sort, setSort] = useState<SortOption>("name");
  const loadedQuery = useRef("");
  const forceReload = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const generation = getPipelineClientCacheGeneration();
    const normalizedQuery = query.trim();
    const timeout = window.setTimeout(() => {
      let loadedFirstPage = false;
      setIsLoading(needsDirectoryLoading(loadedQuery.current, normalizedQuery, initialDirectory));
      setIsCompletingRoster(false);
      setDirectoryComplete(false);
      setError("");
      setDisplayLimit(DISPLAY_INCREMENT);
      if (loadedQuery.current !== normalizedQuery) setClients([]);

      void (async () => {
        try {
          const identity = await fetchCurrentPipelineUser();
          assertDirectoryContext(controller.signal, generation);
          const cacheKey = directoryCacheKey(identity.user?.id ?? identity.user?.email, normalizedQuery);
          const bypassCache = forceReload.current;
          forceReload.current = false;
          if (bypassCache) {
            directoryRefreshVersion += 1;
            directoryCache.delete(cacheKey);
          }
          const cached = bypassCache ? null : readDirectoryCache(cacheKey);
          if (cached) {
            applyDirectoryPayload(cached);
            loadedQuery.current = normalizedQuery;
            setDirectoryComplete(true);
            setIsLoading(false);
            return;
          }

          const payload = await fetchCompleteClientDirectory(normalizedQuery, controller.signal, bypassCache, generation, (partial) => {
            loadedFirstPage = true;
            setClients(partial.clients);
            setTotal(partial.total);
            setDataAsOf(partial.data_as_of);
            setFreshness(partial.freshness);
            if (!normalizedQuery) setKnownCommunities(collectCommunities(partial.clients));
            setIsLoading(false);
            setIsCompletingRoster(Boolean(partial.next_cursor));
            loadedQuery.current = normalizedQuery;
          });
          setDirectoryComplete(true);
          writeDirectoryCache(cacheKey, payload, generation);
        } catch (loadError) {
          if (controller.signal.aborted) return;
          setDirectoryComplete(false);
          setError(
            loadedFirstPage
              ? "The first client page loaded, but the complete directory could not be retrieved. Refresh before applying filters."
              : loadError instanceof Error
                ? loadError.message
                : "The enhanced client directory is unavailable.",
          );
          if (!loadedFirstPage) {
            setClients([]);
            setTotal(0);
            setFreshness(null);
          }
        } finally {
          if (!controller.signal.aborted) {
            setIsLoading(false);
            setIsCompletingRoster(false);
          }
        }
      })();
    }, normalizedQuery ? 40 : 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, reloadKey, initialDirectory]);

  const applyDirectoryPayload = (payload: ClientDirectoryPayload) => {
    setClients(payload.clients);
    setTotal(payload.total);
    setDataAsOf(payload.data_as_of);
    setFreshness(payload.freshness);
    setKnownCommunities(collectCommunities(payload.clients));
  };

  const filteredClients = useMemo(() => clients
    .filter((client) => {
      if (communityFilter && !client.community_names.includes(communityFilter)) return false;
      if (admissionFilter !== "any" && !matchesAdmissionFilter(client.admit_date, admissionFilter, dataAsOf)) return false;
      return true;
    })
    .sort((left, right) => compareDirectoryClients(left, right, sort)), [
      admissionFilter,
      clients,
      communityFilter,
      dataAsOf,
      sort,
    ]);
  const visibleClients = filteredClients.slice(0, displayLimit);
  const hasDirectoryFilters = Boolean(communityFilter) || admissionFilter !== "any";
  const hasAppliedFilters = hasDirectoryFilters || Boolean(query.trim());
  const countLabel = isLoading && clients.length === 0
    ? "Loading clients..."
    : isCompletingRoster
      ? `${clients.length} of ${total} loaded`
      : hasAppliedFilters
        ? `${filteredClients.length} matching`
        : `${total} client${total === 1 ? "" : "s"}`;
  const directoryNotice = freshness?.status === "stale"
    ? "Live census information may be out of date. Referral records are still available while the source refreshes."
    : freshness?.warning
      ? "Live census information is temporarily unavailable. Referral records remain available."
      : "";

  const clearFilters = () => {
    setCommunityFilter("");
    setAdmissionFilter("any");
    setSort("name");
    setDisplayLimit(DISPLAY_INCREMENT);
  };

  return (
    <main data-guide-target="client-directory" data-performance-ready={pipelineSurfaceReady("profiles", isLoading, error)} aria-label="Client profiles" className="h-full overflow-y-auto bg-white text-[#111111]">
      <div data-testid="profiles-workspace" className="mx-auto w-full max-w-[1800px] px-4 pb-12 pt-4 sm:px-6 lg:px-8">
        <section aria-label="Find clients" className="pb-1">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search clients</span>
              <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#68716d]" />
              <input
                aria-label="Search clients"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, resident number, or community"
                className="h-12 w-full border border-[#aeb8b4] bg-white pl-12 pr-12 text-[15px] outline-none placeholder:text-[#7d8581] focus:border-[#0f8b73] focus:ring-1 focus:ring-[#0f8b73]"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear client search"
                  title="Clear search"
                  onClick={() => setQuery("")}
                  className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-[#65706b] hover:text-[#0f8b73] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#0f8b73]"
                >
                  <X size={17} />
                </button>
              ) : null}
            </label>

            <div className="flex min-h-10 items-center justify-between gap-3 lg:justify-end">
              <div aria-live="polite" className="relative text-[12px] font-semibold tabular-nums text-[#5f6864]">{countLabel}<FeedbackCue value={`${communityFilter}:${admissionFilter}:${sort}:${displayLimit}`} /></div>
              {dataAsOf ? <div className="hidden border-l border-[#d8ddda] pl-3 text-[11px] text-[#69716c] sm:block">Data through <strong className="font-bold text-[#343c38]">{formatDate(dataAsOf)}</strong></div> : null}
              <button
                type="button"
                aria-label="Refresh client directory"
                title="Refresh client directory"
                onClick={() => {
                  forceReload.current = true;
                  setReloadKey((current) => current + 1);
                }}
                disabled={isLoading || isCompletingRoster}
                className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#ccd3d0] text-[#0f8b73] hover:border-[#0f8b73] hover:bg-[#f2f8f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] disabled:cursor-wait disabled:text-[#aab1ae]"
              >
                <RefreshCw size={16} className={isLoading || isCompletingRoster ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

        </section>

        <section aria-label="Client filters" className="grid grid-cols-2 gap-2 border-b border-[#e1e5e3] py-3 lg:grid-cols-[1.15fr_1fr_0.9fr_auto]">
          <DirectorySelect label="Community" active={Boolean(communityFilter)} icon={<MapPin size={14} />}>
            <select
              aria-label="Filter profiles by community"
              value={communityFilter}
              onChange={(event) => {
                setCommunityFilter(event.target.value);
                setDisplayLimit(DISPLAY_INCREMENT);
              }}
            >
              <option value="">All communities</option>
              {knownCommunities.map((community) => <option key={community.id} value={community.id}>{presentClientCommunity(community.name)}</option>)}
            </select>
          </DirectorySelect>
          <DirectorySelect label="Admitted" active={admissionFilter !== "any"} icon={<CalendarDays size={14} />}>
            <select aria-label="Filter profiles by admission date" value={admissionFilter} onChange={(event) => { setAdmissionFilter(event.target.value as AdmissionFilter); setDisplayLimit(DISPLAY_INCREMENT); }}>
              <option value="any">Any date</option>
              <option value="last_30_days">Last 30 days</option>
              <option value="last_3_months">Last 3 months</option>
              <option value="last_6_months">Last 6 months</option>
              <option value="last_12_months">Last 12 months</option>
              <option value="older_than_12_months">More than 12 months ago</option>
              <option value="missing">Date unavailable</option>
            </select>
          </DirectorySelect>
          <DirectorySelect label="Sort" active={sort !== "name"} icon={<ArrowUpDown size={14} />}>
            <select aria-label="Sort clients" value={sort} onChange={(event) => { setSort(event.target.value as SortOption); setDisplayLimit(DISPLAY_INCREMENT); }}>
              <option value="name">Name A-Z</option>
              <option value="community">Community</option>
              <option value="recent_admission">Recently admitted</option>
              <option value="pipeline_activity">Most Pipeline activity</option>
            </select>
          </DirectorySelect>
          {hasAppliedFilters || sort !== "name" ? (
            <button
              type="button"
              onClick={clearFilters}
              className="col-span-2 h-9 justify-self-end px-2 text-[11px] font-black text-[#59635e] hover:text-[#a63d2f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] lg:col-span-1 lg:h-[50px] lg:justify-self-auto lg:px-3"
            >
              Reset
            </button>
          ) : null}
        </section>

        {isCompletingRoster ? <div className="flex items-center gap-2 border-b border-[#e4e8e6] py-2 text-[11px] text-[#66706b]" role="status"><RefreshCw size={12} className="animate-spin text-[#0f8b73]" /> Completing the directory. Results update as records arrive.</div> : null}
        {directoryNotice ? <DirectoryNotice>{directoryNotice}</DirectoryNotice> : null}
        {error ? <DirectoryError message={error} onRetry={() => setReloadKey((current) => current + 1)} hasPartialResults={clients.length > 0} /> : null}

        <section aria-label="Client list" className="pt-6 sm:pt-8">
          {isLoading && clients.length === 0 ? <RosterSkeleton /> : null}
          {visibleClients.length > 0 ? (
            <div role="list" className="grid gap-x-8 gap-y-8 lg:grid-cols-2 lg:gap-y-10">
              {visibleClients.map((client) => (
                <div role="listitem" key={client.profile_key ?? client.canonical_client_id} className="min-w-0">
                  <ClientDirectoryCard client={client} onOpen={() => onOpenProfile(client.profile_key ?? client.canonical_client_id)} />
                </div>
              ))}
            </div>
          ) : null}

          {!isLoading && !error && filteredClients.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="text-[16px] font-black text-[#252c29]">{emptyRosterMessage(query, hasDirectoryFilters)}</div>
              <p className="mx-auto mt-2 max-w-[430px] text-[12px] leading-5 text-[#6b746f]">Try a broader name, remove a filter, or refresh the directory if the client was recently added.</p>
              {hasAppliedFilters ? <button type="button" onClick={clearFilters} className="mt-4 h-10 border border-[#0f8b73] px-4 text-[11px] font-black text-[#0f8b73] hover:bg-[#f1f8f5]">Reset directory</button> : null}
            </div>
          ) : null}
        </section>

        {visibleClients.length < filteredClients.length ? (
          <div className="flex items-center justify-between py-5">
            <span className="relative text-[11px] text-[#717a76]">Showing {visibleClients.length} of {filteredClients.length}<FeedbackCue value={displayLimit} /></span>
            <button type="button" onClick={() => setDisplayLimit((current) => current + DISPLAY_INCREMENT)} className="flex h-10 items-center gap-2 border border-[#afb9b5] px-4 text-[11px] font-black text-[#37403c] hover:border-[#0f8b73] hover:text-[#0f8b73]"><ChevronDown size={14} /> Show more</button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function directoryCacheKey(userId: string | undefined, query: string) {
  return `${(userId ?? "unknown-user").trim().toLowerCase()}\n${query.trim().toLowerCase()}`;
}

function readDirectoryCache(key: string) {
  const now = Date.now();
  for (const [candidateKey, entry] of directoryCache) {
    if (entry.generation !== getPipelineClientCacheGeneration() || now - entry.cached_at > DIRECTORY_CACHE_TTL_MS) directoryCache.delete(candidateKey);
  }
  const entry = directoryCache.get(key);
  if (!entry) return null;
  directoryCache.delete(key);
  directoryCache.set(key, entry);
  return entry;
}

function readInitialDirectory() {
  const user = readCachedPipelineSessionUser();
  if (!user) return undefined;
  return readDirectoryCache(directoryCacheKey(user.id ?? user.email, ""))
    ?? readPipelineJsonCache<ClientDirectoryPayload>("/api/profiles/directory?limit=200&scope=current");
}

function needsDirectoryLoading(previousQuery: string, query: string, initial: ClientDirectoryPayload | null | undefined) {
  return previousQuery !== query || !initial;
}

function writeDirectoryCache(key: string, payload: ClientDirectoryPayload, generation: number) {
  if (generation !== getPipelineClientCacheGeneration()) return;
  directoryCache.delete(key);
  directoryCache.set(key, { ...payload, cached_at: Date.now(), generation: getPipelineClientCacheGeneration() });
  while (directoryCache.size > MAX_DIRECTORY_CACHE_ENTRIES) {
    const oldest = directoryCache.keys().next().value;
    if (typeof oldest !== "string") break;
    directoryCache.delete(oldest);
  }
}

// Login and the visible directory use the same page walker and protected GET
// cache. Opening Clients during preload joins those reads instead of restarting.
export async function preloadCurrentClientDirectory(signal: AbortSignal) {
  const generation = getPipelineClientCacheGeneration();
  const { user } = await fetchCurrentPipelineUser();
  assertDirectoryContext(signal, generation);
  const key = directoryCacheKey(user.id ?? user.email, "");
  if (readDirectoryCache(key)) return;
  const payload = await fetchCompleteClientDirectory("", signal, false, generation);
  writeDirectoryCache(key, payload, generation);
}

function assertDirectoryContext(signal: AbortSignal, generation: number, refreshVersion = directoryRefreshVersion) {
  signal.throwIfAborted();
  if (generation !== getPipelineClientCacheGeneration() || refreshVersion !== directoryRefreshVersion) {
    throw new DOMException("Directory access context changed.", "AbortError");
  }
}

async function fetchCompleteClientDirectory(
  query: string,
  signal: AbortSignal,
  refresh: boolean,
  generation: number,
  onPage?: (payload: ClientDirectoryPayload) => void,
): Promise<ClientDirectoryPayload> {
  const refreshVersion = directoryRefreshVersion;
  let cursor: string | null = null;
  let first: ClientDirectoryPayload | undefined;
  let clients: DirectoryClient[] = [];
  const seenCursors = new Set<string>();
  for (let page = 0; page < MAX_DIRECTORY_PAGES; page += 1) {
    assertDirectoryContext(signal, generation, refreshVersion);
    const payload = await fetchClientPage(query, cursor, signal, refresh);
    assertDirectoryContext(signal, generation, refreshVersion);
    first ??= payload;
    if (payload.total !== first.total || payload.data_as_of !== first.data_as_of) {
      throw new Error("The census changed while loading. Refresh the client directory.");
    }
    clients = mergeClients(clients, payload.clients ?? []);
    cursor = payload.next_cursor ?? null;
    const merged = { ...first, clients, next_cursor: cursor };
    onPage?.(merged);
    if (!cursor) {
      if (clients.length < first.total) throw new Error("The client directory stopped before every client was loaded. Refresh before searching or filtering the full roster.");
      return merged;
    }
    if (seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
  }
  throw new Error("The client directory exceeded its safe pagination limit.");
}

function DirectorySelect({
  label,
  active,
  icon,
  children,
}: {
  label: string;
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <label data-filter-active={active} className="pipeline-directory-select relative flex h-[50px] min-w-0 items-center border border-[#c9d0cd] bg-white text-[#27302c] data-[filter-active=true]:border-[#0f8b73] data-[filter-active=true]:bg-[#f4faf7] focus-within:border-[#0f8b73] focus-within:ring-1 focus-within:ring-[#0f8b73]">
      <span className="pointer-events-none absolute left-3 top-2 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.06em] text-[#66706b]">{icon}{label}</span>
      <span className="min-w-0 flex-1 [&>select]:h-full [&>select]:w-full [&>select]:appearance-none [&>select]:bg-transparent [&>select]:pb-1 [&>select]:pl-3 [&>select]:pr-9 [&>select]:pt-5 [&>select]:text-[12px] [&>select]:font-bold [&>select]:outline-none">{children}</span>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-[#66706b]" />
    </label>
  );
}

function DirectoryNotice({ children }: { children: ReactNode }) {
  return <div role="status" className="flex items-start gap-2 border-b border-[#e2d3af] py-3 text-[12px] leading-5 text-[#684d1d]"><CircleAlert size={15} className="mt-0.5 shrink-0 text-[#9a6b17]" />{children}</div>;
}

function DirectoryError({ message, onRetry, hasPartialResults }: { message: string; onRetry: () => void; hasPartialResults: boolean }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-4 border-b border-[#e7c8c2] py-3 text-[12px] leading-5 text-[#713e35]">
      <div><strong>{hasPartialResults ? "Some clients could not be loaded." : "The client directory could not be loaded."}</strong> {message}</div>
      <button type="button" onClick={onRetry} className="shrink-0 font-black text-[#0c705f] hover:underline">Retry</button>
    </div>
  );
}

function ClientDirectoryCard({ client, onOpen }: { client: DirectoryClient; onOpen: () => void }) {
  const identityTitle = formatClientIdentityTitle({
    name: client.display_name,
    gender: client.gender,
    community: client.current_community || client.community_names[0],
  });
  const gender = resolveClientGender(client.gender);
  const community = resolveClientCommunity(client.current_community, client.community_names[0]);

  return (
    <button
      type="button"
      aria-label={`Open profile for ${identityTitle}`}
      onClick={onOpen}
      onPointerEnter={() => prefetchPipelineProfile(client.profile_key ?? client.canonical_client_id)}
      onFocus={() => prefetchPipelineProfile(client.profile_key ?? client.canonical_client_id)}
      onPointerLeave={cancelPipelineWarmup}
      onBlur={cancelPipelineWarmup}
      className={styles.folder}
    >
      <strong className={styles.tab}><span className={styles.tabLabel}>{identityTitle}</span></strong>
      <span className={styles.body}>
        <span className={styles.paper}>
          <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[#d8e1da] bg-[#f1f7f3] px-4 py-3">
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="border-l-[3px] border-[#0f8b73] pl-2.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#0c705f]">Client chart</span>
              {gender ? <span className="text-[12px] font-medium text-[#59635d]">{gender}</span> : null}
            </span>
            <span aria-hidden="true" className={styles.open}>Open chart <ArrowRight size={16} strokeWidth={2.5} /></span>
          </span>
          <span className="grid grid-cols-2 gap-px bg-[#dde3de]">
            <ChartPreviewCell label="Community" value={community} />
            <ChartPreviewCell label="Unit" value={client.unit ? `Unit ${client.unit}` : null} />
            <ChartPreviewCell label="Admitted" value={client.admit_date ? formatDate(client.admit_date) : null} />
            <ChartPreviewCell label="Care level" value={client.care_level} />
          </span>
          {!client.profile_key ? <span className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#dde3de] px-4 py-2.5 text-[11px] font-medium tabular-nums text-[#626e67]">
            <span className="flex items-center gap-1.5"><FileText size={12} className="shrink-0" />{countNoun(client.document_count, "document")}</span>
            <span className="flex items-center gap-1.5"><FolderOpen size={12} className="shrink-0" />{countNoun(client.referral_count, "workspace")}</span>
            <span className="ml-auto">{countNoun(client.episode_count, "stay")}</span>
          </span> : null}
        </span>
      </span>
    </button>
  );
}

function ChartPreviewCell({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="min-w-0 bg-white px-4 py-3.5">
      <span className="block text-[10px] font-bold uppercase tracking-[0.07em] text-[#59685f]">{label}</span>
      <span className={`mt-1.5 block text-[14px] leading-5 [overflow-wrap:anywhere] ${value ? "font-semibold text-[#25382e]" : "font-medium text-[#69736e]"}`}>{value || "—"}</span>
    </span>
  );
}

function countNoun(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function RosterSkeleton() {
  return (
    <div className="flex min-h-[360px] items-center justify-center bg-white px-5 py-12">
      <PipelineArcadeLoader label="Loading clients" />
    </div>
  );
}

async function fetchClientPage(query: string, cursor: string | null, signal: AbortSignal, refresh = false) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), scope: "current" });
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  return fetchPipelineJson<ClientDirectoryPayload>(`/api/profiles/directory?${params}`, {
    cache: "no-store",
    signal,
    ...(refresh ? { headers: { "x-pipeline-refresh": "1" } } : {}),
  }, { cacheTtlMs: 60_000, bypassCache: refresh });
}

function collectCommunities(clients: DirectoryClient[]) {
  const communities = new Set<string>();
  for (const client of clients) {
    for (const community of client.community_names) {
      const resolved = resolveClientCommunity(community);
      if (resolved) communities.add(resolved);
    }
  }
  return [...communities]
    .map((name) => ({ id: name, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function mergeClients(current: DirectoryClient[], incoming: DirectoryClient[]) {
  const merged = new Map(current.map((client) => [client.profile_key ?? client.canonical_client_id, client]));
  for (const client of incoming) merged.set(client.profile_key ?? client.canonical_client_id, client);
  return [...merged.values()];
}

function matchesAdmissionFilter(admitDate: string | null, filter: AdmissionFilter, dataAsOf: string) {
  if (filter === "missing") return !admitDate;
  if (!admitDate || !dataAsOf || !isIsoDate(admitDate) || !isIsoDate(dataAsOf)) return false;
  if (admitDate > dataAsOf) return false;
  if (filter === "last_30_days") return admitDate >= daysBefore(dataAsOf, 30);
  const monthCount = filter === "last_3_months" ? 3 : filter === "last_6_months" ? 6 : 12;
  const threshold = monthsBefore(dataAsOf, monthCount);
  return filter === "older_than_12_months" ? admitDate < threshold : admitDate >= threshold;
}

function compareDirectoryClients(left: DirectoryClient, right: DirectoryClient, sort: SortOption) {
  const byName = left.display_name.localeCompare(right.display_name, "en", { sensitivity: "base" });
  if (sort === "community") {
    const leftCommunity = resolveClientCommunity(left.current_community, left.community_names[0]);
    const rightCommunity = resolveClientCommunity(right.current_community, right.community_names[0]);
    if (!leftCommunity && rightCommunity) return 1;
    if (leftCommunity && !rightCommunity) return -1;
    return (leftCommunity ?? "").localeCompare(rightCommunity ?? "", "en", { sensitivity: "base" }) || byName;
  }
  if (sort === "recent_admission") {
    return (right.admit_date ?? "").localeCompare(left.admit_date ?? "") || byName;
  }
  if (sort === "pipeline_activity") {
    const leftActivity = left.referral_count + left.document_count;
    const rightActivity = right.referral_count + right.document_count;
    return rightActivity - leftActivity || byName;
  }
  return byName;
}

function monthsBefore(value: string, months: number) {
  const [year, month, day] = value.split("-").map(Number);
  const monthIndex = year * 12 + month - 1 - months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function daysBefore(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function emptyRosterMessage(query: string, hasDirectoryFilters: boolean) {
  if (query.trim() && hasDirectoryFilters) return "No clients match that search and those filters.";
  if (query.trim()) return "No clients match that search.";
  if (hasDirectoryFilters) return "No clients match these filters.";
  return "The client directory is empty.";
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
