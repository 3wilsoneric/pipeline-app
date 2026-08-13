"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import type {
  ClinicalFreshness,
  ClinicalResident,
  ClinicalResidentSearchResult,
} from "@/lib/clinical/clinical-contracts";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";

type RosterResident = ClinicalResidentSearchResult & Partial<Pick<
  ClinicalResident,
  "admit_date" | "care_level" | "length_of_stay_days"
>>;

type RosterPayload = {
  residents: RosterResident[];
  total: number;
  next_cursor: string | null;
  data_as_of: string;
  freshness: ClinicalFreshness;
};

export default function ClientProfileDirectory({
  onOpenProfile,
}: {
  onOpenProfile: (residentKey: string) => void;
}) {
  const [residents, setResidents] = useState<RosterResident[]>([]);
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [dataAsOf, setDataAsOf] = useState("");
  const [freshness, setFreshness] = useState<ClinicalFreshness | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const loadedQuery = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    const normalizedQuery = query.trim();
    const timeout = window.setTimeout(() => {
      setIsLoading(true);
      setError("");
      const params = new URLSearchParams({ limit: "100" });
      if (normalizedQuery) params.set("q", normalizedQuery);

      fetchPipelineJson<RosterPayload>(`/api/clinical/roster?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((payload) => {
          setResidents(Array.isArray(payload.residents) ? payload.residents : []);
          setTotal(Number.isInteger(payload.total) ? payload.total : 0);
          setNextCursor(payload.next_cursor ?? null);
          setDataAsOf(payload.data_as_of ?? "");
          setFreshness(payload.freshness ?? null);
          loadedQuery.current = normalizedQuery;
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            if (loadedQuery.current !== normalizedQuery) {
              setResidents([]);
              setTotal(0);
              setNextCursor(null);
              setFreshness(null);
            }
            setError(loadError instanceof Error ? loadError.message : "The admitted-client roster is unavailable.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, reloadKey]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "100", cursor: nextCursor });
      if (query.trim()) params.set("q", query.trim());
      const payload = await fetchPipelineJson<RosterPayload>(`/api/clinical/roster?${params}`, { cache: "no-store" });
      setResidents((current) => mergeResidents(current, payload.residents ?? []));
      setTotal(payload.total);
      setNextCursor(payload.next_cursor ?? null);
      setDataAsOf(payload.data_as_of ?? dataAsOf);
      setFreshness(payload.freshness ?? freshness);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The next roster page could not be loaded.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <main aria-label="Client profiles" className="h-full overflow-y-auto bg-white text-[#111111]">
      <div data-testid="profiles-workspace" className="mx-auto w-full max-w-[1040px] px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3 pb-3">
          <label className="relative min-w-[260px] flex-1 md:max-w-[620px]">
            <span className="sr-only">Search admitted clients</span>
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#737373]" />
            <input
              aria-label="Search admitted clients"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search admitted clients or communities..."
              className="h-11 w-full border border-[#b3b3b3] bg-white pl-10 pr-3 text-[13px] outline-none placeholder:text-[#8a8a8a] focus:border-[#0f8b73]"
            />
          </label>
          <div className="ml-auto flex items-center gap-3 text-[12px] text-[#737373]">
            <span className="min-w-[154px] text-right tabular-nums">{isLoading ? "Loading roster..." : `${residents.length} of ${total} admitted clients`}</span>
            <button
              type="button"
              aria-label="Refresh admitted-client roster"
              title="Refresh roster"
              onClick={() => setReloadKey((current) => current + 1)}
              disabled={isLoading}
              className="flex h-9 w-9 items-center justify-center border border-[#d9d9d9] text-[#0f8b73] hover:border-[#0f8b73] disabled:text-[#b3b3b3]"
            >
              <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {freshness?.status === "stale" || freshness?.warning ? (
          <div className="mt-3 border-l-2 border-[#b07b21] bg-[#fffaf0] px-4 py-3 text-[12px] text-[#5d4925]" role="status">
            {freshness.warning || "The Alamo roster is older than its target freshness window."}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 flex items-start justify-between gap-4 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-4 py-3 text-[13px] text-[#59332d]" role="alert">
            <div>
              <div className="font-black">Admitted-client profiles are unavailable.</div>
              <div className="mt-1">{error}</div>
            </div>
            <button type="button" onClick={() => setReloadKey((current) => current + 1)} className="shrink-0 font-black text-[#0f8b73]">
              Retry
            </button>
          </div>
        ) : null}

        <section className="mt-4 border-y border-[#d9d9d9]" aria-label="Admitted client list">
          <div className="hidden grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)_minmax(150px,0.6fr)] gap-5 border-b border-[#d9d9d9] bg-[#fbfcfb] px-5 py-2.5 text-[9px] font-black uppercase tracking-[0.1em] text-[#737373] md:grid">
            <span>Client</span>
            <span>Community</span>
            <span className="text-right">Current stay</span>
          </div>
          {isLoading && residents.length === 0 ? <RosterSkeleton /> : null}
          {residents.map((resident) => (
            <button
              key={resident.resident_key}
              type="button"
              aria-label={`Open profile for ${resident.display_name}`}
              onClick={() => onOpenProfile(resident.resident_key)}
              className="grid w-full grid-cols-[minmax(0,1fr)] gap-5 border-b border-l-[3px] border-b-[#e5e5e5] border-l-transparent px-5 py-3.5 text-left transition-colors last:border-b-0 hover:border-l-[#0f8b73] hover:bg-[#f7faf9] focus-visible:border-l-[#0f8b73] focus-visible:bg-[#f7faf9] focus-visible:outline-none md:grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)_minmax(150px,0.6fr)]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-black leading-5 text-[#111111]">{resident.display_name}</span>
                <span className="mt-1 block truncate text-[11px] leading-4 text-[#737373] md:hidden">
                  {resident.community_name}{resident.unit ? ` · Unit ${resident.unit}` : ""}
                </span>
              </span>
              <span className="hidden min-w-0 md:block">
                <span className="block truncate text-[12px] font-semibold text-[#333333]">{resident.community_name}</span>
                <span className="mt-1 block truncate text-[10px] text-[#737373]">{resident.unit ? `Unit ${resident.unit}` : "Unit not reported"}</span>
              </span>
              <span className="hidden min-w-0 text-right md:block">
                <span className="block text-[11px] text-[#595959]">
                  {resident.admit_date ? `Admitted ${formatDate(resident.admit_date)}` : "Current roster"}
                </span>
                {resident.care_level ? <span className="mt-1 block truncate text-[10px] text-[#737373]">{resident.care_level}</span> : null}
              </span>
            </button>
          ))}

          {!isLoading && !error && residents.length === 0 ? (
            <div className="px-5 py-16 text-center text-[13px] text-[#737373]">
              {query.trim() ? "No admitted clients match that search." : "The current Alamo roster is empty."}
            </div>
          ) : null}
        </section>

        {nextCursor ? (
          <div className="flex justify-center py-6">
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore}
              className="h-10 border border-[#111111] px-4 text-[12px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:border-[#d9d9d9] disabled:text-[#8a8a8a]"
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}

        {dataAsOf && !error ? (
          <div className="py-4 text-right text-[10px] uppercase tracking-[0.1em] text-[#8a8a8a]">
            Alamo Platform · Data through {formatDate(dataAsOf)}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function RosterSkeleton() {
  return (
    <div aria-label="Loading admitted clients" aria-busy="true" className="divide-y divide-[#e5e5e5]">
      {Array.from({ length: 7 }, (_, index) => (
        <div
          key={index}
          className="grid min-h-[69px] grid-cols-[minmax(0,1fr)] items-center gap-5 border-l-[3px] border-transparent px-5 py-3.5 md:grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)_minmax(150px,0.6fr)]"
        >
          <div className="animate-pulse">
            <div className="h-4 w-2/5 rounded bg-[#e8ebe9]" />
            <div className="mt-2 h-2.5 w-3/5 rounded bg-[#f1f2f1] md:hidden" />
          </div>
          <div className="hidden animate-pulse md:block">
            <div className="h-3 w-1/2 rounded bg-[#edf0ee]" />
            <div className="mt-2 h-2.5 w-1/3 rounded bg-[#f4f5f4]" />
          </div>
          <div className="hidden animate-pulse justify-self-end md:block">
            <div className="h-3 w-28 rounded bg-[#edf0ee]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function mergeResidents(current: RosterResident[], incoming: RosterResident[]) {
  const merged = new Map(current.map((resident) => [resident.resident_key, resident]));
  for (const resident of incoming) merged.set(resident.resident_key, resident);
  return [...merged.values()];
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
