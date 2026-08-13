"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CircleAlert, MapPin, Plus, RefreshCw, Search, X } from "lucide-react";

import type {
  ClinicalFreshness,
  ClinicalResidentDirectoryResult,
} from "@/lib/clinical/clinical-contracts";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";

type RosterResident = ClinicalResidentDirectoryResult;

type RosterPayload = {
  residents: RosterResident[];
  total: number;
  next_cursor: string | null;
  data_as_of: string;
  freshness: ClinicalFreshness;
};

type FilterKey = "community" | "admitted" | "profile_data";
type AdmissionFilter = "last_30_days" | "last_3_months" | "last_6_months" | "last_12_months" | "older_than_12_months" | "missing";
type ProfileDataFilter = "missing_any" | "missing_unit" | "missing_admit_date" | "complete";
type CommunityOption = { id: string; name: string };

const PAGE_SIZE = 200;
const DISPLAY_INCREMENT = 100;
const MAX_DIRECTORY_PAGES = 50;
const filterDefinitions: Array<{ key: FilterKey; label: string; description: string }> = [
  { key: "community", label: "Community", description: "Show clients at one community" },
  { key: "admitted", label: "Admission date", description: "Filter the current stay by admission window" },
  { key: "profile_data", label: "Profile data", description: "Find missing current-stay details" },
];

export default function ClientProfileDirectory({
  onOpenProfile,
}: {
  onOpenProfile: (residentKey: string) => void;
}) {
  const [residents, setResidents] = useState<RosterResident[]>([]);
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [dataAsOf, setDataAsOf] = useState("");
  const [freshness, setFreshness] = useState<ClinicalFreshness | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompletingRoster, setIsCompletingRoster] = useState(false);
  const [directoryComplete, setDirectoryComplete] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_INCREMENT);
  const [knownCommunities, setKnownCommunities] = useState<CommunityOption[]>([]);
  const [activeFilters, setActiveFilters] = useState<FilterKey[]>([]);
  const [communityFilter, setCommunityFilter] = useState("");
  const [admissionFilter, setAdmissionFilter] = useState<AdmissionFilter>("last_6_months");
  const [profileDataFilter, setProfileDataFilter] = useState<ProfileDataFilter>("missing_any");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const loadedQuery = useRef("");
  const filterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const normalizedQuery = query.trim();
    const timeout = window.setTimeout(() => {
      let loadedFirstPage = false;
      setIsLoading(true);
      setIsCompletingRoster(false);
      setDirectoryComplete(false);
      setError("");
      setDisplayLimit(DISPLAY_INCREMENT);
      if (loadedQuery.current !== normalizedQuery) setResidents([]);

      void (async () => {
        try {
          let payload = await fetchRosterPage(normalizedQuery, null, controller.signal);
          if (controller.signal.aborted) return;
          loadedFirstPage = true;
          let merged = mergeResidents([], payload.residents ?? []);
          let cursor = payload.next_cursor ?? null;
          const seenCursors = new Set<string>();
          let pageCount = 1;

          setResidents(merged);
          setTotal(Number.isInteger(payload.total) ? payload.total : merged.length);
          setDataAsOf(payload.data_as_of ?? "");
          setFreshness(payload.freshness ?? null);
          setIsLoading(false);
          setIsCompletingRoster(Boolean(cursor));
          loadedQuery.current = normalizedQuery;
          if (!normalizedQuery) setKnownCommunities(collectCommunities(merged));

          while (cursor) {
            if (seenCursors.has(cursor) || pageCount >= MAX_DIRECTORY_PAGES) {
              throw new Error("The admitted-client directory exceeded its safe pagination limit.");
            }
            seenCursors.add(cursor);
            payload = await fetchRosterPage(normalizedQuery, cursor, controller.signal);
            if (controller.signal.aborted) return;
            merged = mergeResidents(merged, payload.residents ?? []);
            cursor = payload.next_cursor ?? null;
            pageCount += 1;
            setResidents(merged);
            setTotal(Number.isInteger(payload.total) ? payload.total : merged.length);
            setDataAsOf(payload.data_as_of ?? "");
            setFreshness(payload.freshness ?? null);
            if (!normalizedQuery) setKnownCommunities(collectCommunities(merged));
          }

          setDirectoryComplete(true);
        } catch (loadError) {
          if (controller.signal.aborted) return;
          setDirectoryComplete(false);
          setError(
            loadedFirstPage
              ? "The first roster page loaded, but the complete directory could not be retrieved. Refresh before applying filters."
              : loadError instanceof Error
                ? loadError.message
                : "The admitted-client roster is unavailable.",
          );
          if (!loadedFirstPage) {
            setResidents([]);
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
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, reloadKey]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) setFilterMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [filterMenuOpen]);

  const filteredResidents = useMemo(
    () => residents.filter((resident) => {
      if (activeFilters.includes("community") && communityFilter && resident.community_id !== communityFilter) return false;
      if (activeFilters.includes("admitted") && !matchesAdmissionFilter(resident.admit_date, admissionFilter, dataAsOf)) return false;
      if (activeFilters.includes("profile_data") && !matchesProfileDataFilter(resident, profileDataFilter)) return false;
      return true;
    }),
    [activeFilters, admissionFilter, communityFilter, dataAsOf, profileDataFilter, residents],
  );
  const visibleResidents = filteredResidents.slice(0, displayLimit);
  const availableFilters = filterDefinitions.filter((definition) => !activeFilters.includes(definition.key));
  const hasAppliedFilters = activeFilters.length > 0 || Boolean(query.trim());
  const countLabel = isLoading && residents.length === 0
    ? "Loading roster..."
    : isCompletingRoster
      ? `Loading ${residents.length} of ${total} clients...`
      : hasAppliedFilters
        ? `${visibleResidents.length} of ${filteredResidents.length} matching`
        : `${visibleResidents.length} of ${total} admitted clients`;

  const addFilter = (key: FilterKey) => {
    setActiveFilters((current) => [...current, key]);
    setDisplayLimit(DISPLAY_INCREMENT);
    setFilterMenuOpen(false);
  };

  const removeFilter = (key: FilterKey) => {
    setActiveFilters((current) => current.filter((filter) => filter !== key));
    if (key === "community") setCommunityFilter("");
    setDisplayLimit(DISPLAY_INCREMENT);
  };

  const clearFilters = () => {
    setActiveFilters([]);
    setCommunityFilter("");
    setAdmissionFilter("last_6_months");
    setProfileDataFilter("missing_any");
    setDisplayLimit(DISPLAY_INCREMENT);
  };

  return (
    <main aria-label="Client profiles" className="h-full overflow-y-auto bg-white text-[#111111]">
      <div data-testid="profiles-workspace" className="mx-auto w-full max-w-[1040px] px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3 pb-2">
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

          <div ref={filterMenuRef} className="relative">
            <button
              type="button"
              aria-label="Add profile filter"
              aria-expanded={filterMenuOpen}
              aria-haspopup="menu"
              title={!directoryComplete ? "Wait for the complete directory before filtering" : "Add filter"}
              onClick={() => setFilterMenuOpen((current) => !current)}
              disabled={!directoryComplete || availableFilters.length === 0}
              className="flex h-11 items-center gap-2 border border-[#b3b3b3] px-3 text-[11px] font-black uppercase tracking-[0.08em] text-[#333333] hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:border-[#e0e0e0] disabled:text-[#a3a3a3]"
            >
              <Plus size={16} />
              Filter
            </button>
            {filterMenuOpen ? (
              <div role="menu" aria-label="Profile filters" className="absolute left-0 top-[calc(100%+6px)] z-20 w-[250px] border border-[#cfcfcf] bg-white py-1 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
                {availableFilters.map((definition) => (
                  <button
                    key={definition.key}
                    type="button"
                    role="menuitem"
                    onClick={() => addFilter(definition.key)}
                    className="block w-full px-3 py-2.5 text-left hover:bg-[#f3f7f5] focus-visible:bg-[#f3f7f5] focus-visible:outline-none"
                  >
                    <span className="block text-[12px] font-black text-[#222222]">{definition.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-[#737373]">{definition.description}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-3 text-[12px] text-[#737373]">
            <span className="min-w-[154px] text-right tabular-nums">{countLabel}</span>
            <button
              type="button"
              aria-label="Refresh admitted-client roster"
              title="Refresh roster"
              onClick={() => setReloadKey((current) => current + 1)}
              disabled={isLoading || isCompletingRoster}
              className="flex h-9 w-9 items-center justify-center border border-[#d9d9d9] text-[#0f8b73] hover:border-[#0f8b73] disabled:text-[#b3b3b3]"
            >
              <RefreshCw size={15} className={isLoading || isCompletingRoster ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {activeFilters.length > 0 ? (
          <div aria-label="Active profile filters" className="flex flex-wrap items-center gap-2 py-2">
            {activeFilters.includes("community") ? (
              <FilterControl label="Community" icon={<MapPin size={14} />} onRemove={() => removeFilter("community")}>
                <select
                  aria-label="Filter profiles by community"
                  value={communityFilter}
                  onChange={(event) => {
                    setCommunityFilter(event.target.value);
                    setDisplayLimit(DISPLAY_INCREMENT);
                  }}
                  className="h-7 w-full min-w-0 bg-transparent pr-2 text-[11px] font-semibold outline-none sm:min-w-[170px]"
                >
                  <option value="">Choose community</option>
                  {knownCommunities.map((community) => (
                    <option key={community.id} value={community.id}>{community.name}</option>
                  ))}
                </select>
              </FilterControl>
            ) : null}
            {activeFilters.includes("admitted") ? (
              <FilterControl label="Admitted" icon={<CalendarDays size={14} />} onRemove={() => removeFilter("admitted")}>
                <select
                  aria-label="Filter profiles by admission date"
                  value={admissionFilter}
                  onChange={(event) => {
                    setAdmissionFilter(event.target.value as AdmissionFilter);
                    setDisplayLimit(DISPLAY_INCREMENT);
                  }}
                  className="h-7 w-full min-w-0 bg-transparent pr-2 text-[11px] font-semibold outline-none sm:min-w-[150px]"
                >
                  <option value="last_30_days">Last 30 days</option>
                  <option value="last_3_months">Last 3 months</option>
                  <option value="last_6_months">Last 6 months</option>
                  <option value="last_12_months">Last 12 months</option>
                  <option value="older_than_12_months">More than 12 months ago</option>
                  <option value="missing">Admission date missing</option>
                </select>
              </FilterControl>
            ) : null}
            {activeFilters.includes("profile_data") ? (
              <FilterControl label="Profile data" icon={<CircleAlert size={14} />} onRemove={() => removeFilter("profile_data")}>
                <select
                  aria-label="Filter profiles by profile data"
                  value={profileDataFilter}
                  onChange={(event) => {
                    setProfileDataFilter(event.target.value as ProfileDataFilter);
                    setDisplayLimit(DISPLAY_INCREMENT);
                  }}
                  className="h-7 w-full min-w-0 bg-transparent pr-2 text-[11px] font-semibold outline-none sm:min-w-[155px]"
                >
                  <option value="missing_any">Missing stay details</option>
                  <option value="missing_unit">Unit missing</option>
                  <option value="missing_admit_date">Admission date missing</option>
                  <option value="complete">Current stay complete</option>
                </select>
              </FilterControl>
            ) : null}
            <button type="button" onClick={clearFilters} className="h-8 px-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#737373] hover:text-[#a63d2f]">
              Clear all
            </button>
          </div>
        ) : null}

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

        <section className="mt-3 border-y border-[#d9d9d9]" aria-label="Admitted client list">
          <div className="hidden grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)_minmax(150px,0.6fr)] gap-5 border-b border-[#d9d9d9] bg-[#fbfcfb] px-5 py-2.5 text-[9px] font-black uppercase tracking-[0.1em] text-[#737373] md:grid">
            <span>Client</span>
            <span>Community</span>
            <span className="text-right">Current stay</span>
          </div>
          {isLoading && residents.length === 0 ? <RosterSkeleton /> : null}
          {visibleResidents.map((resident) => (
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
                  {resident.admit_date ? `Admitted ${formatDate(resident.admit_date)}` : "Admission date not reported"}
                </span>
                {resident.care_level ? <span className="mt-1 block truncate text-[10px] text-[#737373]">{resident.care_level}</span> : null}
              </span>
            </button>
          ))}

          {!isLoading && !error && filteredResidents.length === 0 ? (
            <div className="px-5 py-16 text-center text-[13px] text-[#737373]">
              <div>{hasAppliedFilters ? "No admitted clients match these filters." : "The current Alamo roster is empty."}</div>
              {activeFilters.length > 0 ? (
                <button type="button" onClick={clearFilters} className="mt-3 font-black text-[#0f8b73] hover:underline">Clear filters</button>
              ) : null}
            </div>
          ) : null}
        </section>

        {visibleResidents.length < filteredResidents.length ? (
          <div className="flex justify-center py-6">
            <button
              type="button"
              onClick={() => setDisplayLimit((current) => current + DISPLAY_INCREMENT)}
              className="h-10 border border-[#111111] px-4 text-[12px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73]"
            >
              Load more
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

function FilterControl({
  label,
  icon,
  onRemove,
  children,
}: {
  label: string;
  icon: ReactNode;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-9 w-full max-w-full items-center border border-[#b7d9d0] bg-[#f2f8f6] pl-2 text-[#0f8b73] sm:w-auto">
      <span className="flex shrink-0 items-center gap-1.5 border-r border-[#cfe3de] pr-2 text-[9px] font-black uppercase tracking-[0.08em]">
        {icon}
        {label}
      </span>
      <span className="min-w-0 flex-1 px-2 text-[#222222]">{children}</span>
      <button type="button" aria-label={`Remove ${label.toLowerCase()} filter`} title={`Remove ${label.toLowerCase()} filter`} onClick={onRemove} className="flex h-full w-8 shrink-0 items-center justify-center border-l border-[#cfe3de] hover:bg-[#e4f1ed]">
        <X size={13} />
      </button>
    </div>
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

async function fetchRosterPage(query: string, cursor: string | null, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  return fetchPipelineJson<RosterPayload>(`/api/clinical/roster?${params}`, {
    cache: "no-store",
    signal,
  });
}

function collectCommunities(residents: RosterResident[]) {
  const communities = new Map<string, string>();
  for (const resident of residents) communities.set(resident.community_id, resident.community_name);
  return [...communities.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function mergeResidents(current: RosterResident[], incoming: RosterResident[]) {
  const merged = new Map(current.map((resident) => [resident.resident_key, resident]));
  for (const resident of incoming) merged.set(resident.resident_key, resident);
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

function matchesProfileDataFilter(resident: RosterResident, filter: ProfileDataFilter) {
  const missingUnit = !resident.unit?.trim();
  const missingAdmitDate = !resident.admit_date;
  if (filter === "missing_unit") return missingUnit;
  if (filter === "missing_admit_date") return missingAdmitDate;
  if (filter === "complete") return !missingUnit && !missingAdmitDate;
  return missingUnit || missingAdmitDate;
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

function formatDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
