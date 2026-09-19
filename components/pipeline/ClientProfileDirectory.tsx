"use client";
import { pipelineSurfaceReady } from "@/lib/observability/browser-performance-contract";

import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CircleAlert,
  FileText,
  FolderOpen,
  LayoutGrid,
  List,
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
  resolveClientCommunity,
  resolveClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import { fetchCurrentPipelineUser, fetchPipelineJson, readPipelineJsonCache, getPipelineClientCacheGeneration, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import { readCachedPipelineSessionUser } from "@/lib/auth/browser-session";
import PipelineArcadeLoader from "@/components/pipeline/PipelineArcadeLoader";
import FeedbackCue from "@/components/pipeline/FeedbackCue";
import { cancelPipelineWarmup, prefetchPipelineProfile } from "@/lib/pipeline/client-navigation";
import { openClientChart } from "./client-chart-transition";
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
type SortOption = "name" | "recent_admission" | "pipeline_activity";
type DirectoryLayout = "cards" | "list";

const directoryLayoutStorageKey = "pipeline:client-directory-layout";
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
  const dataGeneration = usePipelineDataGeneration();
  const loadedGeneration = useRef(dataGeneration);
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
  const [admissionFilter, setAdmissionFilter] = useState<AdmissionFilter>("any");
  const [sort, setSort] = useState<SortOption>("name");
  const [layout, setLayout] = useState<DirectoryLayout>("cards");
  const [openCabinet, setOpenCabinet] = useState<{ community: string; origin: DOMRect } | null>(null);
  const cabinetRef = useRef<HTMLElement>(null);
  const cabinetOpener = useRef<HTMLButtonElement | null>(null);
  const directorySearchRef = useRef<HTMLInputElement>(null);
  const loadedQuery = useRef("");
  const forceReload = useRef(false);

  useLayoutEffect(() => {
    if (!openCabinet) {
      if (cabinetOpener.current) {
        const target = cabinetOpener.current.isConnected ? cabinetOpener.current : directorySearchRef.current;
        target?.focus({ preventScroll: true });
      }
      return;
    }
    const cabinet = cabinetRef.current;
    if (!cabinet) return;
    cabinet.focus({ preventScroll: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = cabinet.getBoundingClientRect();
    const origin = openCabinet.origin;
    const x = origin.x + origin.width / 2 - bounds.x - bounds.width / 2;
    const y = origin.y + origin.height / 2 - bounds.y - bounds.height / 2;
    const animation = cabinet.animate([
      { transform: `translate(${x}px, ${y}px) scale(${origin.width / bounds.width}, ${origin.height / bounds.height})`, opacity: 0.65 },
      { transform: "none", opacity: 1 },
    ], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
    return () => animation.cancel();
  }, [openCabinet]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(directoryLayoutStorageKey);
      if (saved === "cards" || saved === "list") setLayout(saved);
    } catch { /* Storage may be blocked; the view toggle still works for this visit. */ }
  }, []);

  const selectLayout = (next: DirectoryLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(directoryLayoutStorageKey, next);
    } catch { /* Layout persistence is optional and contains no client data. */ }
  };

  useEffect(() => {
    const controller = new AbortController();
    const generation = getPipelineClientCacheGeneration();
    const dataChanged = loadedGeneration.current !== dataGeneration;
    const normalizedQuery = query.trim();
    const timeout = window.setTimeout(() => {
      let loadedFirstPage = false;
      setIsLoading(needsDirectoryLoading(loadedQuery.current, normalizedQuery, initialDirectory));
      setIsCompletingRoster(false);
      setDirectoryComplete(false);
      setError("");
      if (loadedQuery.current !== normalizedQuery) setDisplayLimit(DISPLAY_INCREMENT);
      if (loadedQuery.current !== normalizedQuery) setClients([]);

      void (async () => {
        try {
          const identity = await fetchCurrentPipelineUser();
          assertDirectoryContext(controller.signal, generation);
          const cacheKey = directoryCacheKey(identity.user?.id ?? identity.user?.email, normalizedQuery);
          const bypassCache = forceReload.current || dataChanged;
          forceReload.current = false;
          if (bypassCache) {
            directoryRefreshVersion += 1;
            directoryCache.delete(cacheKey);
          }
          const cached = bypassCache ? null : readDirectoryCache(cacheKey);
          if (cached) {
            applyDirectoryPayload(cached);
            loadedGeneration.current = dataGeneration;
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
            setIsLoading(false);
            setIsCompletingRoster(Boolean(partial.next_cursor));
            loadedQuery.current = normalizedQuery;
          });
          setDirectoryComplete(true);
          writeDirectoryCache(cacheKey, payload, generation);
          loadedGeneration.current = dataGeneration;
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
  }, [query, reloadKey, initialDirectory, dataGeneration]);

  const applyDirectoryPayload = (payload: ClientDirectoryPayload) => {
    setClients(payload.clients);
    setTotal(payload.total);
    setDataAsOf(payload.data_as_of);
    setFreshness(payload.freshness);
  };

  // The shared directory API also matches IDs and communities. Keep this UI
  // name-only after its existing page walker has collected those results.
  const nameQuery = query.trim().toLowerCase();
  const matchingClients = useMemo(() => clients.filter((client) =>
    client.display_name.toLowerCase().includes(nameQuery),
  ).sort((left, right) => compareDirectoryClients(left, right, "name")), [clients, nameQuery]);
  const communityBoxes = useMemo(() => {
    const boxes = new Map<string, DirectoryClient[]>();
    for (const client of matchingClients) {
      const community = resolveClientCommunity(client.current_community, ...client.community_names) ?? "Community not listed";
      const box = boxes.get(community) ?? [];
      box.push(client);
      boxes.set(community, box);
    }
    return [...boxes].sort(([left], [right]) => left.localeCompare(right, "en"));
  }, [matchingClients]);
  const cabinetClients = (communityBoxes.find(([community]) => community === openCabinet?.community)?.[1] ?? [])
    .filter((client) => admissionFilter === "any" || matchesAdmissionFilter(client.admit_date, admissionFilter, dataAsOf))
    .sort((left, right) => compareDirectoryClients(left, right, sort));
  const visibleClients = cabinetClients.slice(0, displayLimit);
  const hasCabinetFilters = admissionFilter !== "any" || sort !== "name";
  const countLabel = isLoading && clients.length === 0
    ? "Loading clients..."
    : isCompletingRoster
      ? nameQuery ? "Searching client names..." : `${clients.length} of ${total} loaded`
      : nameQuery
        ? countNoun(matchingClients.length, "matching file")
        : `${total} client${total === 1 ? "" : "s"}`;
  const directoryNotice = freshness?.status === "stale"
    ? "Live census information may be out of date. Referral records are still available while the source refreshes."
    : freshness?.warning
      ? "Live census information is temporarily unavailable. Referral records remain available."
      : "";

  const clearFilters = () => {
    setAdmissionFilter("any");
    setSort("name");
    setDisplayLimit(DISPLAY_INCREMENT);
  };

  return (
    <main data-guide-target="client-directory" data-performance-ready={pipelineSurfaceReady("profiles", isLoading, error)} aria-label="Client profiles" className={`${styles.directoryShell} ${openCabinet ? "overflow-hidden" : "overflow-y-auto"}`}>
      <div hidden={Boolean(openCabinet)} data-testid="profiles-workspace" className={styles.directoryWorkspace}>
        <section aria-label="Find clients" className={styles.directoryToolbar}>
            <div className={styles.cabinetTitle}><h1>Client files</h1><span aria-live="polite">{countLabel}</span></div>
            <label className={styles.cabinetSearch}>
              <span className="sr-only">Search clients</span>
              <Search size={18} aria-hidden="true" />
              <input
                ref={directorySearchRef}
                aria-label="Search clients"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by client name"
                maxLength={128}
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear client search"
                  title="Clear search"
                  onClick={() => setQuery("")}
                >
                  <X size={17} />
                </button>
              ) : null}
            </label>

            <div className={styles.directoryFreshness}>
              {dataAsOf ? <span>Data through <strong>{formatDate(dataAsOf)}</strong></span> : null}
              <button
                type="button"
                aria-label="Refresh client directory"
                title="Refresh client directory"
                onClick={() => {
                  forceReload.current = true;
                  setReloadKey((current) => current + 1);
                }}
                disabled={isLoading || isCompletingRoster}
                className={styles.directoryRefresh}
              >
                <RefreshCw size={16} className={isLoading || isCompletingRoster ? "animate-spin" : ""} />
              </button>
            </div>
        </section>

        {isCompletingRoster ? <div className="flex items-center gap-2 border-b border-[#e4e8e6] py-2 text-[11px] text-[#66706b]" role="status"><RefreshCw size={12} className="animate-spin text-[#0f8b73]" /> Completing the directory. Results update as records arrive.</div> : null}
        {directoryNotice ? <DirectoryNotice>{directoryNotice}</DirectoryNotice> : null}
        {error ? <DirectoryError message={error} onRetry={() => setReloadKey((current) => current + 1)} hasPartialResults={clients.length > 0} /> : null}

        <section aria-label="Client list" className={styles.directoryCabinets}>
          {isLoading && clients.length === 0 ? <RosterSkeleton /> : null}
          {nameQuery ? <>
            <div role="list" aria-label="Matching client files" className="grid gap-6 lg:grid-cols-2">
              {matchingClients.slice(0, displayLimit).map((client) => (
                <div role="listitem" key={client.profile_key ?? client.canonical_client_id} className="min-w-0">
                  <ClientDirectoryCard client={client} layout="cards" onOpen={() => onOpenProfile(client.profile_key ?? client.canonical_client_id)} />
                </div>
              ))}
            </div>
            {displayLimit < matchingClients.length ? <div className={styles.cabinetPagination}>
              <span>Showing {displayLimit} of {matchingClients.length}</span>
              <button type="button" onClick={() => setDisplayLimit((current) => current + DISPLAY_INCREMENT)}><ChevronDown size={14} aria-hidden="true" /> Show more</button>
            </div> : null}
          </> : <div role="group" aria-label="Community file cabinets" className={styles.cabinetRow} hidden={communityBoxes.length === 0}>
            {communityBoxes.map(([community, records], index) => (
              <button key={community} type="button" aria-label={`Open ${community} file cabinet`} className={styles.cabinet} onClick={(event) => {
                cabinetOpener.current = event.currentTarget;
                clearFilters();
                setOpenCabinet({ community, origin: event.currentTarget.getBoundingClientRect() });
              }}>
                <span className={styles.cabinetIndex} aria-hidden="true">FILE / {String(index + 1).padStart(2, "0")}</span>
                <span className={styles.cabinetFiles} aria-hidden="true"><i /><i /><i /></span>
                <span className={styles.cabinetFace}>
                  <span className={styles.cabinetName}>{community}</span>
                  <span className={styles.cabinetHandle} aria-hidden="true" />
                  <span className={styles.cabinetCount}>{countNoun(records.length, "client")}</span>
                </span>
              </button>
            ))}
          </div>}

          {!isLoading && !isCompletingRoster && !error && matchingClients.length === 0 ? (
            <div className={styles.directoryEmpty}>
              <FolderOpen size={28} aria-hidden="true" />
              <h2>{emptyRosterMessage(query)}</h2>
              <p>Try a broader name or refresh the directory if the client was recently added.</p>
              {query.trim() ? <button type="button" onClick={() => setQuery("")} className={styles.cabinetReset}>Clear search</button> : null}
            </div>
          ) : null}
        </section>

      </div>
      {openCabinet ? <section ref={cabinetRef} tabIndex={-1} aria-label={`${openCabinet.community} file cabinet`} className={styles.cabinetDrawer} onKeyDown={(event) => {
        // Native pickers own Escape, including the event that dismisses their menu.
        if (event.target instanceof Element && event.target.closest("select")) return;
        if (event.key === "Escape") { event.stopPropagation(); setOpenCabinet(null); }
      }}>
        <div className={styles.cabinetToolbar}>
          <div className={styles.cabinetHeading}>
            <button type="button" aria-label="Back to cabinets" onClick={() => setOpenCabinet(null)} className={styles.cabinetBack}><ArrowLeft size={18} aria-hidden="true" /><span>Cabinets</span></button>
            <div className={styles.cabinetTitle}><h2>{openCabinet.community}</h2><span aria-live="polite" className="relative">{isLoading ? "Loading clients…" : countNoun(cabinetClients.length, "client")}<FeedbackCue value={`${admissionFilter}:${sort}:${displayLimit}`} /></span></div>
          </div>
          <DirectoryLayoutToggle layout={layout} onChange={selectLayout} />
          <div className={styles.cabinetTools}>
          <div className={styles.cabinetSearch}>
            <Search size={18} aria-hidden="true" />
            <input aria-label="Search this cabinet" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by client name" maxLength={128} />
            {query ? <button type="button" aria-label="Clear cabinet search" onClick={() => setQuery("")}><X size={16} aria-hidden="true" /></button> : null}
          </div>
          <section aria-label="Cabinet filters" className={styles.cabinetFilters}>
            <DirectorySelect label="Admitted" active={admissionFilter !== "any"}>
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
            <DirectorySelect label="Sort" active={sort !== "name"}>
              <select aria-label="Sort clients" value={sort} onChange={(event) => { setSort(event.target.value as SortOption); setDisplayLimit(DISPLAY_INCREMENT); }}>
                <option value="name">Name A-Z</option>
                <option value="recent_admission">Recently admitted</option>
                <option value="pipeline_activity">Most Pipeline activity</option>
              </select>
            </DirectorySelect>
            {hasCabinetFilters ? <button type="button" onClick={clearFilters} className={styles.cabinetReset}>Reset filters</button> : null}
          </section>
          </div>
        </div>
        <div className={styles.cabinetContents}>
          {directoryNotice ? <DirectoryNotice>{directoryNotice}</DirectoryNotice> : null}
          {error ? <DirectoryError message={error} onRetry={() => setReloadKey((current) => current + 1)} hasPartialResults={clients.length > 0} /> : null}
          {isLoading && clients.length === 0 ? <RosterSkeleton /> : null}
          {isCompletingRoster ? <p role="status" className="mb-4 text-[12px] text-[#65716b]">Completing the directory. Results update as records arrive.</p> : null}
          {layout === "list" ? <div aria-hidden="true" className={styles.listHeading}><span>Client</span><span>Community</span><span>Unit</span><span>Admitted</span><span>Care level</span><span /></div> : null}
          <div role="list" aria-label={`${openCabinet.community} clients`} className={layout === "cards" ? styles.directoryStack : "divide-y divide-[#dde3de] border-b border-[#dde3de]"}>
            {visibleClients.map((client) => (
              <div role="listitem" key={client.profile_key ?? client.canonical_client_id} className="min-w-0">
                <ClientDirectoryCard client={client} layout={layout} onOpen={() => { setOpenCabinet(null); onOpenProfile(client.profile_key ?? client.canonical_client_id); }} />
              </div>
            ))}
          </div>
          {!isLoading && !isCompletingRoster && !error && !cabinetClients.length ? <p className={styles.cabinetEmpty}>No clients match the current search and filters in this cabinet.</p> : null}
          {visibleClients.length < cabinetClients.length ? <div className={styles.cabinetPagination}>
            <span>Showing {visibleClients.length} of {cabinetClients.length}</span>
            <button type="button" onClick={() => setDisplayLimit((current) => current + DISPLAY_INCREMENT)}><ChevronDown size={14} aria-hidden="true" /> Show more</button>
          </div> : null}
        </div>
        <div className={styles.cabinetLip} aria-hidden="true"><span className={styles.cabinetHandle} /></div>
      </section> : null}
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
  children,
}: {
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <label data-filter-active={active} className={`pipeline-directory-select ${styles.directorySelect}`}>
      <span className={styles.directorySelectLabel}>{label}</span>
      {children}
      <ChevronDown size={15} aria-hidden="true" />
    </label>
  );
}

function DirectoryLayoutToggle({ layout, onChange }: { layout: DirectoryLayout; onChange: (layout: DirectoryLayout) => void }) {
  return (
    <div role="group" aria-label="Client view" className={styles.directoryLayout}>
      <button type="button" aria-label="Show clients as cards" aria-pressed={layout === "cards"} onClick={() => onChange("cards")}><LayoutGrid size={16} aria-hidden="true" /><span>Folders</span></button>
      <button type="button" aria-label="Show clients as a list" aria-pressed={layout === "list"} onClick={() => onChange("list")}><List size={16} aria-hidden="true" /><span>List</span></button>
    </div>
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

function ClientDirectoryCard({ client, layout, onOpen }: { client: DirectoryClient; layout: DirectoryLayout; onOpen: () => void }) {
  const identityTitle = formatClientIdentityTitle({
    name: client.display_name,
    gender: client.gender,
    community: client.current_community || client.community_names[0],
  });
  const gender = resolveClientGender(client.gender);
  const community = resolveClientCommunity(client.current_community, client.community_names[0]);
  const communityLabel = community || "—";
  const unitLabel = client.unit || "—";
  const admitted = client.admit_date ? formatDate(client.admit_date) : null;
  const admissionLabel = admitted || "—";
  const careLabel = client.care_level || "—";

  return (
    <button
      type="button"
      aria-label={`Open profile for ${identityTitle}`}
      onClick={(event) => openClientChart(event.currentTarget, onOpen)}
      onPointerEnter={() => prefetchPipelineProfile(client.profile_key ?? client.canonical_client_id)}
      onFocus={() => prefetchPipelineProfile(client.profile_key ?? client.canonical_client_id)}
      onPointerLeave={cancelPipelineWarmup}
      onBlur={cancelPipelineWarmup}
      className={layout === "list" ? styles.listRow : styles.folder}
    >
      {layout === "list" ? <>
        <span className="flex min-w-0 items-center gap-3">
          <ClientChartThumbnail />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block text-[15px] font-bold leading-5 text-[#25382e]">{identityTitle}</span>
            {gender ? <span className="mt-1 block text-[12px] text-[#59635d]">{gender}</span> : null}
            <span className="mt-1 block text-[12px] font-semibold text-[#59685f] lg:hidden">{communityLabel}</span>
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#59685f] lg:hidden">
              <span>Unit {unitLabel}</span>
              <span>Admitted {admissionLabel}</span>
              <span>Care: {careLabel}</span>
            </span>
          </span>
        </span>
        <span className="hidden min-w-0 text-[13px] font-semibold text-[#25382e] [overflow-wrap:anywhere] lg:block"><span className="sr-only">Community: </span>{communityLabel}</span>
        <span className="hidden min-w-0 text-[13px] font-semibold text-[#25382e] [overflow-wrap:anywhere] lg:block"><span className="sr-only">Unit: </span>{unitLabel}</span>
        <span className="hidden min-w-0 text-[13px] font-semibold tabular-nums text-[#25382e] lg:block"><span className="sr-only">Admitted: </span>{admissionLabel}</span>
        <span className="hidden min-w-0 text-[13px] font-semibold text-[#25382e] [overflow-wrap:anywhere] lg:block"><span className="sr-only">Care level: </span>{careLabel}</span>
        <ArrowRight size={16} aria-hidden="true" className="text-[#0c705f]" />
      </> : <>
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
          <ClientCardSummary client={client} community={community} admitted={admitted} />
          {!client.profile_key ? <span className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#dde3de] px-4 py-2.5 text-[11px] font-medium tabular-nums text-[#626e67]">
            <span className="flex items-center gap-1.5"><FileText size={12} className="shrink-0" />{countNoun(client.document_count, "document")}</span>
            <span className="flex items-center gap-1.5"><FolderOpen size={12} className="shrink-0" />{countNoun(client.referral_count, "workspace")}</span>
            <span className="ml-auto">{countNoun(client.episode_count, "stay")}</span>
          </span> : null}
        </span>
      </span>
      </>}
    </button>
  );
}

function ClientCardSummary({ client, community, admitted }: { client: DirectoryClient; community: string | null; admitted: string | null }) {
  return (
    <span className={`${styles.previewSummary} grid grid-cols-2 gap-px bg-[#dde3de] md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]`}>
      <ChartPreviewCell label="Community" value={community} />
      <ChartPreviewCell label="Unit" value={client.unit ? `Unit ${client.unit}` : null} />
      <ChartPreviewCell label="Admitted" value={admitted} />
      <ChartPreviewCell label="Care level" value={client.care_level} />
      <ChartPreviewCell label="Date of birth" value={client.date_of_birth ? formatDate(client.date_of_birth) : null} />
      <ChartPreviewCell label="Age" value={client.age == null ? null : String(client.age)} />
      <ChartPreviewCell label="Resident number" value={client.resident_numbers.join(", ")} />
      <ChartPreviewCell label="Payor" value={client.payor ?? null} />
      <ChartPreviewCell label="Primary diagnosis" value={client.primary_diagnosis ?? null} />
      <ChartPreviewCell label="Physician" value={client.physician ?? null} />
      <ChartPreviewCell label="Diet" value={client.diet ?? null} />
      <ChartPreviewCell label="Length of stay" value={client.length_of_stay_days == null ? null : countNoun(client.length_of_stay_days, "day")} />
    </span>
  );
}

function ClientChartThumbnail() {
  return (
    <span aria-hidden="true" data-client-chart-preview data-testid="client-chart-thumbnail" className="flex h-12 w-[58px] shrink-0 items-center justify-center border border-[#cad4cf] bg-[#edf4f1] shadow-[0_2px_5px_rgba(29,52,43,0.08)]">
      <svg viewBox="0 0 58 48" className="h-full w-full" focusable="false">
        <rect x="7" y="4" width="44" height="40" fill="#ffffff" stroke="#c7d3ce" />
        <path d="M7 4h44v9H7z" fill="#e5f1eb" />
        <path d="M11 7v4" stroke="#0f8b73" strokeWidth="2" />
        <path d="M16 9h21" stroke="#7ba391" strokeWidth="2" />
        <path d="M7 13h44M7 23h44M7 33h44M29 23v21" stroke="#d5dfdb" />
        <path d="M11 18h27M11 28h10m12 0h10M11 38h10m12 0h10" stroke="#a6b9af" strokeWidth="2" />
      </svg>
    </span>
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

function emptyRosterMessage(query: string) {
  if (query.trim()) return "No clients match that search.";
  return "The client directory is empty.";
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
